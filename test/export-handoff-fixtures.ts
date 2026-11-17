// Cross-repository integration producer. Synthetic data only, no network/secrets.
import { buildDailyArchive } from '../src/node/jd-archive.ts';
import { slotRange } from '../src/node/jd-trends.ts';
import { buildWeeklyHandoff, slotStart } from '../src/node/jd-weekly-handoff.ts';
import type { DiscoveredJob } from '../src/core/discover/discover.ts';
function generate(end: string) {
  const records = slotRange(end).map((slot, i) => {
    const observed = new Date(slotStart(slot).getTime() + 17*60000).toISOString();
    const jobs: DiscoveredJob[] = [0,1].map(n=>({
      id: `company:${n ? 'a' : 'Z'}${i}`, externalId: `${n}-${i}`,
      company: n ? 'alpha' : 'beta', companyName: n ? 'Alpha' : 'Beta',
      title: 'Developer Productivity Engineer', location: 'Chicago, IL',
      url: `https://example.com/${i}/${n}`, category: 'SWE', level: 'maybe',
      reasons: [], firstSeen: observed, postedAt: undefined,
      description: 'Requirements:\nPython, C++ and Docker',
    }));
    return buildDailyArchive(jobs, null, slot, observed, 56, 1, 2);
 });
 const generated = new Date(slotStart(end).getTime()+14*3600000).toISOString();
 const result = buildWeeklyHandoff(records, end, generated);
 if (!result) throw new Error('Expected sufficient synthetic evidence');
 return result;
}
console.log(JSON.stringify([generate('2026-11-15'), generate('2026-11-05'), generate('2026-03-12')]));
