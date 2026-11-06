'use strict';

// Checks every endpoint against values computed independently, in plain
// JavaScript, from the same fixture rows that were loaded into PostgreSQL.

const request = require('supertest');
const { buildApp } = require('./helpers/app');
const { build, UNLISTED_ZIP, ZIP_WITHOUT_HOUSING } = require('./helpers/fixtures');
const pool = require('../db');

const app = buildApp();
const data = build();
afterAll(() => pool.end());

const get = (url, query) => request(app).get(url).query(query || {});
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const groupBy = (rows, key) => rows.reduce((acc, row) => {
  (acc[row[key]] = acc[row[key]] || []).push(row);
  return acc;
}, {});

const reviewsByBusiness = groupBy(data.review, 'business_id');
const businessesByZip = groupBy(data.business, 'postal_code');
const housingByZip = groupBy(data.housingTrend, 'postal_code');
const zipByCode = Object.fromEntries(data.zipRegion.map((z) => [z.postal_code, z]));
const reviewCount = (id) => (reviewsByBusiness[id] || []).length;
const latestZhvi = (zip) => {
  const rows = housingByZip[zip];
  if (!rows) return null;
  return [...rows].sort((a, b) => a.trend_date.localeCompare(b.trend_date)).pop().zhvi_value;
};

describe('GET /businesses', () => {
  test('lists only open businesses by default, sorted by name', async () => {
    const res = await get('/businesses', { limit: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(data.business.filter((b) => b.is_open === 1).length);
    expect(res.body.rows.every((b) => b.is_open === 1)).toBe(true);
    const names = res.body.rows.map((b) => b.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  test('open_only=false includes closed businesses', async () => {
    const res = await get('/businesses', { limit: 1000, open_only: 'false' });
    expect(res.body.rows).toHaveLength(data.business.length);
  });

  test('filters combine with AND and state is case-insensitive', async () => {
    const res = await get('/businesses', { state: 'pa', city: 'Philadelphia', postal_code: '19104', min_stars: 3.5, open_only: 'false' });
    const expected = data.business.filter((b) => b.postal_code === '19104' && b.stars >= 3.5);
    expect(res.body.rows.map((b) => b.business_id).sort()).toEqual(expected.map((b) => b.business_id).sort());
  });

  test('paging walks every row exactly once even though many names repeat', async () => {
    const seen = [];
    for (let page = 1; page <= 20; page += 1) {
      const res = await get('/businesses', { limit: 7, page, open_only: 'false' });
      expect(res.body).toMatchObject({ page, limit: 7 });
      if (res.body.rows.length === 0) break;
      seen.push(...res.body.rows.map((b) => b.business_id));
    }
    expect(seen).toHaveLength(data.business.length);
    expect(new Set(seen).size).toBe(data.business.length);
  });
});

describe('simple aggregates', () => {
  test('GET /city_business_stats counts businesses per city, largest first', async () => {
    const res = await get('/city_business_stats');
    const expected = Object.entries(groupBy(data.business, 'city')).map(([city, rows]) => [city, rows.length]);
    expect(Object.fromEntries(res.body.map((r) => [r.city, r.num_businesses]))).toEqual(Object.fromEntries(expected));
    const counts = res.body.map((r) => r.num_businesses);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  test('GET /postal_code_stats averages stars per ZIP', async () => {
    const res = await get('/postal_code_stats');
    expect(res.body).toHaveLength(Object.keys(businessesByZip).length);
    for (const row of res.body) {
      const rows = businessesByZip[row.postal_code];
      expect(row.business_count).toBe(rows.length);
      expect(Number(row.avg_business_rating)).toBeCloseTo(mean(rows.map((b) => b.stars)), 8);
    }
  });

  test('GET /zip_business_count covers every listed ZIP and no unlisted one', async () => {
    const res = await get('/zip_business_count');
    expect(res.body).toHaveLength(data.zipRegion.length);
    expect(res.body.find((r) => r.postal_code === UNLISTED_ZIP)).toBeUndefined();
    for (const row of res.body) {
      expect(row.business_count).toBe(businessesByZip[row.postal_code].length);
      expect(row.city).toBe(zipByCode[row.postal_code].city);
    }
  });
});

describe('housing endpoints', () => {
  test('GET /housing_trend/:zip returns the full series in date order', async () => {
    const res = await get('/housing_trend/19104');
    const expected = housingByZip['19104'].map((h) => h.zhvi_value).length;
    expect(res.body).toHaveLength(expected);
    const dates = res.body.map((r) => r.trend_date);
    expect(dates).toEqual([...dates].sort());
  });

  test('GET /housing_trend/:zip returns the stored dates exactly, whatever the server time zone', async () => {
    // Regression: dates used to become local-midnight Dates, which serialize as
    // the previous day on a server east of UTC (the test process runs in Asia/Tokyo).
    const res = await get('/housing_trend/19104');
    const expected = housingByZip['19104'].map((h) => h.trend_date).sort();
    expect(res.body.map((r) => r.trend_date)).toEqual(expected);
  });

  test('GET /housing_trend/:zip is an empty list for a ZIP without data', async () => {
    const res = await get(`/housing_trend/${ZIP_WITHOUT_HOUSING}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('GET /monthly_housing averages the readings within each month', async () => {
    const res = await get('/monthly_housing', { postal_code: '19104' });
    expect(res.body).toHaveLength(24);
    const byMonth = groupBy(housingByZip['19104'].map((h) => ({ ...h, month: h.trend_date.slice(0, 7) })), 'month');
    const january2022 = res.body[res.body.length - 1];   // newest first
    expect(byMonth['2022-01']).toHaveLength(2);
    expect(Number(january2022.avg_monthly_zhvi)).toBeCloseTo(mean(byMonth['2022-01'].map((h) => h.zhvi_value)), 6);
  });
});

describe('lookup endpoints', () => {
  test('GET /cities lists distinct cities, optionally by state', async () => {
    const all = await get('/cities');
    expect(all.body.map((c) => c.city).sort()).toEqual([...new Set(data.business.map((b) => b.city))].sort());
    const pa = await get('/cities', { state: 'pa' });
    expect(pa.body).toEqual([{ city: 'Philadelphia', state: 'PA' }]);
  });

  test('GET /zip_codes lists distinct ZIPs, optionally by city', async () => {
    const tampa = await get('/zip_codes', { city: 'Tampa' });
    expect(tampa.body.map((z) => z.postal_code)).toEqual(['33602', '33606']);
    const all = await get('/zip_codes');
    expect(all.body).toHaveLength(Object.keys(businessesByZip).length);
  });

  test('GET /business/:id returns the business with its review summary', async () => {
    const target = data.business[0];
    const res = await get(`/business/${target.business_id}`);
    expect(res.body).toMatchObject({ business_id: target.business_id, name: target.name, postal_code: target.postal_code });
    expect(res.body.total_reviews).toBe(reviewCount(target.business_id));
    expect(Number(res.body.avg_review_stars)).toBeCloseTo(mean(reviewsByBusiness[target.business_id].map((r) => r.stars)), 8);
  });

  test('GET /business/:id reports zero reviews for a business nobody reviewed', async () => {
    const unreviewed = data.business.find((b) => reviewCount(b.business_id) === 0);
    const res = await get(`/business/${unreviewed.business_id}`);
    expect(res.status).toBe(200);
    expect(res.body.total_reviews).toBe(0);
    expect(res.body.avg_review_stars).toBeNull();
  });
});

describe('GET /business_review_stats', () => {
  test('ranks businesses by review count within each city', async () => {
    const res = await get('/business_review_stats', { min_reviews: 1, top_n: 3, limit: 500 });
    expect(res.body).toMatchObject({ page: 1, limit: 500, offset: 0, min_reviews: 1, top_n: 3 });
    const byCity = groupBy(res.body.rows, 'city');
    for (const [city, rows] of Object.entries(byCity)) {
      const listed = data.business
        .filter((b) => zipByCode[b.postal_code] && zipByCode[b.postal_code].city === city && reviewCount(b.business_id) >= 1)
        .map((b) => reviewCount(b.business_id))
        .sort((a, b) => b - a);
      expect(rows[0].total_reviews).toBe(listed[0]);
      expect(rows.every((r) => r.city_review_rank <= 3)).toBe(true);
    }
  });

  test('page 2 continues where page 1 stopped (regression: page used to be ignored)', async () => {
    const query = { min_reviews: 1, top_n: 50, limit: 5 };
    const full = await get('/business_review_stats', { ...query, limit: 500 });
    const page1 = await get('/business_review_stats', { ...query, page: 1 });
    const page2 = await get('/business_review_stats', { ...query, page: 2 });
    const ids = (res) => res.body.rows.map((r) => r.business_id);
    expect(page2.body).toMatchObject({ page: 2, offset: 5 });
    expect(ids(page1)).toEqual(ids(full).slice(0, 5));
    expect(ids(page2)).toEqual(ids(full).slice(5, 10));
    expect(ids(page2)).not.toEqual(ids(page1));
  });

  test('an explicit offset still works and takes priority over page', async () => {
    const res = await get('/business_review_stats', { min_reviews: 1, top_n: 50, limit: 5, page: 9, offset: 5 });
    const page2 = await get('/business_review_stats', { min_reviews: 1, top_n: 50, limit: 5, page: 2 });
    expect(res.body.rows).toEqual(page2.body.rows);
  });
});

describe('GET /top_business_per_zip', () => {
  test('returns the most reviewed business of each ZIP', async () => {
    const res = await get('/top_business_per_zip', { limit: 1000 });
    const zips = new Set(res.body.map((r) => r.postal_code));
    expect(zips.size).toBe(Object.keys(businessesByZip).length);
    for (const row of res.body) {
      const best = Math.max(...businessesByZip[row.postal_code].map((b) => reviewCount(b.business_id)));
      expect(row.review_count).toBe(best);
    }
    const counts = res.body.map((r) => r.review_count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe('GET /high_rated_with_housing', () => {
  test('applies both thresholds, joins the latest ZHVI and drops ZIPs with no state', async () => {
    const res = await get('/high_rated_with_housing', { min_reviews: 10, min_rating: 2.5 });
    const expected = data.business.filter((b) => {
      const reviews = reviewsByBusiness[b.business_id] || [];
      const zip = zipByCode[b.postal_code];
      return reviews.length >= 10 && mean(reviews.map((r) => r.stars)) > 2.5 && zip && zip.state !== null;
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(res.body.map((r) => r.business_id).sort()).toEqual(expected.map((b) => b.business_id).sort());
    for (const row of res.body) {
      const zhvi = latestZhvi(row.postal_code);
      if (zhvi === null) expect(row.latest_zhvi).toBeNull();
      else expect(Number(row.latest_zhvi)).toBeCloseTo(zhvi, 2);
    }
    expect(res.body.some((r) => r.postal_code === ZIP_WITHOUT_HOUSING && r.latest_zhvi === null)).toBe(true);
  });
});

describe('responses', () => {
  test('large payloads are gzip-compressed', async () => {
    const res = await get('/businesses', { limit: 1000, open_only: 'false' });
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});
