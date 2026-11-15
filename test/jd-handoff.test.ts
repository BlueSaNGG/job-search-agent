import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDailyArchive } from "../src/node/jd-archive.ts";
import { slotRange } from "../src/node/jd-trends.ts";
import { buildWeeklyHandoff, canonicalJson, contentDigest } from "../src/node/jd-weekly-handoff.ts";
import type { DiscoveredJob } from "../src/core/discover/discover.ts";

const END = "2026-11-15";
const SLOTS = slotRange(END);
const TOKEN = "sensitive-resume-content-must-not-leak";

function job(i: number, id: string, company: string, description: string,
  location = "Chicago, IL"): DiscoveredJob {
  return {
    id: company + ":" + id, externalId: id, company, companyName: company,
    title: "Developer Productivity Engineer", location,
    url: "https://example.com/jobs/" + id, category: "SWE", level: "maybe",
    reasons: ["technical"], firstSeen: SLOTS[i] + "T00:00:00Z",
    postedAt: SLOTS[i] + "T00:00:00Z", description,
  };
}

function archive(i: number) {
  const slot = SLOTS[i];
  return buildDailyArchive([
    job(i, "shared", "acme", "Requirements:\nPython and Bazel in CI/CD pipelines"),
    job(i, "new-" + i, "cloud", "Minimum qualifications:\nBuild systems and Docker"),
    job(i, "unknown-" + i, "other", "Kubernetes", "2 Locations"),
  ], null, slot, slot + "T23:00:00.000Z", 56, 1, 3);
}

test("canonical digest agrees with the repository's existing v1 JSON example", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("../docs/rfcs/examples/weekly-handoff.v1.example.json", import.meta.url), "utf8"));
  assert.equal(contentDigest(fixture), fixture.content_digest);
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

test("producer only exports sufficient evidence, valid location profile, and versioned provenance", () => {
  const records = SLOTS.map((_, i) => archive(i));
  const data = buildWeeklyHandoff(records, END, "2026-11-16T14:00:00Z");
  assert.ok(data);
  assert.equal(data.schema_version, 1);
  assert.equal(data.week_id, "2026-W47"); // next Monday's proposal week
  assert.equal(data.window.from, "2026-11-02T00:00:00Z");
  assert.equal(data.window.to, "2026-11-16T00:00:00.000Z");
  assert.equal(data.source_coverage.configured_readable_companies, 56);
  assert.equal(data.source_coverage.companies_failed, 1);
  assert.equal(data.source_coverage.sampled_jds, 29);
  assert.equal(data.source_coverage.ambiguous_location_jds, 14);
  assert.equal(data.jds.length, 29);
  assert.equal(data.jds.find(j => j.id === "acme:shared")?.first_seen_at, "2026-11-02T23:00:00.000Z");
  assert.equal(data.jds.find(j => j.id === "acme:shared")?.last_seen_at, "2026-11-15T23:00:00.000Z");
  const bazel = data.top_skills.find(s => s.id === "bazel")!;
  assert.equal(bazel.distinct_jds, 1);
  assert.equal(bazel.distinct_companies, 1);
  assert.equal(bazel.required_jds, 1);
  assert.ok(bazel.supporting_job_ids.every(id => data.jds.some(j => j.id === id)));
  const skill = data.jds.find(j => j.id === "acme:shared")?.skills.find(s => s.id === "bazel");
  assert.equal(skill?.requirement, "required");
  assert.equal(skill?.section, "requirements");
  assert.match(skill?.evidence ?? "", /Automated keyword/);
  const serialized = JSON.stringify(data);
  assert.doesNotMatch(serialized, /sensitive-resume-content-must-not-leak/);
  assert.doesNotMatch(serialized, /numeric_similarity|raw_description|jd_body/i);
  assert.equal(contentDigest(data), data.content_digest);
});

test("missing daily archives, drifted target profile and broken evidence fail closed", () => {
  assert.equal(buildWeeklyHandoff(SLOTS.slice(0, 4).map((_, i) => archive(i)), END,
    "2026-11-16T14:00:00Z"), null);
  assert.equal(buildWeeklyHandoff(SLOTS.map((_, i) => archive(i)), END,
    "2026-11-16T14:00:00Z", "Beijing, China"), null);
  const records = SLOTS.map((_, i) => archive(i));
  records[0].jobs[0].url = "http://unsafe.example/jobs/1";
  assert.throws(() => buildWeeklyHandoff(records, END, "2026-11-16T14:00:00Z"),
    /Malformed or duplicate job evidence/); // invalid source data is rejected, never silently sanitized
  const result = buildWeeklyHandoff(SLOTS.map((_, i) => archive(i)), END, "2026-11-16T14:00:00Z");
  assert.ok(result);
  assert.ok(result.jds.every(j => j.url.startsWith("https://")));
  const copy = structuredClone(result);
  copy.jds[0].title += TOKEN;
  assert.notEqual(contentDigest(copy), copy.content_digest);
});
