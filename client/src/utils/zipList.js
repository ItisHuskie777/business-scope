import { isValidZip } from "./validation.js";

export const MAX_COMPARE = 4;

/**
 * Reads the ZIP list of the Compare page from its `?zips=` URL parameter:
 * keeps valid 5-digit ZIPs, drops repeats, and caps the list at MAX_COMPARE.
 * @param {string|null} raw
 * @returns {string[]}
 */
export function parseZipList(raw) {
  if (!raw) return [];
  const seen = new Set();
  for (const part of raw.split(",")) {
    const zip = part.trim();
    if (isValidZip(zip) && !seen.has(zip)) seen.add(zip);
    if (seen.size === MAX_COMPARE) break;
  }
  return [...seen];
}

/** The inverse of parseZipList, for writing the list back to the URL. */
export const formatZipList = (zips) => zips.join(",");

/** Merge one housing series per ZIP into rows of { date, [zip]: value }. */
export function mergeSeries(zips, seriesList) {
  const byDate = new Map();
  seriesList.forEach((series, i) => {
    for (const point of series) {
      const date = point.trend_date.slice(0, 7);
      if (!byDate.has(date)) byDate.set(date, { date });
      byDate.get(date)[zips[i]] = Number(point.zhvi_value);
    }
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
