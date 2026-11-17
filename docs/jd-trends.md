# JD Intelligence — 14-day skill sample (Phase B)

This is a **read-only** weekly analysis of the independently expiring encrypted Top-10 archives produced by the daily [Job alerts workflow](../.github/workflows/alerts.yml). It does **not** crawl ATS sites, send email, change seen state, write Git history, open PRs in interview-prep, or automatically claim that any skill has been learned.

## Activation and usage

1. Merge the Phase B PR after CI and code review.
2. The existing GitHub Actions repository secret `JD_INTEL_KEY` is reused. It is never printed, committed or uploaded.
3. The [JD Intelligence weekly trends](../.github/workflows/jd-trends.yml) workflow runs Monday at 15:37 UTC and also supports **Run workflow** manually. It requests only `contents: read` and `actions: read`.
4. It reads the preceding **14 completed Chicago calendar slots** (or an optional `end_slot` YYYY-MM-DD), validates the newest successful `Job alerts` artifact on `main` for each slot, decrypts in memory, and publishes **aggregate-only** JSON/Markdown and a GitHub Actions summary.
5. Until enough actual daily archives exist, status is `insufficient_evidence`. This is expected immediately after enabling the daily archive, and it must **not** be interpreted as a shortage of job openings.
6. Do not copy `JD_INTEL_KEY` into PR comments, artifacts, logs, commands with visible history, or ChatGPT.

Local-only inspection with your downloaded ciphertext snapshot:

```bash
# In .env, configure JD_INTEL_KEY; do NOT commit .env.
npm run jd-trends -- --file /path/to/jd-intelligence-slot.enc --end-slot 2026-11-12
```

Multiple `--file` arguments are supported. The CLI writes only minimized aggregate statistics to ignored `.data/jd-trends-summary.{json,md}`, not original JD text. Locally, a single file will normally report insufficient evidence.

## Evidence quality and interpretation

- **Scope:** Daily top-10 selected opportunities only, **not** all listed jobs and not all employers or geographies.
- **Deduplication:** One stable job ID counts once in each 7-day subwindow, even if it appears daily. A job appearing in both halves contributes once to each half.
- **Skill vocabulary:** Exact normalized labels for build systems, CI/CD, Bazel, CMake, Docker, Kubernetes, Python, C++, distributed systems, Terraform, observability and cloud platforms. Other skills are not asserted absent. The source text may be cut to 4,000 characters.
- **Required vs preferred:** New daily archives make *conservative, unverified section-based inferences*. Older archives without section tags count only as `mentioned`. These are not human-validated requirement classifications; ambiguous headings default to mentioned.
- **Location:** Only `location_status=eligible` and readable descriptions count toward skill prevalence; ambiguous location and unavailable description counts are shown separately.
- **Coverage gate:** A report is `ready` only with at least 10/14 daily archives, >=4/7 in each half, >=10 eligible distinct JDs, >=5 per half, >=8 JDs with skill evidence overall, >=3 per half, and <=25% source failures. It uses `insufficient_evidence` otherwise and hides trend deltas.
- **What the delta is:** Difference in the percentage of eligible sampled JDs mentioning a skill between two 7-day subwindows, in percentage points; **not** growth in hiring demand or a signal about compensation.
- **Data quality:** Each archive supplies global source attempts/failures and number of selected jobs, not full per-source historical baselines. Missing days/feeds mean unknown coverage, never zero market interest.
- **Versioning:** Daily archive schema stays compatible at v1; Phase B adds optional `skill_signals` and `skill_taxonomy_version: skill-signals-v1`. The aggregate report uses `jd-trends.v1`. Phase B remains aggregate-only; the optional Phase C handoff below is a separate artifact.

The report does not disclose individual resume similarity scores, job URLs, JD bodies, confidential company materials, or resume text. Real GitHub Actions artifact fetching needs to be validated on a run after daily encrypted archives actually exist. Tests cover the GitHub REST pagination shape, signed-URL token isolation, ZIP allowlist, same-slot reruns and corrupt-file fallback with mock fixtures.

## Phase C: sanitized weekly handoff (review-only producer)

When the same 14-day sample meets all Phase B evidence gates **and** `ALERT_TARGET_LOCATIONS` matches the explicitly documented `US_MAJOR_METROS, Shanghai, Hangzhou` profile, the weekly report also builds `.data/jd-weekly-handoff.v1.json`. This versioned file uses [the canonical handoff schema](rfcs/schema/weekly-handoff.v1.schema.json), carries official HTTPS posting links and normalized skill signals, and includes a SHA-256 digest of sorted canonical JSON fields (excluding the digest). The file is uploaded as a **separate 30-day Actions artifact** called `jd-weekly-handoff-v1` only when present. No handoff is produced on insufficient evidence or a changed location profile. The aggregate Phase B report still runs normally.

The handoff contains no full JD body, original quotations, resume, private application status, PayPal work content, or numeric resume-similarity scores. `evidence` explicitly describes automated keyword/section inference, **not** a fabricated quote from the underlying job description; the receiving reviewer must verify the official JD. `first_seen_at` means the first observed appearance **inside the sampled 14-day window**. The source coverage counts are from the newest successful daily archive (not all job-market sources). Older archives do not attest an exact target profile revision, so downstream proposals must keep location/source uncertainty visible.

This phase only publishes a sanitized handoff artifact and **does not create cross-repository PRs or request write credentials**. Consumer validation, learning-record comparison, and scoped GitHub App automation are independent reviewed stages. Do not interpret this producer's presence as authorization to auto-edit `interview-prep`.


### 11/16 contract corrections (pre-release v1)

`window.from/to` bound 14 **scheduled Chicago daily slots**, each beginning at 19:00 and ending at the next local day's 19:00, including next-day retries. UTC endpoints vary with DST (335/336/337 elapsed hours); ISO week uses the local end date. Each observation must belong to its own archive slot and cannot be after `generated_at`; invalid attribution suppresses the entire optional handoff rather than exporting filtered evidence under an earlier readiness claim. A generated report can precede the final retry boundary: it contains only observations already made, not promises about future runs.

Job and skill IDs use locale-independent UTF-16 code-unit order across producer and consumer. The pre-release schema/fixture now document this window; old zero-UTC fixture boundaries are rejected. Consumer policy remains private and human-maintained: it may suppress skills such as C/C++ regardless of market frequency. The producer does not receive learning progress or make curriculum decisions.

`test/export-handoff-fixtures.ts` emits synthetic ordinary/DST cases for a pinned cross-repository CI contract test. This is not a live Actions artifact read-back and does not start cross-repository automation.
