# Fork notes (BlueSaNGG/job-search-agent)

Forked from tianna0/job-search-agent. Upstream is a daily watcher for
**newly posted entry-level software roles** — it is not a tracker for one
specific posting.

## What is configured in this fork (GitHub Actions variables, not secrets)

- `ALERT_LOCATIONS`: `China, Shanghai, Beijing, United States, USA, US`
  (upstream default was US only)
- `ALERT_MIN_SALARY`: `0` (off; upstream default was $110,000 USD, which
  makes little sense for China postings and drops stated-pay roles)
- `ALERT_MAX_AGE_DAYS`: left at the upstream default `3`
- Daily run: 19:00 Chicago time, via `.github/workflows/alerts.yml`

## One code change vs upstream

- `src/core/alerts.ts` `filterByLocation`: Workday postings listed as
  "2 Locations" (no place names in the list view) are now kept instead of
  dropped, because the detail page carries the real locations.
  Test: `test/alerts.test.ts` ("keeps Workday multi-location postings").

## What this watcher will NOT do — read before relying on it

- NVIDIA `JR2018616` (Infrastructure Software Engineer, Deep Learning
  Libraries, Shanghai/Beijing) is listed on NVIDIA Workday, but the
  upstream screening drops it twice over: its JD says "3+ years of
  relevant experience", so `classify()` marks it `excluded`, and it was
  posted 30+ days ago, so the 3-day age filter drops it too. That is
  correct behaviour for a "new jobs" emailer, but it means this fork
  does **not** track JR2018616. Track that posting directly
  (jobs.nvidia.com / Workday) until it is applied to or closed.
- No resume and no secrets are committed in this fork. The fork is
  public, so never commit `resume.pdf`, `resume.txt`, `.env`, or
  `.data/alerts-seen.json`. Ranking uses the `RESUME_TEXT` secret;
  the workflow deletes the generated `resume.txt` after each run.

## Secrets still needed (set in this fork: Settings → Secrets and variables → Actions)

- `SMTP_USER`, `SMTP_PASS`: Gmail address + App Password (2-Step Verification on)
- `CF_ACCOUNT_ID`, `CF_API_TOKEN`: Cloudflare Workers AI token (for resume ranking)
- `RESUME_TEXT`: plain-text resume (use the public-safe version, not a private full resume)
- `STATE_KEY`: any long random string (encrypts the already-emailed list)
- Optional `MAIL_TO` if the email should go somewhere other than `SMTP_USER`

Until those are set, run the workflow by hand with mode `dry-run`:
it prints the email in the Actions log instead of sending it.
GitHub disables scheduled workflows in forks by default — enable
Actions in this fork's Settings before expecting the 19:00 run.
