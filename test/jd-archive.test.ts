import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import type { DiscoveredJob } from "../src/core/discover/discover.ts";
import { ARCHIVE_PATH, buildDailyArchive, chooseArchiveCandidates, decryptArchive, encryptArchive, extractSkillMentions, extractSkillSignals, saveDailyArchive, selectDailyTop } from "../src/node/jd-archive.ts";
import { filterScanMatches } from "../src/node/scan.ts";

const DATE = "2026-11-12T20:00:00.000Z";
const key = "unit-test-example-long-passphrase-keep-out-of-production";
function job(id: string, company = "a", opts: Partial<DiscoveredJob> = {}): DiscoveredJob {
  return {
    id: company + ":" + id,
    externalId: id,
    company, companyName: company,
    title: "Software Engineer, Infrastructure",
    location: "Chicago, IL",
    url: "https://example.com/job/" + id,
    category: "SWE", level: "maybe", reasons: ["infrastructure"],
    firstSeen: DATE,
    postedAt: "2026-11-10T00:00:00.000Z",
    description: "Own Kubernetes and CI pipelines. Full JD content is never persisted.",
    ...opts,
  };
}

test("shared scan filtering preserves experienced US/China jobs", () => {
  const jobs = [
    job("us"), job("cn", "b", { location: "Shanghai, China" }),
    job("entry", "c", { level: "entry" }),
    job("outside", "d", { location: "Bengaluru, India" }),
  ];
  const result = filterScanMatches(jobs, ["US_MAJOR_METROS", "Shanghai", "Hangzhou"], 0);
  assert.deepEqual(result.relevant.map(j => j.id), ["a:us", "b:cn"]);
  assert.equal(result.underpaid.length, 0);
});

test("candidate pool deduplicates by stable ID, keeps undated, drops stale dated", () => {
  const jobs = [
    job("new"), job("new"), job("old", "b", { postedAt: "2026-09-01T00:00:00Z" }),
    job("undated", "c", { postedAt: undefined }),
  ];
  const pool = chooseArchiveCandidates(jobs, Date.parse(DATE));
  assert.deepEqual(pool.map(j => j.id).sort(), ["a:new", "c:undated"]);
});

test("archive candidate window includes exactly 14 days, but not older posts", () => {
  const now = Date.parse(DATE);
  const boundary = new Date(now - 14 * 86_400_000).toISOString();
  const older = new Date(now - 14 * 86_400_000 - 1).toISOString();
  const chosen = chooseArchiveCandidates([
    job("on-boundary", "b", { postedAt: boundary }),
    job("older", "c", { postedAt: older }),
  ], now);
  assert.deepEqual(chosen.map(x => x.id), ["b:on-boundary"]);
});

test("scored ties use company then ID, while unranked fallback prioritizes infra", () => {
  const roles = [
    job("z", "zebra", { title: "Developer Productivity Engineer" }),
    job("b", "alpha", { title: "General Software Engineer" }),
    job("a", "alpha", { title: "General Software Engineer" }),
  ];
  const scores = Object.fromEntries(roles.map(x => [x.id, 80]));
  assert.deepEqual(
    selectDailyTop(roles, { scores, notes: {} }).map(x => x.id),
    ["alpha:a", "alpha:b", "zebra:z"],
  );
  assert.equal(selectDailyTop(roles, null)[0].id, "zebra:z");
});

test("Top 10 shortlist favors scored matching roles and company diversity", () => {
  const jobs = [
    ...Array.from({ length: 8 }, (_, i) => job("a" + i, "a")),
    ...Array.from({ length: 8 }, (_, i) => job("b" + i, "b")),
    ...Array.from({ length: 8 }, (_, i) => job("c" + i, "c")),
    ...Array.from({ length: 8 }, (_, i) => job("d" + i, "d")),
    ...Array.from({ length: 8 }, (_, i) => job("e" + i, "e")),
  ];
  const scores = Object.fromEntries(jobs.map((j, i) => [j.id, 99 - i]));
  const selected = selectDailyTop(jobs, { scores, notes: {} }, 10);
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map(x => x.id)).size, 10);
  assert.equal(new Set(selected.map(x => x.company)).size, 5);
  for (const company of ["a", "b", "c", "d", "e"])
    assert.equal(selected.filter(x => x.company === company).length, 2);
});

test("Daily Archive contains metadata and version hashes, never full JD text or resume", () => {
  const jobs = [job("x", "a", { location: "2 Locations" })];
  const archive = buildDailyArchive(jobs, null, "2026-11-12", DATE, 56, 1, 1);
  assert.equal(archive.source_coverage.saved, 1);
  assert.equal(archive.ranking_method, "unranked");
  assert.equal(archive.jobs[0].similarity, null);
  assert.equal(archive.jobs[0].location_status, "needs_review");
  assert.match(archive.jobs[0].content_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(archive).includes("Own Kubernetes"), false);
  const changed = buildDailyArchive(
    [job("x", "a", { description: "A changed JD" })], null, "2026-11-12", DATE, 56, 0, 1,
  );
  assert.notEqual(changed.jobs[0].content_hash, archive.jobs[0].content_hash);
});

test("AES-GCM ciphertext round-trips, uses randomized nonces and detects tampering", () => {
  const archive = buildDailyArchive([job("x")], null, "2026-11-12", DATE, 56, 0, 1);
  const x = encryptArchive(archive, key);
  const y = encryptArchive(archive, key);
  assert.notDeepEqual(x, y);
  assert.equal(x.includes(Buffer.from("Software Engineer")), false);
  assert.deepEqual(decryptArchive(x, key), archive);
  assert.throws(() => decryptArchive(x, "wrong-passphrase-wrong-passphrase-wrong"), /authenticate|Unsupported state|bad decrypt/i);
  const corrupted = Buffer.from(x);
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => decryptArchive(corrupted, key));
  assert.throws(() => encryptArchive(archive, "short"));
});

test("Skill mentions are normalized, bounded and do not imply required status", () => {
  const labels = extractSkillMentions("Build systems using Bazel, Kubernetes, Python and CI/CD.");
  assert.deepEqual(labels, ["ci_cd", "build_systems", "bazel", "kubernetes", "python"]);
  const archive = buildDailyArchive([job("skills", "a", {
    description: "Bazel build infrastructure with Kubernetes",
  })], null, "2026-11-12", DATE, 56, 0, 1);
  assert.deepEqual(archive.jobs[0].skill_mentions, ["build_systems", "bazel", "kubernetes"]);
  assert.equal(JSON.stringify(archive).includes("build infrastructure with"), false);
});

test("section headings infer required/preferred; unheaded terms remain mentioned", () => {
  const signals = extractSkillSignals(
    "Requirements:\n- Bazel and Kubernetes\nPreferred Qualifications:\n- C++ and CMake\nResponsibilities:\n- CI/CD pipelines",
  );
  const match = Object.fromEntries(signals.map(s => [s.id, [s.requirement, s.section]]));
  assert.deepEqual(match.bazel, ["required", "minimum_qualifications"]);
  assert.deepEqual(match.kubernetes, ["required", "minimum_qualifications"]);
  assert.deepEqual(match.cpp, ["preferred", "preferred_qualifications"]);
  assert.deepEqual(match.cmake, ["preferred", "preferred_qualifications"]);
  assert.deepEqual(match.ci_cd, ["mentioned", "responsibilities"]);
  assert.deepEqual(extractSkillSignals("Bazel and Kubernetes"), [
    { id: "bazel", requirement: "mentioned", section: "unknown" },
    { id: "kubernetes", requirement: "mentioned", section: "unknown" },
  ]);
});

test("section-aware extraction supports Chinese headings without archiving raw sentences", () => {
  const desc = "任职要求：熟悉 Docker 和 Python\n加分项：有 Bazel 项目经验";
  const archive = buildDailyArchive([job("zh", "a", { description: desc })], null, "2026-11-12", DATE, 56, 0, 1);
  assert.deepEqual(archive.jobs[0].skill_signals, [
    { id: "docker", requirement: "required", section: "minimum_qualifications" },
    { id: "python", requirement: "required", section: "minimum_qualifications" },
    { id: "bazel", requirement: "preferred", section: "preferred_qualifications" },
  ]);
  assert.equal(JSON.stringify(archive).includes("熟悉"), false);
});

test("Archive selection is independent of mail seen-state and permits zero jobs", () => {
  const recent = job("same-previously-emailed");
  const pool = chooseArchiveCandidates([recent], Date.parse(DATE));
  const archive = buildDailyArchive(pool, { scores: { [recent.id]: 88 }, notes: {} }, "2026-11-12", DATE, 56, 0, 1);
  assert.equal(archive.jobs[0].similarity, 88);
  assert.equal(archive.ranking_method, "resume_embedding");
  const empty = buildDailyArchive([], null, "2026-11-12", DATE, 56, 0, 0);
  assert.equal(empty.jobs.length, 0);
  assert.throws(() => buildDailyArchive([], null, "invalid", DATE, 56, 0, 0));
});

test("Archive ranking opt-out does not read resume or call Workers AI", async () => {
  const before = process.env.JD_INTEL_KEY;
  process.env.JD_INTEL_KEY = key;
  let resumeLoads = 0;
  try {
    await saveDailyArchive(
      [job("not-ranked")], { attempted: 56, failed: [] }, "2026-11-12",
      async () => { resumeLoads++; throw new Error("Must not read resume"); },
      new Date(DATE), false,
    );
    assert.equal(resumeLoads, 0);
    assert.ok(existsSync(ARCHIVE_PATH));
  } finally {
    if (existsSync(ARCHIVE_PATH)) unlinkSync(ARCHIVE_PATH);
    if (before === undefined) delete process.env.JD_INTEL_KEY;
    else process.env.JD_INTEL_KEY = before;
  }
});
