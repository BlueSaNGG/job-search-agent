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
- **Versioning:** Daily archive schema stays compatible at v1; Phase B adds optional `skill_signals` and `skill_taxonomy_version: skill-signals-v1`. The aggregate report uses `jd-trends.v1`. No public weekly interview-prep handoff is emitted by this workflow; the canonical handoff remains a Phase C contract.

The report does not disclose individual resume similarity scores, job URLs, JD bodies, confidential company materials, or resume text. Real GitHub Actions artifact fetching needs to be validated on a run after daily encrypted archives actually exist. Tests cover the GitHub REST pagination shape, signed-URL token isolation, ZIP allowlist, same-slot reruns and corrupt-file fallback with mock fixtures.
