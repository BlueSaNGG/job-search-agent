// JD Archive MVP: no second crawl, no raw descriptions or resume on disk.
// The only persisted daily file is AES-256-GCM ciphertext for a 30-day Actions artifact.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { DiscoveredJob } from "../core/discover/discover.ts";
import { rankJobs, type Ranking } from "../core/rank.ts";
import { workersAiEmbed } from "./workers-ai.ts";

const DAY_MS = 86_400_000;
const MAGIC = Buffer.from("JDIA1");
const MAX_POOL = 120;
// Conservative vocabulary extraction. A hit means "mentioned", NOT "required"
// or "mastered"; PR B will add section-aware required/preferred classification.
const SKILL_PATTERNS: Array<[string, RegExp]> = [
  ["ci_cd", /\bci\s*\/\s*cd\b|\bcontinuous integration\b|\bcontinuous delivery\b|\bjenkins\b/i],
  ["build_systems", /\bbuild systems?\b|\bbuild infrastructure\b|\bbuild pipeline\b/i],
  ["bazel", /\bbazel\b/i],
  ["cmake", /\bcmake\b/i],
  ["kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["docker", /\bdocker\b|\bcontainerization\b/i],
  ["python", /\bpython\b/i],
  ["cpp", /\bc\+\+(?!\w)|\bcplusplus\b/i],
  ["distributed_systems", /\bdistributed systems?\b/i],
  ["terraform", /\bterraform\b|\binfrastructure as code\b/i],
  ["observability", /\bobservability\b|\bprometheus\b|\bgrafana\b/i],
  ["cloud_platforms", /\baws\b|\bgcp\b|\bazure\b/i],
];

/** Only bounded normalized labels, never JD body or quoted source sentences. */
export function extractSkillMentions(description: string | undefined): string[] {
  if (!description) return [];
  return SKILL_PATTERNS.filter(([, pattern]) => pattern.test(description)).map(([id]) => id);
}

/**
 * Section-aware but deliberately conservative requirement inference.
 * No JD sentences are serialized: a signal stores only skill ID + heading type.
 * Descriptions without recognizable headings remain "mentioned".
 */
export type SkillSignal = {
  id: string;
  requirement: "required" | "preferred" | "mentioned";
  section: "minimum_qualifications" | "preferred_qualifications" | "responsibilities" | "unknown";
};
export const SKILL_TAXONOMY_VERSION = "skill-signals-v1";
const SECTION_PREFERRED = /^(?:preferred|desired|additional)\s+(?:qualifications?|requirements?|skills?)\b|^nice[\s-]+to[\s-]+have\b|^bonus\s+(?:points?|skills?)\b|^(?:加分项|优先条件|优先考虑|加分条件)/i;
const SECTION_REQUIRED = /^(?:minimum|basic|required|essential|must[\s-]+have)\s+(?:qualifications?|requirements?|skills?)\b|^requirements?\s*[:：]?|^qualifications?\s*[:：]?|^(?:任职要求|岗位要求|基本要求|必备条件|任职资格)/i;
const SECTION_RESPONSIBILITIES = /^(?:responsibilities|what you(?:'|’)ll do|duties|about the role)\b|^(?:工作职责|岗位职责|工作内容)/i;

export function extractSkillSignals(description: string | undefined): SkillSignal[] {
  if (!description) return [];
  let section: SkillSignal["section"] = "unknown";
  const byId = new Map<string, SkillSignal>();
  const strength = { mentioned: 0, preferred: 1, required: 2 };
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.replace(/^#{1,5}\s*/, "").replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
    // A heading may share a line with the first qualification; do not require
    // an exact-string match. But headings that run into long prose are ignored.
    const headingLikely = heading.length <= 160 &&
      !/^(?:[-*•]|\d+[.)])\s/.test(heading);
    if (headingLikely && SECTION_PREFERRED.test(heading)) section = "preferred_qualifications";
    else if (headingLikely && SECTION_REQUIRED.test(heading)) section = "minimum_qualifications";
    else if (headingLikely && SECTION_RESPONSIBILITIES.test(heading)) section = "responsibilities";
    else if (headingLikely && (/^[\w][\w '&/()-]{1,65}[:：]\s*$/.test(heading) ||
      /^(?:福利待遇|薪酬福利|公司介绍|关于我们)[:：]?$/.test(heading))) section = "unknown";
    const requirement: SkillSignal["requirement"] =
      section === "minimum_qualifications" ? "required" :
      section === "preferred_qualifications" ? "preferred" : "mentioned";
    for (const id of extractSkillMentions(line)) {
      const next: SkillSignal = { id, requirement, section };
      const old = byId.get(id);
      if (!old || strength[next.requirement] > strength[old.requirement]) byId.set(id, next);
    }
  }
  return [...byId.values()];
}

export const ARCHIVE_PATH = new URL("../../.data/jd-intelligence-slot.enc", import.meta.url);

export interface DailyArchive {
  schema_version: 1;
  slot: string;
  observed_at: string;
  ranking_method: "resume_embedding" | "unranked";
  skill_taxonomy_version?: string;
  source_coverage: {
    attempted: number;
    failed: number;
    eligible: number;
    candidates_considered: number;
    saved: number;
  };
  jobs: Array<{
    id: string;
    company_id: string;
    company_name: string;
    title: string;
    location: string;
    location_status: "eligible" | "needs_review";
    url: string;
    posted_at: string | null;
    observed_at: string;
    description_status: "complete" | "partial" | "unavailable";
    content_hash: string;
    skill_mentions: string[];
    skill_signals?: SkillSignal[]; // conservative heading-based evidence; legacy snapshots may omit
    similarity: number | null;
  }>;
}

/** Relative relevance, never a claim of a probability or pay increase. */
function topicPriority(j: DiscoveredJob): number {
  const title = j.title.toLowerCase();
  if (/developer productivity|build (and |& )?(infra|system|engineer)|ci\/cd|build.*release/.test(title)) return 5;
  if (/infrastructure|platform|distributed|ml infra|machine learning infrastructure/.test(title)) return 4;
  if (/reliability|sre|devops|systems engineer/.test(title)) return 3;
  return 1;
}

function stable(a: DiscoveredJob, b: DiscoveredJob): number {
  const focus = topicPriority(b) - topicPriority(a);
  if (focus) return focus;
  const when = (Date.parse(b.postedAt ?? "") || 0) - (Date.parse(a.postedAt ?? "") || 0);
  return when || a.id.localeCompare(b.id);
}

/** Bounded job pool with stable IDs and company diversity before embeddings. */
export function chooseArchiveCandidates(jobs: DiscoveredJob[], now = Date.now()): DiscoveredJob[] {
  const minPosted = now - 14 * DAY_MS;
  const unique = new Map<string, DiscoveredJob>();
  for (const j of jobs) {
    const posted = j.postedAt ? Date.parse(j.postedAt) : NaN;
    if (Number.isFinite(posted) && posted < minPosted) continue;
    if (!unique.has(j.id)) unique.set(j.id, j);
  }
  const perCompany = new Map<string, number>();
  const chosen: DiscoveredJob[] = [];
  for (const j of [...unique.values()].sort(stable)) {
    const count = perCompany.get(j.company) ?? 0;
    if (count >= 4) continue;
    perCompany.set(j.company, count + 1);
    chosen.push(j);
    if (chosen.length >= MAX_POOL) break;
  }
  return chosen;
}

function comparableScore(j: DiscoveredJob, scores: Record<string, number>): number {
  const value = scores[j.id];
  return Number.isFinite(value) ? value : -1;
}

/** Select up to 10, max two from an employer where enough other employers exist. */
export function selectDailyTop(jobs: DiscoveredJob[], ranking: Ranking | null, limit = 10): DiscoveredJob[] {
  const scores = ranking?.scores ?? {};
  const sorted = [...jobs].sort((a, b) => {
    const scoreDifference = comparableScore(b, scores) - comparableScore(a, scores);
    if (scoreDifference) return scoreDifference;
    // Scored ties follow the RFC's deterministic company/ID order. When
    // ranking is unavailable, prioritize infra topics rather than alphabet.
    if (!ranking) return stable(a, b) || a.company.localeCompare(b.company) || a.id.localeCompare(b.id);
    return a.company.localeCompare(b.company) || a.id.localeCompare(b.id);
  });
  const chosen: DiscoveredJob[] = [];
  const used = new Set<string>();
  const companies = new Map<string, number>();
  const take = (maxPerCompany: number) => {
    for (const j of sorted) {
      if (chosen.length >= limit) return;
      if (used.has(j.id) || (companies.get(j.company) ?? 0) >= maxPerCompany) continue;
      used.add(j.id);
      companies.set(j.company, (companies.get(j.company) ?? 0) + 1);
      chosen.push(j);
    }
  };
  take(2);
  take(limit);
  return chosen;
}

export function buildDailyArchive(
  candidatePool: DiscoveredJob[],
  ranking: Ranking | null,
  slot: string,
  observedAt: string,
  attempted: number,
  failed: number,
  eligible: number,
): DailyArchive {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot) || !Number.isFinite(Date.parse(slot + "T00:00:00Z"))) throw new Error("Invalid archive slot");
  const top = selectDailyTop(candidatePool, ranking);
  return {
    schema_version: 1, slot, observed_at: observedAt,
    ranking_method: ranking ? "resume_embedding" : "unranked",
    skill_taxonomy_version: SKILL_TAXONOMY_VERSION,
    source_coverage: { attempted, failed, eligible, candidates_considered: candidatePool.length, saved: top.length },
    jobs: top.map(j => {
      // Hash the limited description we actually observed. Later source revisions
      // and changes in parsing will have a different content hash.
      const observedText = [j.title, j.location, j.description ?? "", j.postedAt ?? ""].join("\n").replace(/\s+/g, " ").trim();
      const location = j.location.trim();
      return {
        id: j.id,
        company_id: j.company,
        company_name: j.companyName.slice(0, 140),
        title: j.title.slice(0, 240),
        location: location.slice(0, 240),
        location_status: !location || /^\d+\s+locations?$/i.test(location) ? "needs_review" : "eligible",
        url: j.url,
        posted_at: j.postedAt ?? null,
        observed_at: observedAt,
        description_status: !j.description ? "unavailable" : j.description.length >= 4000 ? "partial" : "complete",
        content_hash: createHash("sha256").update(observedText, "utf8").digest("hex"),
        skill_mentions: extractSkillMentions(j.description),
        skill_signals: extractSkillSignals(j.description),
        similarity: ranking && Number.isFinite(ranking.scores[j.id]) ? ranking.scores[j.id] : null,
      };
    }),
  };
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  if (secret.length < 32) throw new Error("JD_INTEL_KEY must contain at least 32 characters");
  return scryptSync(secret, salt, 32);
}

/** Authenticated encryption; header is magic(5), salt(16), iv(12), tag(16), ciphertext. */
export function encryptArchive(value: DailyArchive, secret: string): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = deriveKey(secret, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptArchive(data: Buffer, secret: string): DailyArchive {
  if (data.length < 50 || !data.subarray(0, 5).equals(MAGIC)) throw new Error("Unrecognized JD archive envelope");
  const salt = data.subarray(5, 21), iv = data.subarray(21, 33), tag = data.subarray(33, 49);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  decipher.setAuthTag(tag);
  const result = JSON.parse(Buffer.concat([decipher.update(data.subarray(49)), decipher.final()]).toString("utf8"));
  if (result?.schema_version !== 1 || !Array.isArray(result.jobs)) throw new Error("Unrecognized JD archive schema");
  return result as DailyArchive;
}

/**
 * Best effort and isolated from existing email. If no secret has been installed,
 * leave daily alerts intact and explicitly report that no archive was written.
 */
export async function saveDailyArchive(
  eligible: DiscoveredJob[],
  scan: { attempted: number; failed: string[] },
  slot: string,
  resumeLoader: () => Promise<string | null>,
  now = new Date(),
  allowRanking = true,
): Promise<void> {
  const secret = process.env.JD_INTEL_KEY;
  if (!secret) {
    console.log("JD Archive disabled: JD_INTEL_KEY secret is not configured.");
    return;
  }
  const pool = chooseArchiveCandidates(eligible, now.getTime());
  let ranking: Ranking | null = null;
  if (pool.length && allowRanking) {
    try {
      const resume = await resumeLoader();
      if (resume) ranking = await rankJobs(resume, pool, workersAiEmbed, null, 0);
    } catch {
      console.log("JD Archive: resume ranking unavailable; saving unranked shortlist.");
    }
  }
  const snapshot = buildDailyArchive(pool, ranking, slot, now.toISOString(), scan.attempted, scan.failed.length, eligible.length);
  // Encrypt in memory before any file write. Never serialize raw job descriptions.
  const encrypted = encryptArchive(snapshot, secret);
  mkdirSync(new URL("../../.data/", import.meta.url), { recursive: true });
  writeFileSync(ARCHIVE_PATH, encrypted, { mode: 0o600 });
  console.log(`JD Archive: encrypted ` + snapshot.jobs.length + ` jobs from ` + pool.length +
    ` candidates; ` + scan.failed.length + ` source failures; slot ` + slot + `.`);
}
