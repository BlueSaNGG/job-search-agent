import type { SourceConfig } from "./sources.ts";

export interface Company {
  id: string;
  name: string;
  group: string;
  starred: boolean;
  /** Where to read jobs from, or null when the company can't be read automatically. */
  source: SourceConfig | null;
  /** Why a company isn't read automatically. */
  note?: string;
}

// Every source below was checked against the live site in October 2026,
// including the site's robots.txt. Run `npm run check-companies` to re-check.
const gh = (slug: string): SourceConfig => ({ kind: "greenhouse", slug });
const lever = (slug: string): SourceConfig => ({ kind: "lever", slug });
const ashby = (slug: string): SourceConfig => ({ kind: "ashby", slug });
const wd = (host: string, tenant: string, site: string): SourceConfig => ({ kind: "workday", host, tenant, site });

const c = (id: string, name: string, group: string, starred: boolean, source: SourceConfig | null, note?: string): Company =>
  ({ id, name, group, starred, source, note });

const MANUAL = "Use the bookmarklet or paste a job link.";

export const COMPANIES: Company[] = [
  // AI Labs
  c("openai", "OpenAI", "AI Labs", false, ashby("openai")),
  c("anthropic", "Anthropic", "AI Labs", false, gh("anthropic")),
  c("xai", "xAI", "AI Labs", false, gh("xai")),
  c("cohere", "Cohere", "AI Labs", false, ashby("cohere")),
  c("mistral", "Mistral", "AI Labs", false, ashby("mistral.ai")),
  c("perplexity", "Perplexity", "AI Labs", false, ashby("perplexity")),

  // Big Tech
  c("google", "Google", "Big Tech", false, null, `Google's robots.txt disallows automated access to job search results. ${MANUAL}`),
  c("meta", "Meta", "Big Tech", false, null, `Meta prohibits automated data collection without written permission. ${MANUAL}`),
  c("microsoft", "Microsoft", "Big Tech", false, { kind: "microsoft" }),
  c("apple", "Apple", "Big Tech", false, { kind: "apple" }),
  c("amazon", "Amazon", "Big Tech", false, { kind: "amazon" }),
  c("nvidia", "Nvidia", "Big Tech", false, wd("nvidia.wd5.myworkdayjobs.com", "nvidia", "NVIDIAExternalCareerSite")),
  c("netflix", "Netflix", "Big Tech", false, { kind: "netflix" }),
  c("linkedin", "LinkedIn", "Big Tech", true, null, `LinkedIn's terms prohibit scraping. ${MANUAL}`),
  c("waymo", "Waymo", "Big Tech", true, gh("waymo")),

  // Data-driven / marketplace
  c("databricks", "Databricks", "Data / marketplace", false, gh("databricks")),
  c("uber", "Uber", "Data / marketplace", false, null, `Uber's careers site has no usable search API. ${MANUAL}`),
  c("airbnb", "Airbnb", "Data / marketplace", false, gh("airbnb")),
  c("stripe", "Stripe", "Data / marketplace", false, gh("stripe")),
  c("pinterest", "Pinterest", "Data / marketplace", false, gh("pinterest")),
  c("doordash", "DoorDash", "Data / marketplace", false, gh("doordashusa")),
  c("snowflake", "Snowflake", "Data / marketplace", true, ashby("snowflake")),
  c("instacart", "Instacart", "Data / marketplace", true, gh("instacart")),
  c("lyft", "Lyft", "Data / marketplace", true, gh("lyft")),

  // NYC
  c("robinhood", "Robinhood", "NYC", false, gh("robinhood")),
  c("coinbase", "Coinbase", "NYC", false, gh("coinbase")),
  c("datadog", "Datadog", "NYC", false, gh("datadog")),
  c("ramp", "Ramp", "NYC", false, ashby("ramp")),
  c("palantir", "Palantir", "NYC", false, lever("palantir")),
  c("bloomberg", "Bloomberg", "NYC", false, { kind: "bloomberg" }),

  // Consumer / product
  c("snap", "Snap", "Consumer / product", false, wd("snapchat.wd1.myworkdayjobs.com", "snapchat", "snap")),
  c("reddit", "Reddit", "Consumer / product", true, gh("reddit")),
  c("discord", "Discord", "Consumer / product", true, gh("discord")),
  c("spotify", "Spotify", "Consumer / product", true, lever("spotify")),
  c("duolingo", "Duolingo", "Consumer / product", true, gh("duolingo")),
  c("roblox", "Roblox", "Consumer / product", true, gh("roblox")),
  c("figma", "Figma", "Consumer / product", true, gh("figma")),

  // Enterprise software / infrastructure
  c("adobe", "Adobe", "Enterprise / infra", false, wd("adobe.wd5.myworkdayjobs.com", "adobe", "external_experienced")),
  c("salesforce", "Salesforce", "Enterprise / infra", false, wd("salesforce.wd12.myworkdayjobs.com", "salesforce", "External_Career_Site")),
  c("cloudflare", "Cloudflare", "Enterprise / infra", true, gh("cloudflare")),
  c("servicenow", "ServiceNow", "Enterprise / infra", false, null, "Careers site (careers.servicenow.com) has no public Greenhouse, Lever, Ashby, or Workday board."),
  c("workday", "Workday", "Enterprise / infra", false, wd("workday.wd5.myworkdayjobs.com", "workday", "Workday")),
  c("atlassian", "Atlassian", "Enterprise / infra", false, null, "Careers site (atlassian.com/company/careers) has no public Greenhouse, Lever, Ashby, or Workday board."),
  c("intuit", "Intuit", "Enterprise / infra", false, null, "Careers site runs on Avature (jobs.intuit.com); no supported reader."),
  c("mongodb", "MongoDB", "Enterprise / infra", false, gh("mongodb")),
  c("crowdstrike", "CrowdStrike", "Enterprise / infra", false, null, "Careers site (crowdstrike.com/careers) has no public Greenhouse, Lever, Ashby, or Workday board."),
  c("zoom", "Zoom", "Enterprise / infra", false, null, "Careers site (careers.zoom.us) has no public Greenhouse, Lever, Ashby, or Workday board."),
  c("dropbox", "Dropbox", "Enterprise / infra", false, gh("dropbox")),
  c("shopify", "Shopify", "Enterprise / infra", false, null, "Careers site (shopify.com/careers) has no public Greenhouse, Lever, Ashby, or Workday board."),

  // Semiconductors (fork addition: strong fit with the infra/ML-platform direction)
  c("amd", "AMD", "Semiconductors", false, null, "Careers site is Phenom-based (careers.amd.com); no public job-board API."),
  c("intel", "Intel", "Semiconductors", false, wd("intel.wd1.myworkdayjobs.com", "intel", "External")),
  c("qualcomm", "Qualcomm", "Semiconductors", false, null, "Workday site rejects the public jobs API (HTTP 422 on wd5; the wd12 mirror returns no jobs)."),
  c("broadcom", "Broadcom", "Semiconductors", false, wd("broadcom.wd1.myworkdayjobs.com", "broadcom", "External_Career")),
  c("micron", "Micron", "Semiconductors", false, wd("micron.wd1.myworkdayjobs.com", "micron", "External")),
  c("ti", "Texas Instruments", "Semiconductors", false, null, "Careers site runs on Oracle Recruiting (careers.ti.com); no supported reader."),
  c("asml", "ASML", "Semiconductors", false, wd("asml.wd3.myworkdayjobs.com", "asml", "ASMLEXT1")),

  // AI & high-growth (fork addition)
  c("coreweave", "CoreWeave", "AI & high-growth", false, gh("coreweave")),
  c("vercel", "Vercel", "AI & high-growth", false, gh("vercel")),
  c("notion", "Notion", "AI & high-growth", false, ashby("notion")),
  c("linear", "Linear", "AI & high-growth", false, ashby("linear")),

  // Finance (fork addition: top pay for SWE)
  c("janestreet", "Jane Street", "Finance", false, gh("janestreet")),
  c("twosigma", "Two Sigma", "Finance", false, null, "Careers site runs on iCIMS (careers.twosigma.com); no supported reader."),
];

export function findCompany(id: string): Company | undefined {
  return COMPANIES.find((x) => x.id === id);
}

export function readableCompanyIds(): string[] {
  return COMPANIES.filter((x) => x.source !== null).map((x) => x.id);
}
