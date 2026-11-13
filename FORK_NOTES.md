# Fork notes (BlueSaNGG/job-search-agent)

Forked from tianna0/job-search-agent. Upstream is a daily watcher for
**newly posted entry-level software roles**. This fork is changed to an
**experienced mode**: it watches newly posted software roles across
81 companies (upstream had 40), including Senior titles and JDs asking
for 3+ years.
Entry-level roles are not emailed at all: classification still labels
them, but the pipeline drops them before ranking, so the daily email
contains only Maybe (experienced) roles. It is still not a tracker for
one specific posting.

## What is configured in this fork (GitHub Actions variables, not secrets)

- `ALERT_TARGET_LOCATIONS`: `US_MAJOR_METROS, Shanghai, Hangzhou` (scheduled workflow default).
  Covers major US cities and explicitly US-remote roles; Chinese roles only from Shanghai/Hangzhou,
  not Beijing or other cities. The old `ALERT_LOCATIONS` repo variable was removed
  in the 2026-11-12 cleanup; use `ALERT_TARGET_LOCATIONS` to customize. Missing or count-only locations (e.g.
  `2 Locations`) remain candidates for manual location verification.
- `ALERT_MIN_SALARY`: `0` (off; upstream default was $110,000 USD, which
  makes little sense for China postings and drops stated-pay roles)
- `ALERT_MAX_AGE_DAYS`: left at the upstream default `3`
- Daily run: 19:00 Chicago time, via `.github/workflows/alerts.yml`

## Code changes vs upstream

- Fixed mixed US/China location filtering; selected Chinese cities no longer get
  rejected just because the US filter is active. `US_MAJOR_METROS` includes US-based
  remote jobs and major metropolitan areas; tests cover city limits and Chinese aliases.
- Experienced-mode queries now include platform, infrastructure, and build engineers;
  classification recognizes those titles.
- Pull request CI checks run `npm test` and `npm run typecheck`.

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

## November 2026 expansion: high-upside employers

Added 19 more companies after the 62-company fork baseline, bringing the
catalog to **81 tracked / 56 auto-readable / 25 manual-only**.

- Newly configured public ATS boards (8): DRW (`drweng`, Greenhouse),
  IMC Trading (`imc`, Greenhouse), Airwallex (`airwallex`, Ashby),
  Anyscale (`anyscale`, Ashby), Hightouch (`hightouch-inc`, Ashby),
  Modal (`modal`, Ashby), Fireworks AI (`fireworks`, Ashby),
  Crusoe (`crusoe`, Ashby).
- Manual-only additions (11): Citadel Securities, Hudson River Trading,
  Optiver, Citadel, ByteDance/TikTok, Alibaba Cloud, DeepSeek, MiniMax,
  PDD/Pinduoduo, Ant Group, and Kuaishou. They are listed in the app,
  but **cannot be automatically scanned or emailed** without a working
  supported source. Optiver's public `optiverprivate` board is partial
  and is not substituted for its full jobs feed.
- Run `npm run check-companies -- drw imc airwallex anyscale hightouch modal fireworks crusoe`
  to verify the eight public boards. GitHub Actions
  `.github/workflows/source-smoke.yml` runs the same live test on the
  `add-companies` branch. Failed requests now return a nonzero exit code.
- AI labs frequently call SWE positions `Member of Technical Staff` /
  `MTS`. These titles now classify as SWE so infrastructure jobs
  from Fireworks/Modal are not silently dropped. New-grad MTS roles
  are still skipped from experienced-role emails.
- Company inclusion indicates possible career and compensation upside,
  **not** a guaranteed increase over PayPal. Compare each offer's salary,
  bonus, equity liquidity, location, work intensity, and eligibility.
- Location policy remains unchanged: major US metros and explicitly
  US-based remote roles; in China, Shanghai/Hangzhou only. North-America
  remote postings may need manual checking if they do not say US.

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
