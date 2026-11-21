import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hasUnverifiedLocation } from "../core/alerts.ts";
import { formatSalary } from "../core/discover/salary.ts";
import type { DiscoveredJob } from "../core/discover/discover.ts";

function calendarDay(value: string) {
  if (!/^\d{4}-\d\d-\d\d$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value)
    throw new Error("Invalid leaderboard date");
  return value;
}

export function publicEntry(job: DiscoveredJob, similarity: number, slot: string) {
  return {
    id: job.id, company: job.companyName, title: job.title, type: job.category,
    location: job.location.trim() || null, location_unverified: hasUnverifiedLocation(job),
    posted: job.postedAt && Number.isFinite(Date.parse(job.postedAt)) ? job.postedAt.slice(0, 10) : null,
    salary: job.salary ? formatSalary(job.salary) : null, url: job.url, similarity,
    first_seen: slot, last_seen: slot,
  };
}

type Entry = ReturnType<typeof publicEntry>;
type State = {slot: string, entries: Entry[]};

function validate(state: State) {
  calendarDay(state.slot);
  if (!Array.isArray(state.entries)) throw new Error("Invalid leaderboard state");
  for (const e of state.entries) {
    const required = ["id", "company", "title", "type", "url", "first_seen", "last_seen"] as const;
    const optional = ["location", "posted", "salary"] as const;
    if (Object.keys(e).length !== required.length + optional.length + 2 ||
        !required.every(k => typeof e[k] === "string" && e[k].length) ||
        !optional.every(k => typeof e[k] === "string" || e[k] === null) ||
        typeof e.location_unverified !== "boolean" || !Number.isInteger(e.similarity) ||
        e.similarity < 0 || e.similarity > 100 || !/^https?:$/.test(new URL(e.url).protocol) ||
        calendarDay(e.first_seen) > calendarDay(e.last_seen) || e.last_seen > state.slot)
      throw new Error("Invalid leaderboard entry");
  }
}

export function exportBoard(path: string | undefined, slot: string | undefined, jobs: DiscoveredJob[], scores: Record<string, number>) {
  if (!path || !slot) return;
  try {
    const daily = {slot, entries: jobs.map(job => publicEntry(job, scores[job.id], slot))};
    validate(daily);
    writeFileSync(path + ".tmp", JSON.stringify(daily));
    renameSync(path + ".tmp", path);
  } catch {
    console.warn("::warning::Leaderboard export skipped");
  }
}

const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function merge(previous: State | null, daily: State) {
  validate(daily);
  if (previous) validate(previous);
  if (previous && previous.slot > daily.slot) return null;
  const from = new Date(Date.parse(daily.slot) - 6 * 86400000).toISOString().slice(0, 10);
  const jobs = new Map(previous?.entries.map(e => [e.id, e]));
  for (const entry of daily.entries) {
    const old = jobs.get(entry.id);
    jobs.set(entry.id, old ? {...entry, first_seen: old.first_seen, similarity: Math.max(old.similarity, entry.similarity)} : entry);
  }
  const entries = [...jobs.values()].filter(e => e.first_seen >= from)
    .sort((a,b) => b.similarity - a.similarity || ordinal(a.company,b.company) || ordinal(a.id,b.id));
  return {state: {slot: daily.slot, entries}, window: {from, to: daily.slot}};
}

export function publish(input: string, statePath: string, publicPath: string) {
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const previous = existsSync(statePath) ? read(statePath) : null;
  if (!previous && existsSync(publicPath)) throw new Error("Restore missing leaderboard state");
  const result = merge(previous, read(input));
  if (!result || (existsSync(publicPath) && JSON.stringify(previous) === JSON.stringify(result.state))) return;
  const now = new Date();
  const clock = new Intl.DateTimeFormat("sv-SE", {timeZone:"America/Chicago", dateStyle:"short", timeStyle:"medium"}).format(now).replace(" ", "T");
  const offset = new Intl.DateTimeFormat("en", {timeZone:"America/Chicago", timeZoneName:"longOffset"}).formatToParts(now).find(part => part.type === "timeZoneName")!.value.slice(3);
  const snapshot = {slot: result.state.slot, window: result.window, generated_at: clock + offset,
    entries: result.state.entries.slice(0,20)};
  writeFileSync(statePath, JSON.stringify(result.state, null, 2) + "\n");
  writeFileSync(publicPath, JSON.stringify(snapshot, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  publish(process.argv[2], ".data/leaderboard-state.json", "docs/leaderboard.json");
