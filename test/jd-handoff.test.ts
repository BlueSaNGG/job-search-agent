import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDailyArchive } from "../src/node/jd-archive.ts";
import { slotRange } from "../src/node/jd-trends.ts";
import { buildWeeklyHandoff, canonicalJson, contentDigest, slotStart } from "../src/node/jd-weekly-handoff.ts";
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
  ], null, slot, new Date(slotStart(slot).getTime() + 17 * 60000).toISOString(), 56, 1, 3);
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
  assert.equal(data.window.from, "2026-11-03T01:00:00.000Z");
  assert.equal(data.window.to, "2026-11-17T01:00:00.000Z");
  assert.equal(data.source_coverage.configured_readable_companies, 56);
  assert.equal(data.source_coverage.companies_failed, 1);
  assert.equal(data.source_coverage.sampled_jds, 29);
  assert.equal(data.source_coverage.ambiguous_location_jds, 14);
  assert.equal(data.jds.length, 29);
  assert.equal(data.jds.find(j => j.id === "acme:shared")?.first_seen_at, "2026-11-03T01:17:00.000Z");
  assert.equal(data.jds.find(j => j.id === "acme:shared")?.last_seen_at, "2026-11-16T01:17:00.000Z");
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


test("canonical ID order and Chicago DST/retry boundaries", () => {
  const records = SLOTS.map((_, i) => archive(i));
  records[0].jobs[0].id = "acme:Z1";
  records[1].jobs[0].id = "acme:a1";
  const data = buildWeeklyHandoff(records, END, "2026-11-16T14:00:00Z")!;
  assert.ok(data);
  assert.deepEqual(data.jds.map(j => j.id), data.jds.map(j => j.id).sort());
  assert.equal(slotStart("2026-10-31").toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(slotStart("2026-11-01").toISOString(), "2026-11-02T01:00:00.000Z");
  records[0].jobs[0].observed_at = "2025-01-01T00:00:00Z";
  assert.equal(buildWeeklyHandoff(records, END, "2026-11-16T14:00:00Z"), null);
  records[0].jobs[0].observed_at = "2026-11-04T01:00:00Z";
  assert.equal(buildWeeklyHandoff(records, END, "2026-11-16T14:00:00Z"), null);
});

test("14 daily slots spanning DST are not assumed to be 336 hours", () => {
  const dates = slotRange("2026-11-05");
  const records = dates.map((date, i) => {
    const d = archive(i); d.slot = date;
    d.observed_at = new Date(slotStart(date).getTime() + 60000).toISOString();
    for (const j of d.jobs) j.observed_at = d.observed_at;
    return d;
  });
  const result = buildWeeklyHandoff(records, "2026-11-05", "2026-11-06T14:00:00Z")!;
  assert.ok(result);
  assert.equal((Date.parse(result.window.to) - Date.parse(result.window.from))/3600000, 337);
});
