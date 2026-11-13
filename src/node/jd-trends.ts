// Sample-aware JD skill trends. This consumes only encrypted daily snapshots
// after they have been decrypted in memory; no resume or raw JD is loaded here.
import type { DailyArchive } from "./jd-archive.ts";

export type DailyJob = DailyArchive["jobs"][number];
export type SkillRequirement = "required" | "preferred" | "mentioned";
export type JobSkillSignal = { id: string; requirement: SkillRequirement; section: string };
export type EnrichedJob = DailyJob & { skill_signals?: JobSkillSignal[] };
export type EnrichedArchive = Omit<DailyArchive, "jobs"> & { jobs: EnrichedJob[] };

const MS_PER_DAY = 86_400_000;
const HEX64 = /^[a-f0-9]{64}$/;
const SLOT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_SLOTS = 10;
const MIN_PER_HALF = 4;
const MAX_SOURCE_FAILURE_RATE = 0.25;

function validSlot(slot: string): boolean {
  if (!SLOT_PATTERN.test(slot)) return false;
  const d = new Date(slot + "T00:00:00.000Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === slot;
}

export function slotRange(endSlot: string): string[] {
  if (!validSlot(endSlot)) throw new Error("Invalid calendar end slot");
  const end = Date.parse(endSlot + "T00:00:00.000Z");
  return Array.from({ length: 14 }, (_, i) =>
    new Date(end - (13 - i) * MS_PER_DAY).toISOString().slice(0, 10));
}

/** Default to the last fully completed Chicago daily slot, not today's partial run. */
export function completedChicagoSlot(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const field = (name: string) => parts.find(x => x.type === name)?.value ?? "";
  const today = field("year") + "-" + field("month") + "-" + field("day");
  if (!validSlot(today)) throw new Error("Unable to determine Chicago slot");
  return new Date(Date.parse(today + "T00:00:00Z") - MS_PER_DAY).toISOString().slice(0, 10);
}

const asCount = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const asString = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 2048;

/**
 * Runtime validation is required: JSON returned by AES-GCM is authenticated,
 * but a mistaken producer revision or old schema can still break aggregation.
 */
export function validateDailyArchive(input: unknown, expectedSlot?: string): EnrichedArchive {
  if (typeof input !== "object" || input === null) throw new Error("Bad daily archive");
  const a = input as Partial<EnrichedArchive>;
  if (a.schema_version !== 1 || !asString(a.slot) || !validSlot(a.slot) ||
      (expectedSlot && a.slot !== expectedSlot) || !asString(a.observed_at) ||
      !Number.isFinite(Date.parse(a.observed_at)) || !Array.isArray(a.jobs) ||
      !a.source_coverage || typeof a.source_coverage !== "object" ||
      !["resume_embedding", "unranked"].includes(String(a.ranking_method))) {
    throw new Error("Unsupported or malformed daily archive");
  }
  const cov = a.source_coverage;
  if (![cov.attempted, cov.failed, cov.eligible, cov.candidates_considered, cov.saved].every(asCount) ||
      cov.attempted <= 0 || cov.failed > cov.attempted ||
      cov.saved !== a.jobs.length || cov.eligible < cov.saved ||
      cov.candidates_considered < cov.saved || a.jobs.length > 10) {
    throw new Error("Inconsistent daily archive coverage");
  }
  const ids = new Set<string>();
  for (const j of a.jobs) {
    if (!j || !asString(j.id) || !asString(j.company_id) ||
        !asString(j.title) || !asString(j.url) || !/^https:\/\//i.test(j.url) ||
        typeof j.location !== "string" ||
        !["eligible", "needs_review"].includes(j.location_status) ||
        !["complete", "partial", "unavailable"].includes(j.description_status) ||
        !HEX64.test(j.content_hash) ||
        !Array.isArray(j.skill_mentions) ||
        !j.skill_mentions.every(x => typeof x === "string" && /^[a-z][a-z0-9_]{0,60}$/.test(x)) ||
        (j.skill_signals !== undefined &&
          (!Array.isArray(j.skill_signals) || !j.skill_signals.every(s =>
            s && /^[a-z][a-z0-9_]{0,60}$/.test(s.id) &&
            ["required", "preferred", "mentioned"].includes(s.requirement) &&
            typeof s.section === "string" && s.section.length <= 40))) ||
        ids.has(j.id)) {
      throw new Error("Malformed or duplicate job evidence");
    }
    ids.add(j.id);
  }
  return a as EnrichedArchive;
}

export interface SkillStat {
  id: string;
  jobs: number;
  companies: number;
  required: number;
  preferred: number;
  mentioned: number;
  previous_jobs: number;
  recent_jobs: number;
  previous_share_pct: number | null;
  recent_share_pct: number | null;
  delta_percentage_points: number | null;
}

export interface TrendReport {
  schema_version: "jd-trends.v1";
  status: "ready" | "insufficient_evidence";
  generated_at: string;
  window: { from_slot: string; to_slot: string; expected_slots: 14; observed_slots: number; missing_slots: string[] };
  source_coverage: { attempts: number; failures: number; failure_rate_pct: number | null };
  sample: {
    unique_jobs: number;
    unique_companies: number;
    updated_jobs: number;
    evidence_eligible_jobs: number;
    skill_evidence_jobs: number;
    recent_evidence_jobs: number;
    previous_evidence_jobs: number;
    ambiguous_location_jobs: number;
    unavailable_description_jobs: number;
    partial_description_jobs: number;
    missing_skill_evidence_jobs: number;
    slots_previous: number;
    slots_recent: number;
  };
  skills: SkillStat[];
  limitations: string[];
}

function latestWithinWindow(archives: EnrichedArchive[], slots: Set<string>): Map<string, EnrichedJob> {
  const byId = new Map<string, EnrichedJob>();
  for (const day of [...archives].sort((a, b) => a.slot.localeCompare(b.slot))) {
    if (!slots.has(day.slot)) continue;
    for (const j of day.jobs) byId.set(j.id, j);
  }
  return byId;
}

function isEvidenceEligible(j: EnrichedJob): boolean {
  return j.location_status === "eligible" && j.description_status !== "unavailable";
}

function normalizedSignals(j: EnrichedJob): Map<string, SkillRequirement> {
  const out = new Map<string, SkillRequirement>();
  const signals = j.skill_signals ??
    j.skill_mentions.map(id => ({ id, requirement: "mentioned" as const, section: "unknown" }));
  const level: Record<SkillRequirement, number> = { mentioned: 0, preferred: 1, required: 2 };
  for (const s of signals) {
    const old = out.get(s.id);
    if (!old || level[s.requirement] > level[old]) out.set(s.id, s.requirement);
  }
  return out;
}

function sampleSkillCounts(jobs: Map<string, EnrichedJob>): Map<string, Set<string>> {
  const counts = new Map<string, Set<string>>();
  for (const j of jobs.values()) {
    if (!isEvidenceEligible(j)) continue;
    for (const id of normalizedSignals(j).keys()) {
      if (!counts.has(id)) counts.set(id, new Set());
      counts.get(id)!.add(j.id);
    }
  }
  return counts;
}

function percentage(n: number, d: number): number | null {
  return d > 0 ? Math.round(n / d * 1000) / 10 : null;
}

/**
 * Count distinct posting IDs, not daily appearances. One posting may
 * contribute once to each half; delta means share of selected opportunities,
 * never an estimate of whole-market job creation.
 */
export function buildTrendReport(
  records: EnrichedArchive[],
  endSlot: string,
  generatedAt = new Date().toISOString(),
): TrendReport {
  const slots = slotRange(endSlot), slotSet = new Set(slots);
  const validated = new Map<string, EnrichedArchive>();
  for (const record of records) {
    const v = validateDailyArchive(record);
    if (!slotSet.has(v.slot)) continue;
    if (validated.has(v.slot)) throw new Error("Duplicate slot records: resolve authoritative run first");
    validated.set(v.slot, v);
  }
  const days = [...validated.values()];
  const previousSet = new Set(slots.slice(0, 7)), recentSet = new Set(slots.slice(7));
  const previous = latestWithinWindow(days, previousSet);
  const recent = latestWithinWindow(days, recentSet);
  const all = latestWithinWindow(days, slotSet);
  const eligibleAll = [...all.values()].filter(isEvidenceEligible);
  const eligiblePrevious = [...previous.values()].filter(isEvidenceEligible);
  const eligibleRecent = [...recent.values()].filter(isEvidenceEligible);
  const skillEvidenceAll = eligibleAll.filter(j => normalizedSignals(j).size > 0);
  const skillEvidencePrevious = eligiblePrevious.filter(j => normalizedSignals(j).size > 0);
  const skillEvidenceRecent = eligibleRecent.filter(j => normalizedSignals(j).size > 0);
  const observedHashes = new Map<string, Set<string>>();
  for (const day of days) for (const j of day.jobs) {
    if (!observedHashes.has(j.id)) observedHashes.set(j.id, new Set());
    observedHashes.get(j.id)!.add(j.content_hash);
  }
  const updatedJobs = [...observedHashes.values()].filter(h => h.size > 1).length;
  const previousCounts = sampleSkillCounts(previous);
  const recentCounts = sampleSkillCounts(recent);
  const allCounts = sampleSkillCounts(all);
  const sourceAttempts = days.reduce((n, d) => n + d.source_coverage.attempted, 0);
  const sourceFailures = days.reduce((n, d) => n + d.source_coverage.failed, 0);
  const missingSlots = slots.filter(slot => !validated.has(slot));
  const previousSlots = slots.slice(0, 7).filter(s => validated.has(s)).length;
  const recentSlots = slots.slice(7).filter(s => validated.has(s)).length;
  const rate = percentage(sourceFailures, sourceAttempts);
  const good = days.length >= MIN_SLOTS && previousSlots >= MIN_PER_HALF &&
    recentSlots >= MIN_PER_HALF && eligibleAll.length >= 10 &&
    eligiblePrevious.length >= 5 && eligibleRecent.length >= 5 &&
    skillEvidenceAll.length >= 8 && skillEvidencePrevious.length >= 3 &&
    skillEvidenceRecent.length >= 3 && rate !== null && rate <= MAX_SOURCE_FAILURE_RATE * 100;

  const statuses = new Map<string, { required: number; preferred: number; mentioned: number; companies: Set<string> }>();
  for (const job of eligibleAll) {
    for (const [id, requirement] of normalizedSignals(job)) {
      if (!statuses.has(id)) statuses.set(id, { required: 0, preferred: 0, mentioned: 0, companies: new Set() });
      const s = statuses.get(id)!;
      s[requirement]++;
      s.companies.add(job.company_id);
    }
  }

  const skills: SkillStat[] = [...statuses.entries()].map(([id, s]) => {
    const p = previousCounts.get(id)?.size ?? 0, r = recentCounts.get(id)?.size ?? 0;
    const prevPct = good ? percentage(p, eligiblePrevious.length) : null;
    const recPct = good ? percentage(r, eligibleRecent.length) : null;
    return {
      id, jobs: allCounts.get(id)?.size ?? 0, companies: s.companies.size,
      required: s.required, preferred: s.preferred, mentioned: s.mentioned,
      previous_jobs: p, recent_jobs: r,
      previous_share_pct: prevPct, recent_share_pct: recPct,
      delta_percentage_points: prevPct !== null && recPct !== null
        ? Math.round((recPct - prevPct) * 10) / 10 : null,
    };
  }).sort((a, b) => b.jobs - a.jobs || b.companies - a.companies || a.id.localeCompare(b.id));

  const limitations = [
    "仅统计每天优先筛选的最多 10 个岗位，不代表整体招聘市场。",
    "同一岗位可能出现在前后两个 7 天窗口；占比变化不是招聘职位增长率。",
    "每日描述可能截断至 4,000 字符；没有匹配关键词不等于职位不要求该技能。",
    "Required/Preferred 仅根据可识别的描述小节推断，其余标为 mentioned；不是人工核验的招聘要求。",
    "缺少自动读取的招聘源和地点不明确的岗位不作为已验证的技能证据。",
  ];
  if (!good) limitations.unshift("insufficient_evidence：档案覆盖、职位样本或招聘源完整度不足，禁止根据此报告推断技能需求上升或下降。");
  if (missingSlots.length) limitations.push("缺少 " + missingSlots.length + " 个日归档；缺失不能解释为当天没有招聘需求。");
  if (sourceFailures) limitations.push("已有日归档报告 " + sourceFailures + " 次招聘源读取失败（分母 " + sourceAttempts + " 次尝试）。");

  return {
    schema_version: "jd-trends.v1", status: good ? "ready" : "insufficient_evidence",
    generated_at: generatedAt,
    window: { from_slot: slots[0], to_slot: slots[13], expected_slots: 14,
      observed_slots: days.length, missing_slots: missingSlots },
    source_coverage: { attempts: sourceAttempts, failures: sourceFailures, failure_rate_pct: rate },
    sample: {
      unique_jobs: all.size, unique_companies: new Set([...all.values()].map(j => j.company_id)).size,
      updated_jobs: updatedJobs,
      evidence_eligible_jobs: eligibleAll.length,
      skill_evidence_jobs: skillEvidenceAll.length,
      recent_evidence_jobs: eligibleRecent.length,
      previous_evidence_jobs: eligiblePrevious.length,
      ambiguous_location_jobs: [...all.values()].filter(j => j.location_status !== "eligible").length,
      unavailable_description_jobs: [...all.values()].filter(j => j.description_status === "unavailable").length,
      partial_description_jobs: [...all.values()].filter(j => j.description_status === "partial").length,
      missing_skill_evidence_jobs: eligibleAll.filter(j => normalizedSignals(j).size === 0).length,
      slots_previous: previousSlots, slots_recent: recentSlots,
    },
    skills: skills.slice(0, 30), limitations,
  };
}

export function renderTrendMarkdown(report: TrendReport): string {
  const s = report.sample, w = report.window;
  const lines = [
    "# JD Skill Trends (Top-10 selected opportunities)",
    "",
    "**Status:** " + report.status + " · **Window:** " + w.from_slot + " to " + w.to_slot + " (Chicago daily slots)",
    "",
    "This is a selected-job sample, **not the overall job market**. No resume or raw job descriptions are included.",
    "",
    "- Daily archives: " + w.observed_slots + "/14 (previous " + s.slots_previous + "/7; recent " + s.slots_recent + "/7)",
    "- Distinct sampled jobs / companies: " + s.unique_jobs + " / " + s.unique_companies,
    "- Observed content revisions (distinct job IDs): " + s.updated_jobs,
    "- JDs with usable skill evidence: " + s.skill_evidence_jobs,
    "- Evidence-eligible jobs (verified location and readable description): " + s.evidence_eligible_jobs,
    "- Source attempts / failures: " + report.source_coverage.attempts + " / " + report.source_coverage.failures,
    "- Ambiguous locations / unavailable descriptions / partial descriptions: " +
      s.ambiguous_location_jobs + " / " + s.unavailable_description_jobs + " / " + s.partial_description_jobs,
    "",
  ];
  if (report.status === "ready") {
    lines.push("| Skill (normalized) | Unique JDs | Companies | Required | Preferred | Mentioned | Previous 7d | Recent 7d | Δ sample share (pp) |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const x of report.skills) {
      lines.push("| " + x.id + " | " + x.jobs + " | " + x.companies + " | " +
        x.required + " | " + x.preferred + " | " + x.mentioned + " | " +
        x.previous_jobs + " | " + x.recent_jobs + " | " +
        (x.delta_percentage_points === null ? "n/a" : String(x.delta_percentage_points)) + " |");
    }
    if (!report.skills.length) lines.push("No supported skill mentions in the eligible sample.");
  } else {
    lines.push("**No trend inference.** Archive coverage or evidence did not pass the thresholds.");
  }
  lines.push("", "## Limitations", "");
  for (const limitation of report.limitations) lines.push("- " + limitation);
  lines.push("");
  return lines.join("\n");
}
