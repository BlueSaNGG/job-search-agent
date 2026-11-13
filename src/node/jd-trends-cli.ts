// Read-only 14-day intelligence report. No ATS requests and no Git writes.
// Run in Actions with --github or locally with --file <ciphertext> (repeat).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decryptArchive } from "./jd-archive.ts";
import { readRecentArtifacts } from "./jd-artifact-reader.ts";
import { buildTrendReport, completedChicagoSlot, renderTrendMarkdown, validateDailyArchive } from "./jd-trends.ts";

function parseOptions(args: string[]): { github: boolean; files: string[]; endSlot: string } {
  let github = false, endSlot: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--github") github = true;
    else if (args[i] === "--file" && args[i + 1]) files.push(args[++i]);
    else if (args[i] === "--end-slot" && args[i + 1]) endSlot = args[++i];
    else throw new Error("Use --github OR --file <encrypted archive>; optional --end-slot YYYY-MM-DD");
  }
  if (github === !!files.length) throw new Error("Choose exactly one source: --github or --file");
  return { github, files, endSlot: endSlot ?? completedChicagoSlot() };
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));
  const secret = process.env.JD_INTEL_KEY;
  if (!secret || secret.length < 32) throw new Error("JD_INTEL_KEY is missing or too short");
  let archives;
  let failures = 0, superseded = 0;
  if (opts.github) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN missing (Actions read-only access required)");
    const data = await readRecentArtifacts(opts.endSlot, token, secret);
    archives = data.archives;
    failures = data.invalid_or_untrusted_artifacts;
    superseded = data.superseded_artifacts;
  } else {
    archives = opts.files.map(path => validateDailyArchive(decryptArchive(readFileSync(path), secret)));
  }
  const report = buildTrendReport(archives, opts.endSlot);
  if (failures) report.limitations.push(
    "无法使用的归档候选数量：" + failures + "；不会把读取失败计为没有岗位。");
  if (superseded) report.limitations.push(
    "忽略了同一天较旧的归档候选：" + superseded + "。");
  const markdown = renderTrendMarkdown(report);

  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/jd-trends-summary.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(".data/jd-trends-summary.md", markdown, { mode: 0o600 });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log("JD trends: " + report.status + " | slots " + report.window.observed_slots +
    "/14 | evidence jobs " + report.sample.evidence_eligible_jobs +
    " | skills " + report.skills.length + " | discarded artifacts " + failures +
    " | superseded artifacts " + superseded + ".");
}

main().catch(() => {
  // Never print exception objects from artifact download or decryption: they
  // could contain signed URLs, opaque job data or private file paths.
  console.error("JD trends failed; check artifact access, archive integrity and key configuration.");
  process.exitCode = 1;
});
