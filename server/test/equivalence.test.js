'use strict';

// The optimized handlers must return the same answers as the queries they
// replaced. Two references are used:
//   - routes.js, the unoptimized Milestone 3 handlers that scan the base tables;
//   - the Milestone 4 SQL for Q8 and Q11 (test/helpers/ms4Queries.js), which the
//     mv_zip_summary rewrite replaced.

const request = require('supertest');
const { buildApp, callHandler } = require('./helpers/app');
const { build } = require('./helpers/fixtures');
const baseline = require('../routes');
const ms4 = require('./helpers/ms4Queries');
const pool = require('../db');

const app = buildApp();
const data = build();
afterAll(() => pool.end());

// numeric columns come back as strings; compare them as numbers with a tolerance.
const num = (value) => (value === null || value === undefined ? null : Number(value));
const expectClose = (actual, expected) => {
  if (expected === null) expect(actual).toBeNull();
  else expect(actual).toBeCloseTo(expected, 8);
};
const byKey = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r]));

describe('materialized-view rewrites vs the unoptimized baseline', () => {
  test('Q5 /business_review_stats', async () => {
    const query = { min_reviews: '1', top_n: '50', limit: '500' };
    const optimized = (await request(app).get('/business_review_stats').query(query)).body.rows;
    const reference = (await callHandler(baseline.businessReviewStats, { query })).body.rows;

    expect(optimized.length).toBe(reference.length);
    expect(optimized.length).toBeGreaterThan(20);
    const ref = byKey(reference, 'business_id');
    for (const row of optimized) {
      const expected = ref[row.business_id];
      expect(expected).toBeDefined();
      expect(row.total_reviews).toBe(expected.total_reviews);
      expect(row.city).toBe(expected.city);
      expect(row.city_review_rank).toBe(expected.city_review_rank);
      expectClose(num(row.avg_review_rating), num(expected.avg_review_rating));
    }
  });

  test('Q6 /top_business_per_zip', async () => {
    const query = { limit: '1000' };
    const optimized = (await request(app).get('/top_business_per_zip').query(query)).body;
    const reference = (await callHandler(baseline.topBusinessPerZip, { query })).body;
    const key = (r) => `${r.postal_code}|${r.name}|${r.review_count}`;
    expect(optimized.map(key).sort()).toEqual(reference.map(key).sort());
  });

  test('Q4 /high_rated_with_housing (baseline plus the documented state-is-known filter)', async () => {
    const query = { min_reviews: '10', min_rating: '2.5' };
    const optimized = (await request(app).get('/high_rated_with_housing').query(query)).body;
    const zipHasState = new Set(data.zipRegion.filter((z) => z.state !== null).map((z) => z.postal_code));
    const reference = (await callHandler(baseline.highRatedWithHousing, { query })).body
      .filter((r) => zipHasState.has(r.postal_code));

    expect(optimized.length).toBe(reference.length);
    const ref = byKey(reference, 'business_id');
    for (const row of optimized) {
      const expected = ref[row.business_id];
      expect(expected).toBeDefined();
      expect(row.review_count).toBe(expected.review_count);
      expectClose(num(row.avg_review_stars), num(expected.avg_review_stars));
      expectClose(num(row.latest_zhvi), num(expected.latest_zhvi));
    }
  });
});

describe('mv_zip_summary rewrite vs the Milestone 4 queries', () => {
  test.each([1, 5, 7, 8])('Q8 /rating_vs_housing with min_businesses=%i', async (minBusinesses) => {
    const optimized = (await request(app).get('/rating_vs_housing').query({ min_businesses: minBusinesses })).body;
    const reference = (await pool.query(ms4.RATING_VS_HOUSING, [minBusinesses])).rows;

    expect(optimized.map((r) => r.postal_code).sort()).toEqual(reference.map((r) => r.postal_code).sort());
    const ref = byKey(reference, 'postal_code');
    for (const row of optimized) {
      const expected = ref[row.postal_code];
      expect(row.city).toBe(expected.city);
      expect(row.business_count).toBe(expected.business_count);
      expectClose(num(row.avg_business_rating), num(expected.avg_business_rating));
      expectClose(num(row.avg_review_rating), num(expected.avg_review_rating));
      expectClose(num(row.total_reviews), num(expected.total_reviews));
      expectClose(num(row.latest_zhvi), num(expected.latest_zhvi));
    }
    // Same primary ordering: most expensive ZIP first.
    const prices = optimized.map((r) => num(r.latest_zhvi));
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  test.each([1, 5, 7, 8])('Q11 /opportunity_score with min_businesses=%i', async (minBusinesses) => {
    const optimized = (await request(app).get('/opportunity_score').query({ min_businesses: minBusinesses })).body;
    const reference = (await pool.query(ms4.OPPORTUNITY_SCORE, [minBusinesses])).rows;

    expect(optimized.map((r) => r.postal_code).sort()).toEqual(reference.map((r) => r.postal_code).sort());
    const ref = byKey(reference, 'postal_code');
    for (const row of optimized) {
      const expected = ref[row.postal_code];
      // Rounded to two decimals in SQL on both sides, so these must match exactly.
      expect(row).toEqual(expected);
    }
    const scores = optimized.map((r) => num(r.avg_review_stars));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test('the fixture exercises the filters (a ZIP is dropped for a NULL region_name, another for no housing data)', async () => {
    const q8 = (await request(app).get('/rating_vs_housing').query({ min_businesses: 1 })).body.map((r) => r.postal_code);
    const q11 = (await request(app).get('/opportunity_score').query({ min_businesses: 1 })).body.map((r) => r.postal_code);
    expect(q8).toContain('37206');
    expect(q11).not.toContain('37206');
    expect(q8).not.toContain('33606');
    expect(q8).not.toContain('99999');
  });
});
