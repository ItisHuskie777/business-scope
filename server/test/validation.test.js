'use strict';

const request = require('supertest');
const { buildApp } = require('./helpers/app');
const pool = require('../db');

const app = buildApp();
afterAll(() => pool.end());

describe('input validation', () => {
  test.each([
    ['/housing_trend/1910', /5-digit ZIP/],
    ['/housing_trend/abcde', /5-digit ZIP/],
    ['/monthly_housing', /required/],
    ['/monthly_housing?postal_code=191045', /5-digit ZIP/],
    ['/businesses?postal_code=12', /5-digit ZIP/],
    ['/businesses?state=Pennsylvania', /2-letter/],
    ['/cities?state=P1', /2-letter/],
  ])('%s is rejected with 400', async (url, message) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('a ZIP that only looks like SQL is treated as invalid input, not executed', async () => {
    const res = await request(app).get(`/housing_trend/${encodeURIComponent("19104' OR '1'='1")}`);
    expect(res.status).toBe(400);
  });

  test('filter values are bound as parameters, so quotes cannot change the query', async () => {
    const res = await request(app).get('/businesses').query({ city: "Tampa' OR '1'='1", open_only: 'false' });
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  test('an unknown business id is a 404', async () => {
    const res = await request(app).get('/business/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Business not found');
  });
});

describe('numeric parameters are clamped rather than trusted', () => {
  test('limit is capped at its maximum and floored at 1', async () => {
    const big = await request(app).get('/businesses?limit=999999&open_only=false');
    expect(big.body.limit).toBe(1000);
    const zero = await request(app).get('/businesses?limit=0');
    expect(zero.body.limit).toBe(1);
    expect(zero.body.rows).toHaveLength(1);
  });

  test('non-numeric values fall back to defaults', async () => {
    const res = await request(app).get('/business_review_stats?limit=abc&top_n=xyz&min_reviews=&page=-3');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: 50, top_n: 5, min_reviews: 50, page: 1, offset: 0 });
  });

  test('top_n is capped at 50', async () => {
    const res = await request(app).get('/business_review_stats?top_n=5000');
    expect(res.body.top_n).toBe(50);
  });
});
