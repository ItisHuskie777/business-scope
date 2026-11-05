'use strict';

// Renders bench/results.json as the Markdown tables used in the project README.
//   node bench/report.js

const fs = require('fs');
const path = require('path');

const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));

const fmtMs = (v) => {
  if (v === undefined || v === null) return '';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  if (v >= 100) return `${v.toFixed(0)} ms`;
  if (v >= 10) return `${v.toFixed(1)} ms`;
  return `${v.toFixed(2)} ms`;
};
const times = (a, b) => {
  if (!a || !b) return '';
  const x = a / b;
  return x >= 10 ? `${Math.round(x).toLocaleString('en-US')}x` : `${x.toFixed(1)}x`;
};
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;
const med = (group, key) => (r[group] && r[group][key] ? r[group][key].median : undefined);
const table = (header, rows) => [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

const out = [];
out.push(`PostgreSQL ${r.postgres}, ${r.cpus} logical CPUs, default server settings. ` +
  `Synthetic data: ${r.rowCounts.businesses.toLocaleString('en-US')} businesses, ${r.rowCounts.reviews.toLocaleString('en-US')} reviews, ` +
  `${(Math.round(r.rowCounts.zips * 0.95) * r.rowCounts.months).toLocaleString('en-US')} housing rows. ` +
  `Median of ${r.runs} runs (${r.baselineRuns} for the baseline).`);
out.push('');

const complex = [
  ['Q4 `/high_rated_with_housing`', 'q4_high_rated_with_housing'],
  ['Q5 `/business_review_stats`', 'q5_business_review_stats'],
  ['Q6 `/top_business_per_zip`', 'q6_top_business_per_zip'],
  ['Q8 `/rating_vs_housing`', 'q8_rating_vs_housing'],
  ['Q11 `/opportunity_score`', 'q11_opportunity_score'],
  ['`/business/:id` (most reviewed business)', 'business_by_id'],
];
out.push(table(
  ['Endpoint', 'Unoptimized', 'Milestone 4', 'Now', 'Now vs unoptimized', 'Now vs Milestone 4'],
  complex.map(([label, key]) => {
    const base = med('baseline', key);
    const now = med('current', key);
    // Q4 and Q5 were not changed after Milestone 4, so their Milestone 4 time is the current one.
    const m4 = med('ms4', key) !== undefined ? med('ms4', key) : now;
    return [label, fmtMs(base), fmtMs(m4), fmtMs(now), times(base, now), med('ms4', key) !== undefined ? times(m4, now) : 'unchanged'];
  })
));
out.push('');

out.push(table(
  ['Listing and lookup endpoint', 'Before index', 'After index', 'Change'],
  Object.keys(r.lookupBefore).map((key) => [`\`${key}\``, fmtMs(med('lookupBefore', key)), fmtMs(med('current', key)), times(med('lookupBefore', key), med('current', key))])
));
out.push('');

out.push(table(
  ['HTTP request', 'First request', 'Repeat (cached)', 'JSON size', 'Sent (gzip)'],
  Object.entries(r.http).map(([url, v]) => [`\`${url}\``, fmtMs(v.missMs), fmtMs(v.hitMsMedian), kb(v.rawBytes), kb(v.gzipBytes)])
));
out.push('');
out.push(`Building every index and materialized view took ${(r.buildCoreSeconds + r.buildLookupIndexSeconds).toFixed(0)} s; refreshing all five views took ${r.refreshAllSeconds.toFixed(1)} s.`);

console.log(out.join('\n'));
