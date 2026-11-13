import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eligibleArtifacts, ciphertextFromZip } from "../src/node/jd-artifact-reader.ts";
import { buildDailyArchive, encryptArchive } from "../src/node/jd-archive.ts";
import { buildTrendReport, completedChicagoSlot, renderTrendMarkdown, slotRange, validateDailyArchive } from "../src/node/jd-trends.ts";
import type { DiscoveredJob } from "../src/core/discover/discover.ts";

function job(id: string, company = "acme", description = "Build systems using Bazel"): DiscoveredJob {
  return {
    id: company + ":" + id, externalId: id, company, companyName: company,
    title: "Infrastructure Engineer", location: "Chicago, IL",
    url: "https://example.com/" + id, category: "SWE", level: "maybe",
    reasons: ["relevant"], firstSeen: "2026-11-01T00:00:00Z",
    postedAt: "2026-11-01T00:00:00Z", description,
  };
}

const END = "2026-11-15";
const SLOTS = slotRange(END);
function daily(index: number) {
  const slot = SLOTS[index];
  const descriptions = index < 7 ? "Build systems with Kubernetes and Bazel" : "Build systems with Python and Bazel";
  const jobs = [
    job("shared", "acme", "Bazel CI/CD pipelines"),
    job("job-a-" + index, "company-a", descriptions),
    job("job-b-" + index, "company-b", descriptions),
  ];
  return buildDailyArchive(jobs, null, slot, slot + "T23:00:00.000Z", 56, 1, 3);
}

test("14 Chicago calendar slots stay stable across DST and validate leap dates", () => {
  assert.equal(SLOTS.length, 14);
  assert.equal(SLOTS[0], "2026-11-02");
  assert.equal(SLOTS[13], "2026-11-15");
  assert.equal(completedChicagoSlot(new Date("2026-11-16T16:00:00Z")), END);
  assert.equal(slotRange("2028-03-01")[0], "2028-02-17");
  assert.throws(() => slotRange("2026-02-30"));
});

test("full 14-slot report deduplicates recurring posting IDs and counts two halves", () => {
  const records = SLOTS.map((_, i) => daily(i));
  const report = buildTrendReport(records, END, "2026-11-16T00:00:00.000Z");
  assert.equal(report.status, "ready");
  assert.equal(report.window.observed_slots, 14);
  assert.equal(report.sample.unique_jobs, 29); // shared job + 2 unique jobs/day
  assert.equal(report.sample.unique_companies, 3);
  assert.equal(report.sample.previous_evidence_jobs, 15);
  assert.equal(report.sample.recent_evidence_jobs, 15);
  assert.equal(report.source_coverage.attempts, 14 * 56);
  assert.equal(report.source_coverage.failures, 14);
  const python = report.skills.find(s => s.id === "python")!;
  const kubernetes = report.skills.find(s => s.id === "kubernetes")!;
  const bazel = report.skills.find(s => s.id === "bazel")!;
  assert.equal(python.previous_jobs, 0);
  assert.equal(python.recent_jobs, 14);
  assert.equal(kubernetes.previous_jobs, 14);
  assert.equal(kubernetes.recent_jobs, 0);
  assert.equal(bazel.jobs, 29);
  assert.equal(bazel.companies, 3);
  assert.ok(python.delta_percentage_points! > 0);
  assert.ok(kubernetes.delta_percentage_points! < 0);
  assert.equal(report.sample.ambiguous_location_jobs, 0);
});

test("missing slots and source outages produce insufficient evidence, no delta claims", () => {
  const missing = buildTrendReport(SLOTS.slice(7).map((_, i) => daily(i + 7)), END);
  assert.equal(missing.status, "insufficient_evidence");
  assert.equal(missing.window.missing_slots.length, 7);
  assert.ok(missing.skills.every(s => s.delta_percentage_points === null));
  const markdown = renderTrendMarkdown(missing);
  assert.match(markdown, /No trend inference/);
  assert.doesNotMatch(markdown, /\| Skill \(normalized\)/);
  const outage = SLOTS.map((_, i) => {
    const d = daily(i);
    d.source_coverage.failed = 35;
    return d;
  });
  assert.equal(buildTrendReport(outage, END).status, "insufficient_evidence");
  const empty = buildTrendReport([], END);
  assert.equal(empty.status, "insufficient_evidence");
  assert.equal(empty.source_coverage.failure_rate_pct, null);
});

test("ambiguous location and absent description are not eligible evidence", () => {
  const days = SLOTS.map((_, i) => {
    const d = daily(i);
    d.jobs[1].location_status = "needs_review";
    d.jobs[2].description_status = "unavailable";
    return d;
  });
  const report = buildTrendReport(days, END);
  assert.equal(report.sample.ambiguous_location_jobs, 14);
  assert.equal(report.sample.unavailable_description_jobs, 14);
  assert.equal(report.sample.evidence_eligible_jobs, 1);
  assert.equal(report.status, "insufficient_evidence");
  assert.equal(report.skills.find(s => s.id === "bazel")!.jobs, 1);
});

test("schema and provenance validation catches dupes, fake slots and missing fields", () => {
  const good = daily(0);
  assert.equal(validateDailyArchive(good, SLOTS[0]).jobs.length, 3);
  assert.throws(() => validateDailyArchive(good, SLOTS[1]));
  const duplicate = structuredClone(good);
  duplicate.jobs.push(duplicate.jobs[0]);
  duplicate.source_coverage.saved++;
  assert.throws(() => validateDailyArchive(duplicate));
  const corrupted = structuredClone(good);
  corrupted.jobs[0].content_hash = "bad";
  assert.throws(() => validateDailyArchive(corrupted));
  const report = buildTrendReport(SLOTS.map((_, i) => daily(i)), END);
  assert.doesNotMatch(JSON.stringify(report), /https:\/\/example\.com|Bazel CI\/CD pipelines/);
  assert.throws(() => buildTrendReport([good, good], END), /Duplicate slot/);
});

test("section-tagged skills count as required/preferred, legacy archive as mentioned", () => {
  const records = SLOTS.map((_, i) => {
    const d = daily(i);
    (d.jobs[0] as any).skill_signals = [
      { id: "bazel", requirement: "required", section: "minimum_qualifications" },
      { id: "ci_cd", requirement: "preferred", section: "preferred_qualifications" },
    ];
    return d;
  });
  const report = buildTrendReport(records, END);
  const bazel = report.skills.find(s => s.id === "bazel")!;
  assert.equal(bazel.required, 1);
  assert.equal(bazel.mentioned, 28);
  assert.equal(report.skills.find(s => s.id === "ci_cd")!.preferred, 1);
});

test("artifact candidate selection is bounded, skips expired and prefers newer reruns", () => {
  const sample = (id: number, date: string, slot = SLOTS[0]) => ({
    id, name: "jd-intelligence-" + slot, expired: false,
    created_at: date, size_in_bytes: 1234, workflow_run: { id },
  });
  const groups = eligibleArtifacts([
    sample(11, "2026-11-13T01:00:00Z"),
    sample(12, "2026-11-13T02:00:00Z"),
    { ...sample(13, "2026-11-13T03:00:00Z"), expired: true },
    sample(14, "2026-11-01T01:00:00Z", "2026-11-01"),
  ], END);
  assert.deepEqual(groups.get(SLOTS[0])?.map(x => x.id), [12, 11]);
  assert.equal(groups.has("2026-11-01"), false);
});

test("ZIP extraction accepts only one ciphertext file, rejects extra entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "jd-trends-zip-test-"));
  try {
    const path = join(dir, "jd-intelligence-slot.enc");
    const zip = join(dir, "test.zip");
    const encrypted = encryptArchive(daily(0), "independent-test-key-longer-than-thirty-two-chars");
    writeFileSync(path, encrypted);
    execFileSync("zip", ["-q", "-j", zip, path]);
    assert.deepEqual(ciphertextFromZip(readFileSync(zip)), encrypted);
    const extra = join(dir, "other.txt");
    writeFileSync(extra, "unwanted");
    execFileSync("zip", ["-q", "-j", zip, extra]);
    assert.throws(() => ciphertextFromZip(readFileSync(zip)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
