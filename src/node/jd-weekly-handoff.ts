// Phase C producer: source-backed, minimized weekly handoff for the private interview-prep repo.
// Read-only: consumes already-encrypted daily archives after Phase B validates the sample.
// Never publishes resumes, free-form JD text, private outcomes, or numerical similarity scores.
import { createHash } from "node:crypto";
import type { EnrichedArchive, EnrichedJob, SkillRequirement } from "./jd-trends.ts";
import { buildTrendReport, slotRange, validateDailyArchive } from "./jd-trends.ts";

export const HANDOFF_PROFILE_VERSION = "2026-11-v1";
export const HANDOFF_TARGET_LOCATIONS = "US_MAJOR_METROS, Shanghai, Hangzhou";
const MS_PER_DAY = 86_400_000;
const LABELS: Record<string, string> = {
  ci_cd: "CI/CD", build_systems: "Build systems", bazel: "Bazel",
  cmake: "CMake", kubernetes: "Kubernetes", docker: "Docker",
  python: "Python", cpp: "C++", distributed_systems: "Distributed systems",
  terraform: "Terraform", observability: "Observability", cloud_platforms: "Cloud platforms",
};
const SECTION: Record<string, "requirements" | "preferred" | "responsibilities" | "other"> = {
  minimum_qualifications: "requirements",
  preferred_qualifications: "preferred",
  responsibilities: "responsibilities",
  unknown: "other",
};
const STRENGTH: Record<SkillRequirement, number> = { mentioned: 0, preferred: 1, required: 2 };

function allowedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !!url.hostname && url.hostname !== "localhost" && !url.hostname.endsWith(".local") &&
      !/^(?:127|10)\./.test(url.hostname);
  } catch {
    return false;
  }
}

/** RFC 8785 compatible for this bounded JSON subset (strings, integers, arrays and objects). */
export function canonicalJson(value: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === "object") {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([k, v]) => [k, sort(v)]));
    }
    if (typeof x === "number" && !Number.isSafeInteger(x)) throw new Error("Unsafe canonical JSON number");
    return x;
  };
  return JSON.stringify(sort(value));
}

export function contentDigest(value: object): string {
  const { content_digest: _ignored, ...payload } = value as Record<string, unknown>;
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

function weekId(endSlot: string): string {
  const date = new Date(endSlot + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  const number = Math.ceil((((date.getTime() - first.getTime()) / MS_PER_DAY) + 1) / 7);
  return year + "-W" + String(number).padStart(2, "0");
}

function verifiedSignals(job: EnrichedJob): Array<{
  id: string; label: string; requirement: SkillRequirement;
  section: "requirements" | "preferred" | "responsibilities" | "other"; evidence: string;
}> {
  // The encrypted daily schema has ONLY normalized skill IDs and section types.
  // Do not manufacture a quote or claim an exact requirement from missing JD text.
  const source = job.skill_signals ??
    job.skill_mentions.map(id => ({ id, requirement: "mentioned" as const, section: "unknown" as const }));
  const byId = new Map<string, typeof source[number]>();
  for (const signal of source) {
    const old = byId.get(signal.id);
    if (!old || STRENGTH[signal.requirement] > STRENGTH[old.requirement]) byId.set(signal.id, signal);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 32).map(s => ({
    id: s.id, label: LABELS[s.id] ?? s.id.replace(/_/g, " "),
    requirement: s.requirement, section: SECTION[s.section] ?? "other",
    evidence: "Automated keyword/section signal; verify the full official posting.",
  }));
}

export interface WeeklyHandoff {
  schema_version: 1;
  week_id: string;
  window: { from: string; to: string };
  generated_at: string;
  target_profile_version: string;
  source_coverage: {
    configured_readable_companies: number; companies_attempted: number;
    companies_succeeded: number; companies_failed: number;
    sampled_jds: number; sampled_companies: number;
    ambiguous_location_jds: number; missing_description_jds: number;
  };
  jds: Array<{
    id: string; company_id: string; company_name: string; title: string; url: string;
    location: string; location_status: "eligible" | "needs_review";
    posted_at: string | null; first_seen_at: string; last_seen_at: string;
    description_status: "complete" | "partial" | "unavailable"; content_hash: string;
    job_fit_band: "high" | "medium" | "low" | "unknown";
    skills: ReturnType<typeof verifiedSignals>;
  }>;
  top_skills: Array<{
    id: string; label: string; distinct_jds: number; distinct_companies: number;
    required_jds: number; preferred_jds: number; mentioned_jds: number;
    supporting_job_ids: string[];
  }>;
  limitations: string[];
  content_digest: string;
}

/** Returns null rather than exporting unsupported trends or a drifted location profile. */
export function buildWeeklyHandoff(
  records: EnrichedArchive[], endSlot: string, generatedAt: string,
  targetLocations = HANDOFF_TARGET_LOCATIONS,
): WeeklyHandoff | null {
  const normalize = (s: string) => s.split(",").map(x => x.trim().toLowerCase()).filter(Boolean).sort().join(",");
  if (normalize(targetLocations) !== normalize(HANDOFF_TARGET_LOCATIONS)) return null;
  const report = buildTrendReport(records, endSlot, generatedAt);
  if (report.status !== "ready") return null;
  const slots = slotRange(endSlot);
  const valid = records.map(x => validateDailyArchive(x))
    .filter(x => slots.includes(x.slot)).sort((a, b) => a.slot.localeCompare(b.slot));
  const byJob = new Map<string, { job: EnrichedJob; first: string; last: string }>();
  for (const day of valid) for (const job of day.jobs) {
    if (!allowedUrl(job.url) || !/^[a-f0-9]{64}$/.test(job.content_hash)) continue;
    const prev = byJob.get(job.id);
    const observed = job.observed_at;
    if (!Number.isFinite(Date.parse(observed))) continue;
    byJob.set(job.id, { job, first: prev?.first ?? observed, last: observed });
  }
  const jds: WeeklyHandoff["jds"] = [...byJob.values()]
    .sort((a, b) => a.job.id.localeCompare(b.job.id)).slice(0, 140)
    .map(({ job, first, last }) => ({
      id: job.id, company_id: job.company_id, company_name: job.company_name,
      title: job.title, url: job.url, location: job.location,
      location_status: job.location_status,
      posted_at: job.posted_at && Number.isFinite(Date.parse(job.posted_at))
        ? new Date(job.posted_at).toISOString() : null,
      first_seen_at: new Date(first).toISOString(), last_seen_at: new Date(last).toISOString(),
      description_status: job.description_status, content_hash: job.content_hash,
      job_fit_band: job.similarity === null || !Number.isFinite(job.similarity)
        ? "unknown" : job.similarity >= 80 ? "high" : job.similarity >= 65 ? "medium" : "low",
      skills: verifiedSignals(job),
    }));
  const counts = new Map<string, { id: string; label: string; companies: Set<string>;
    ids: Set<string>; required: number; preferred: number; mentioned: number }>();
  for (const job of jds) {
    // Never count location-unknown or unreadable descriptions as verified market signals.
    if (job.location_status !== "eligible" || job.description_status === "unavailable") continue;
    for (const signal of job.skills) {
      if (!counts.has(signal.id)) counts.set(signal.id, {
        id: signal.id, label: signal.label, companies: new Set(),
        ids: new Set(), required: 0, preferred: 0, mentioned: 0,
      });
      const c = counts.get(signal.id)!;
      if (c.ids.has(job.id)) continue;
      c.ids.add(job.id); c.companies.add(job.company_id);
      c[signal.requirement]++;
    }
  }
  const top_skills: WeeklyHandoff["top_skills"] = [...counts.values()]
    .sort((a, b) => b.ids.size - a.ids.size || b.companies.size - a.companies.size || a.id.localeCompare(b.id))
    .slice(0, 128)
    .sort((a, b) => a.id.localeCompare(b.id)).map(c => ({
      id: c.id, label: c.label, distinct_jds: c.ids.size,
      distinct_companies: c.companies.size, required_jds: c.required,
      preferred_jds: c.preferred, mentioned_jds: c.mentioned,
      supporting_job_ids: [...c.ids].sort(),
    }));
  const latest = valid[valid.length - 1].source_coverage;
  const coverage: WeeklyHandoff["source_coverage"] = {
    // A per-run observation, not a sum of 14 independent full-market scans.
    configured_readable_companies: latest.attempted,
    companies_attempted: latest.attempted,
    companies_succeeded: latest.attempted - latest.failed,
    companies_failed: latest.failed,
    sampled_jds: jds.length,
    sampled_companies: new Set(jds.map(j => j.company_id)).size,
    ambiguous_location_jds: jds.filter(j => j.location_status === "needs_review").length,
    missing_description_jds: jds.filter(j => j.description_status === "unavailable").length,
  };
  const next = new Date(Date.parse(slots[13] + "T00:00:00Z") + MS_PER_DAY).toISOString();
  const payload = {
    schema_version: 1 as const, week_id: weekId(next.slice(0, 10)),
    window: { from: slots[0] + "T00:00:00Z", to: next },
    generated_at: new Date(generatedAt).toISOString(),
    target_profile_version: HANDOFF_PROFILE_VERSION,
    source_coverage: coverage, jds, top_skills,
    limitations: [
      ...report.limitations,
      "Skill evidence is an automated section/keyword signal, not a JD quote or a verified requirement.",
      "Fit bands are approximate similarity buckets, not interview probabilities.",
      "Source coverage counts refer to the latest sampled daily run, not market-wide employer totals.",
      "Earlier daily artifacts do not attest a target-profile version; confirm each location at application.",
    ].slice(0, 30).map(x => x.slice(0, 320)),
  };
  return { ...payload, content_digest: contentDigest(payload) };
}
