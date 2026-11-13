// Local-only inspection of a downloaded encrypted JD Intelligence artifact.
// Never run this command in public CI logs: output contains private fit scores.
import { readFileSync } from "node:fs";
import { decryptArchive, ARCHIVE_PATH } from "./jd-archive.ts";

const secret = process.env.JD_INTEL_KEY;
if (!secret) {
  console.error("JD_INTEL_KEY must be set in your local .env to read encrypted archives.");
  process.exitCode = 1;
} else {
  try {
    const path = process.argv[2] ?? ARCHIVE_PATH;
    const archive = decryptArchive(readFileSync(path), secret);
    console.log("JD Archive slot: " + archive.slot + " | ranking: " + archive.ranking_method);
    console.log(
      "Sources: " + archive.source_coverage.attempted + " attempted, " +
      archive.source_coverage.failed + " failed | " + archive.jobs.length + " jobs",
    );
    for (const [i, job] of archive.jobs.entries()) {
      const score = job.similarity === null ? "unranked" : String(job.similarity) + "/100";
      console.log("");
      console.log(String(i + 1) + ". " + job.company_name + " — " + job.title + " [" + score + "]");
      console.log("   " + (job.location || "Unverified location") + " | " + job.location_status);
      console.log("   Skill mentions: " + (job.skill_mentions.join(", ") || "none extracted"));
      console.log("   " + job.url);
    }
  } catch {
    console.error("Unable to decrypt or read JD archive. Check the path, secret and file integrity.");
    process.exitCode = 1;
  }
}
