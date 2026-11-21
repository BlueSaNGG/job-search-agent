import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportBoard, merge, publish } from "../src/node/leaderboard.ts";

test("overflow candidates surface after expiry; retries preserve publication", t => {
  const dir = mkdtempSync(join(tmpdir(), "leaderboard-"));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const input = join(dir, "input"), state = join(dir, "state"), board = join(dir, "board");
  const read = () => readFileSync(board,"utf8");
  function run(slot: string, count: number, score: number) {
    const jobs = Array.from({length:count}, (_,i) => ({
      id: slot + i, externalId: String(i), company:"acme",companyName:"Acme", title:"Engineer",
      category:"SWE" as const,level:"maybe" as const, location:"2 Locations",url:"https://example.com",
      firstSeen:slot,description:"private sentinel",reasons:["private sentinel"],
    }));
    exportBoard(input,slot,jobs,Object.fromEntries(jobs.map(j => [j.id,score])));
    publish(input,state,board);
    for (const file of [input,state,board]) assert.ok(!readFileSync(file,"utf8").includes("private sentinel"));
  }
  run("2026-10-31",20,95);
  run("2026-11-01",20,75);
  run("2026-11-06",0,0);
  assert.equal(JSON.parse(read()).entries[0].similarity,95);
  run("2026-11-07",0,0);
  const saved = read(), snapshot = JSON.parse(saved);
  assert.equal(snapshot.entries.length,20);
  assert.ok(snapshot.entries.every((e: {similarity:number}) => e.similarity === 75));
  run("2026-11-07",0,0);
  run("2026-11-06",0,0);
  assert.equal(read(), saved);
  writeFileSync(state,"broken");
  assert.throws(() => publish(input,state,board));
  rmSync(state);
  assert.throws(() => publish(input,state,board));
  assert.equal(read(),saved);
});

function entry(id: string, company: string, similarity: number, slot: string) {
  return {
    id, company, similarity, first_seen: slot, last_seen: slot,
    title: "Engineer", type: "SWE" as const, url: "https://example.com/jobs",
    location: null, location_unverified: true, posted: null, salary: null,
  };
}

test("repeat sightings keep the highest score and both ends of the observed date range", () => {
  const first = "2026-11-18";
  let state: NonNullable<Parameters<typeof merge>[0]> = {slot: first, entries: [entry("a", "Acme", 80, first)]};
  for (const [slot, score] of [["2026-11-19", 95], ["2026-11-20", 70]] as const) {
    const result = merge(state, {slot, entries: [entry("a", "Acme", score, slot)]});
    assert.ok(result);
    assert.deepEqual(result.state.entries, [{...entry("a", "Acme", 95, slot), first_seen: first}]);
    state = result.state;
  }
});

test("equal scores sort by company then id regardless of scan order", () => {
  const slot = "2026-11-21";
  const entries = [entry("a", "Beta", 90, slot), entry("z", "Acme", 90, slot),
    entry("b", "Acme", 90, slot), entry("c", "Gamma", 95, slot)];
  for (const input of [entries, [...entries].reverse()]) {
    const result = merge(null, {slot, entries: input});
    assert.deepEqual(result?.state.entries.map(e => e.id), ["c", "b", "z", "a"]);
  }
});
