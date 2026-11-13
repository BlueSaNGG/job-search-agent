# Fork notes (BlueSaNGG/job-search-agent)

Forked from tianna0/job-search-agent. Upstream is a daily watcher for
**newly posted entry-level software roles**. This fork is changed to an
**experienced mode**: it watches newly posted software roles across
62 companies (upstream had 40), including Senior titles and JDs asking
for 3+ years.
Entry-level roles are not emailed at all: classification still labels
them, but the pipeline drops them before ranking, so the daily email
contains only Maybe (experienced) roles. It is still not a tracker for
one specific posting.

## What is configured in this fork (GitHub Actions variables, not secrets)

- `ALERT_LOCATIONS`: `China, Shanghai, Beijing, United States, USA, US`
  (upstream default was US only)
- `ALERT_MIN_SALARY`: `0` (off; upstream default was $110,000 USD, which
  makes little sense for China postings and drops stated-pay roles)
- `ALERT_MAX_AGE_DAYS`: left at the upstream default `3`
- Daily run: 19:00 Chicago time, via `.github/workflows/alerts.yml`

## Code changes vs upstream

- `src/core/alerts.ts` `filterByLocation`: Workday postings listed as
  "2 Locations" (no place names in the list view) are now kept instead of
  dropped, because the detail page carries the real locations.
  Test: `test/alerts.test.ts` ("keeps Workday multi-location postings").
- Experienced mode in `src/core/discover/classify.ts`:
  - Senior / Sr. titles are no longer excluded. Still excluded: Staff,
    Principal, Lead, Manager, Director, Head of, internships, and
    clearance / citizenship requirements.
  - Years of experience in a JD no longer exclude a job: 3+ years makes
    a plain title a Maybe. Tests updated in `test/classify.test.ts`,
    `test/discover.test.ts`, and `test/sources.test.ts` (Apple).
  - Email wording updated accordingly (`src/core/alerts.ts`,
    `src/core/chat.ts`): "SWE jobs", not "Entry-level SWE jobs".
- 22 more companies added in `src/core/discover/companies.ts`
  (2026-11-12; verified with `npm run check-companies`, counts below
  are from that run). 12 are auto-read; 10 are listed as manual-only
  because their careers sites have no readable board on a supported
  ATS (Greenhouse / Lever / Ashby / Workday) — they still show in the
  tracker and jobs can be added via the bookmarklet or a pasted link.
  - Auto-read: MongoDB (Greenhouse, 386 listed / 50 match), Dropbox
    (Greenhouse, 42 / 7), Intel (Workday, 111 / 11), CoreWeave
    (Greenhouse, 304 / 31), Vercel (Greenhouse, 87 / 14), Linear
    (Ashby, 33 / 0), Jane Street (Greenhouse, 217 / 15), Workday
    (Workday, 105 / 26), Broadcom (Workday, 147 / 11), Micron
    (Workday, 293 / 14), ASML (Workday, 190 / 14), Notion (Ashby,
    160 / 14).
  - Manual-only: AMD (Phenom), Intuit (Avature), Texas Instruments
    (Oracle Recruiting), Two Sigma (iCIMS), Qualcomm (Workday API
    returns HTTP 422 on wd5; wd12 mirror returns no jobs),
    ServiceNow, Atlassian, CrowdStrike, Zoom, Shopify (no public
    board on any supported ATS; Greenhouse, Lever, and Ashby all
    checked and 404).
  - `test/discover.test.ts` company-count assertion updated 40 → 62,
    and the chat assistant's "about 40 companies" line in
    `src/core/chat.ts` updated to "about 60".

## What this watcher will NOT do — read before relying on it

- NVIDIA `JR2018616` (Infrastructure Software Engineer, Deep Learning
  Libraries, Shanghai/Beijing) is listed on NVIDIA Workday, and the
  experienced-mode screening no longer drops it for its "3+ years"
  JD — under the new rules it classifies as Maybe. It still will not
  appear in the daily email, because it was posted 30+ days ago and
  the daily email only sends jobs posted in the last 3 days. That is
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
