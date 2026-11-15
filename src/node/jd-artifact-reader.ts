// Read GitHub Actions' *expiring* ciphertext-only daily archives. No ATS crawl
// and no Git archive commits. GitHub token needs actions:read, contents:read.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptArchive } from "./jd-archive.ts";
import { slotRange, validateDailyArchive, type EnrichedArchive } from "./jd-trends.ts";

const MAX_ZIP_BYTES = 2_000_000;
const MAX_CIPHER_BYTES = 1_000_000;
const MAX_PAGES = 10;
const WORKFLOW_NAME = "Job alerts";
const ALLOWED_REPO = "BlueSaNGG/job-search-agent";

export interface ArtifactMetadata {
  id: number;
  name: string;
  expired: boolean;
  created_at: string;
  size_in_bytes: number;
  workflow_run?: { id: number; head_branch?: string };
}

interface WorkflowRun {
  name: string;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string;
}

export interface RetrievedArchive {
  archives: EnrichedArchive[];
  superseded_artifacts: number;
  invalid_or_untrusted_artifacts: number;
  available_slots: number;
}

function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("GitHub Actions API failed with HTTP " + response.status);
  return response.json() as Promise<T>;
}

export function eligibleArtifacts(items: ArtifactMetadata[], endSlot: string): Map<string, ArtifactMetadata[]> {
  const slots = new Set(slotRange(endSlot));
  const grouped = new Map<string, ArtifactMetadata[]>();
  for (const artifact of items) {
    const match = /^jd-intelligence-(\d{4}-\d{2}-\d{2})$/.exec(artifact.name);
    if (!match || !slots.has(match[1]) || artifact.expired ||
        !Number.isSafeInteger(artifact.id) || artifact.id <= 0 ||
        !Number.isSafeInteger(artifact.workflow_run?.id) ||
        !Number.isFinite(Date.parse(artifact.created_at)) ||
        !Number.isFinite(artifact.size_in_bytes) ||
        artifact.size_in_bytes > MAX_ZIP_BYTES || artifact.size_in_bytes <= 0) continue;
    if (!grouped.has(match[1])) grouped.set(match[1], []);
    grouped.get(match[1])!.push(artifact);
  }
  for (const group of grouped.values()) {
    group.sort((a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  }
  return grouped;
}

async function listArtifacts(repo: string, token: string, doFetch: typeof fetch): Promise<ArtifactMetadata[]> {
  const all: ArtifactMetadata[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const endpoint = "https://api.github.com/repos/" + repo +
      "/actions/artifacts?per_page=100&page=" + page;
    const response = await doFetch(endpoint, {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const data = await responseJson<{ total_count: number; artifacts: ArtifactMetadata[] }>(response);
    if (!Array.isArray(data.artifacts) || !Number.isSafeInteger(data.total_count))
      throw new Error("Invalid GitHub artifact listing");
    all.push(...data.artifacts);
    if (all.length >= data.total_count || data.artifacts.length < 100) return all;
  }
  throw new Error("Artifact listing exceeds pagination bound; refusing a partial trend");
}

async function getRun(
  repo: string, id: number, token: string, doFetch: typeof fetch,
): Promise<WorkflowRun> {
  const response = await doFetch("https://api.github.com/repos/" + repo + "/actions/runs/" + id, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  return responseJson<WorkflowRun>(response);
}

async function downloadZip(
  repo: string, id: number, token: string, doFetch: typeof fetch,
): Promise<Buffer> {
  const response = await doFetch(
    "https://api.github.com/repos/" + repo + "/actions/artifacts/" + id + "/zip", {
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
      redirect: "manual",
    },
  );
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error("Artifact download redirect unavailable (HTTP " + response.status + ")");
  }
  const raw = response.headers.get("location");
  if (!raw) throw new Error("GitHub did not return an artifact download location");
  const destination = new URL(raw);
  if (destination.protocol !== "https:") throw new Error("Insecure artifact redirect rejected");
  // This is a short-lived signed GitHub storage URL; deliberately do NOT send
  // GITHUB_TOKEN or Authorization outside the GitHub API hostname.
  const storage = await doFetch(destination.toString(), { redirect: "follow" });
  if (!storage.ok) throw new Error("Artifact storage download failed with HTTP " + storage.status);
  const len = Number(storage.headers.get("content-length") ?? 0);
  if (Number.isFinite(len) && len > MAX_ZIP_BYTES) throw new Error("Artifact ZIP too large");
  const bytes = Buffer.from(await storage.arrayBuffer());
  if (bytes.length > MAX_ZIP_BYTES) throw new Error("Artifact ZIP too large");
  return bytes;
}

/** Refuse extra files or unexpected paths inside the ZIP; stream only ciphertext. */
export function ciphertextFromZip(zipBytes: Buffer): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "jd-trends-"));
  const zipPath = join(directory, "artifact.zip");
  try {
    writeFileSync(zipPath, zipBytes, { mode: 0o600 });
    const entries = execFileSync("unzip", ["-Z", "-1", zipPath], {
      encoding: "utf8", maxBuffer: 4096, timeout: 10_000,
    }).trim().split(/\r?\n/);
    if (entries.length !== 1 ||
        !["jd-intelligence-slot.enc", ".data/jd-intelligence-slot.enc"].includes(entries[0]))
      throw new Error("Unexpected ZIP archive contents");
    const ciphertext = execFileSync("unzip", ["-p", zipPath, entries[0]], {
      maxBuffer: MAX_CIPHER_BYTES, timeout: 10_000,
    });
    if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHER_BYTES)
      throw new Error("Invalid encrypted archive size");
    return ciphertext;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Choose the newest successful *main-branch Job alerts* artifact per slot
 * only after checking decryptability and schema. If no valid candidate is
 * present, a missing slot is reported; never assume zero hiring activity.
 */
export async function readRecentArtifacts(
  endSlot: string,
  token: string,
  secret: string,
  doFetch: typeof fetch = fetch,
): Promise<RetrievedArchive> {
  if (!token || !secret) throw new Error("GITHUB_TOKEN and JD_INTEL_KEY are required");
  const repo = ALLOWED_REPO;
  const candidates = eligibleArtifacts(await listArtifacts(repo, token, doFetch), endSlot);
  const runs = new Map<number, WorkflowRun>();
  const archives: EnrichedArchive[] = [];
  let superseded = 0, invalid = 0;
  for (const slot of slotRange(endSlot)) {
    let selected = false;
    for (const artifact of candidates.get(slot) ?? []) {
      if (selected) { superseded++; continue; }
      try {
        const runId = artifact.workflow_run!.id;
        let run = runs.get(runId);
        if (!run) {
          run = await getRun(repo, runId, token, doFetch);
          runs.set(runId, run);
        }
        if (run.name !== WORKFLOW_NAME || run.status !== "completed" ||
            run.conclusion !== "success" || run.head_branch !== "main" ||
            !["schedule", "workflow_dispatch"].includes(run.event)) {
          invalid++;
          continue;
        }
        const ciphertext = ciphertextFromZip(await downloadZip(repo, artifact.id, token, doFetch));
        const day = validateDailyArchive(decryptArchive(ciphertext, secret), slot);
        archives.push(day);
        selected = true;
      } catch {
        // Do not print exception details: a storage URL may contain a signed
        // bearer token, and decoding errors must not expose decrypted fields.
        invalid++;
      }
    }
  }
  return { archives, superseded_artifacts: superseded,
    invalid_or_untrusted_artifacts: invalid, available_slots: archives.length };
}
