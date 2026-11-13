// One shared employer scan for the existing email pipeline and JD Intelligence.
// Keep source failures isolated; the caller decides how to handle an empty scan.
import { findCompany, readableCompanyIds } from "../core/discover/companies.ts";
import { discoverCompany, type DiscoveredJob } from "../core/discover/discover.ts";
import { filterByLocation, filterBySalary, filterOutEntry } from "../core/alerts.ts";

export interface ScanResult {
  matched: DiscoveredJob[];
  failed: string[];
  attempted: number;
}

export async function collectJobMatches(doFetch: typeof fetch = fetch): Promise<ScanResult> {
  const ids = readableCompanyIds();
  const matched: DiscoveredJob[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    const company = findCompany(id)!;
    try {
      const r = await discoverCompany(company, doFetch, { keepDescription: true });
      matched.push(...r.matched);
      const dated = r.matched.filter((j) => j.postedAt).length;
      console.log(`  ${company.name.padEnd(12)} ${r.matched.length} match (${r.listed} listed)${r.matched.length ? `, ${dated} with a posting date` : ""}`);
    } catch (err) {
      failed.push(company.name);
      console.log(`  ${company.name.padEnd(12)} failed: ${(err as Error).message}`);
    }
  }
  if (failed.length === ids.length) throw new Error("Every company failed. Are you online?");
  return { matched, failed, attempted: ids.length };
}

// Filtering is deliberately shared with alerts, not copied into a separate crawler.
export function filterScanMatches(matched: DiscoveredJob[], locations: string[], minSalary: number) {
  const inLocations = filterByLocation(matched, locations);
  const { kept: paid, dropped: underpaid } = filterBySalary(inLocations, minSalary);
  const relevant = filterOutEntry(paid);
  return { paid, underpaid, relevant };
}
