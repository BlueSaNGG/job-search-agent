import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportBoard, publish } from "../src/node/leaderboard.ts";

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
