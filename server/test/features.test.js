'use strict';

// Search, categories, the review feed, the rating trend and the ZIP comparison,
// each checked against values computed in plain JavaScript from the fixtures.

const request = require('supertest');
const { buildApp } = require('./helpers/app');
const { build, ZIP_WITHOUT_HOUSING } = require('./helpers/fixtures');
const { decodeCursor, encodeCursor, escapeLike } = require('../routes_features');
const pool = require('../db');

const app = buildApp();
const data = build();
afterAll(() => pool.end());

const get = (url, query) => request(app).get(url).query(query || {});
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const categoriesOf = (b) => (b.categories || '').split(',').map((c) => c.trim()).filter(Boolean);
const reviewsOf = (id) => data.review.filter((r) => r.business_id === id);
const businessById = Object.fromEntries(data.business.map((b) => [b.business_id, b]));

describe('GET /search', () => {
  test('a prefix finds the business while the user is still typing', async () => {
    const res = await get('/search', { q: 'starb' });
    expect(res.status).toBe(200);
    expect(res.body.q).toBe('starb');
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows.every((r) => r.name === 'Starbucks')).toBe(true);
  });

  test('a misspelled name still finds it', async () => {
    const res = await get('/search', { q: 'starbuks', limit: 50 });
    const expected = data.business.filter((b) => b.name === 'Starbucks').length;
    expect(res.body.rows.filter((r) => r.name === 'Starbucks')).toHaveLength(expected);
  });

  test('words are matched against categories with stemming', async () => {
    const res = await get('/search', { q: 'bakery', limit: 50 });
    const ids = new Set(res.body.rows.map((r) => r.business_id));
    // "bakery" and "Bakeries" share a stem, so every business in that category is found,
    // not only the ones named "Corner Bakery".
    const inCategory = data.business.filter((b) => categoriesOf(b).includes('Bakeries'));
    expect(inCategory.some((b) => !/bakery/i.test(b.name))).toBe(true);
    for (const b of inCategory) expect(ids.has(b.business_id)).toBe(true);
  });

  test('a name match ranks above a category-only match', async () => {
    const res = await get('/search', { q: 'pizza', limit: 50 });
    const firstCategoryOnly = res.body.rows.findIndex((r) => !/pizza/i.test(r.name));
    const lastNameMatch = res.body.rows.map((r) => /pizza/i.test(r.name)).lastIndexOf(true);
    expect(lastNameMatch).toBeGreaterThanOrEqual(0);
    if (firstCategoryOnly !== -1) expect(lastNameMatch).toBeLessThan(firstCategoryOnly);
    const scores = res.body.rows.map((r) => Number(r.score));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test('results can be narrowed to a city or state', async () => {
    const res = await get('/search', { q: 'starbucks', city: 'Tampa', limit: 50 });
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows.every((r) => r.city === 'Tampa')).toBe(true);
    const pa = await get('/search', { q: 'starbucks', state: 'pa', limit: 50 });
    expect(pa.body.rows.every((r) => r.state === 'PA')).toBe(true);
  });

  test('limit caps the result count', async () => {
    const res = await get('/search', { q: 'restaurants', limit: 3 });
    expect(res.body.rows).toHaveLength(3);
  });

  test('LIKE wildcards in the text are searched for literally', async () => {
    const res = await get('/search', { q: '%%' });
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  test('spaces are normalized', async () => {
    const res = await get('/search', { q: '   starb   ' });
    expect(res.body.q).toBe('starb');
  });

  test.each([
    [{}, /2 to 100/],
    [{ q: 'a' }, /2 to 100/],
    [{ q: 'x'.repeat(101) }, /2 to 100/],
    [{ q: 'starb', state: 'Penn' }, /2-letter/],
  ])('rejects %j', async (query, message) => {
    const res = await get('/search', query);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('a repeated q parameter is rejected rather than passed to SQL as an array', async () => {
    const res = await request(app).get('/search?q=starb&q=pizza');
    expect(res.status).toBe(400);
  });
});

describe('GET /categories', () => {
  const tally = (businesses) => {
    const counts = {};
    for (const b of businesses) for (const c of categoriesOf(b)) (counts[c] = counts[c] || []).push(b);
    return counts;
  };

  test('counts every category across the dataset, most common first', async () => {
    const res = await get('/categories', { limit: 500 });
    const expected = tally(data.business);
    expect(res.body).toHaveLength(Object.keys(expected).length);
    for (const row of res.body) {
      const members = expected[row.category];
      expect(row.business_count).toBe(members.length);
      expect(Number(row.avg_stars)).toBeCloseTo(mean(members.map((b) => b.stars)), 2);
      expect(row.total_reviews).toBe(members.reduce((n, b) => n + reviewsOf(b.business_id).length, 0));
    }
    const counts = res.body.map((r) => r.business_count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  test('can be limited to a city', async () => {
    const res = await get('/categories', { city: 'Tampa', limit: 500 });
    const expected = tally(data.business.filter((b) => b.city === 'Tampa'));
    expect(Object.fromEntries(res.body.map((r) => [r.category, r.business_count])))
      .toEqual(Object.fromEntries(Object.entries(expected).map(([c, m]) => [c, m.length])));
  });

  test('can be limited to a state, and filtered by size', async () => {
    const res = await get('/categories', { state: 'pa', min_businesses: 6, limit: 500 });
    const expected = Object.entries(tally(data.business.filter((b) => b.state === 'PA'))).filter(([, m]) => m.length >= 6);
    expect(res.body.map((r) => r.category).sort()).toEqual(expected.map(([c]) => c).sort());
  });

  test('rejects a malformed state', async () => {
    const res = await get('/categories', { state: 'Pennsylvania' });
    expect(res.status).toBe(400);
  });
});

describe('GET /businesses?category=', () => {
  test('returns exactly the businesses in that category', async () => {
    const res = await get('/businesses', { category: 'Pizza', open_only: 'false', limit: 1000 });
    const expected = data.business.filter((b) => categoriesOf(b).includes('Pizza')).map((b) => b.business_id).sort();
    expect(res.body.rows.map((b) => b.business_id).sort()).toEqual(expected);
  });

  test('combines with the other filters', async () => {
    const res = await get('/businesses', { category: 'Restaurants', city: 'Tampa', open_only: 'false', limit: 1000 });
    const expected = data.business.filter((b) => b.city === 'Tampa' && categoriesOf(b).includes('Restaurants'));
    expect(res.body.rows).toHaveLength(expected.length);
  });

  test('matches whole category names only', async () => {
    const res = await get('/businesses', { category: 'Pizz', open_only: 'false' });
    expect(res.body.rows).toEqual([]);
  });
});

describe('GET /business/:id/reviews', () => {
  const ID = 'biz_00_00';
  // Expected order: newest first, undated last, review_id descending on ties.
  const expectedOrder = () => reviewsOf(ID)
    .map((r) => ({ id: r.review_id, t: r.review_date ? Date.parse(`${r.review_date}Z`) : -Infinity }))
    .sort((a, b) => (b.t - a.t) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((r) => r.id);

  test('walking the cursor visits every review once, in order, including undated ones', async () => {
    const seen = [];
    let cursor;
    for (let i = 0; i < 100; i += 1) {
      const res = await get(`/business/${ID}/reviews`, { limit: 7, ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      seen.push(...res.body.rows.map((r) => r.review_id));
      cursor = res.body.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(expectedOrder());
    expect(reviewsOf(ID).filter((r) => r.review_date === null)).toHaveLength(2);
    // Many fixture reviews share a date, so the review_id tie-breaker is being exercised.
    const dates = reviewsOf(ID).map((r) => r.review_date);
    expect(new Set(dates).size).toBeLessThan(dates.length);
  });

  test('the last page has no next cursor', async () => {
    const res = await get(`/business/${ID}/reviews`, { limit: 100 });
    expect(res.body.rows).toHaveLength(reviewsOf(ID).length);
    expect(res.body.next_cursor).toBeNull();
  });

  test('can be filtered by star rating', async () => {
    const res = await get(`/business/${ID}/reviews`, { stars: 5, limit: 100 });
    expect(res.body.rows.length).toBe(reviewsOf(ID).filter((r) => r.stars === 5).length);
    expect(res.body.rows.every((r) => Number(r.stars) === 5)).toBe(true);
  });

  test('a business without reviews gives an empty page', async () => {
    const unreviewed = data.business.find((b) => reviewsOf(b.business_id).length === 0);
    const res = await get(`/business/${unreviewed.business_id}/reviews`);
    expect(res.body).toEqual({ rows: [], next_cursor: null });
  });

  test('an unknown business is a 404', async () => {
    const res = await get('/business/nope/reviews');
    expect(res.status).toBe(404);
  });

  test.each([
    [{ cursor: 'not-a-cursor' }, /cursor/],
    [{ cursor: Buffer.from('{"k":"yesterday","id":"x"}').toString('base64url') }, /cursor/],
    [{ cursor: Buffer.from('{"k":"2023-01-01 12:00:00"}').toString('base64url') }, /cursor/],
    [{ stars: '6' }, /stars/],
    [{ stars: '4.5' }, /stars/],
  ])('rejects %j', async (query, message) => {
    const res = await get(`/business/${ID}/reviews`, query);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('cursors round-trip', () => {
    const row = { sort_key: '2023-05-01 12:00:00', review_id: 'rev_1' };
    expect(decodeCursor(encodeCursor(row))).toEqual({ k: row.sort_key, id: row.review_id });
    expect(decodeCursor(encodeCursor({ sort_key: '-infinity', review_id: 'r' }))).toEqual({ k: '-infinity', id: 'r' });
  });
});

describe('GET /business/:id/rating_trend', () => {
  test('averages each month of dated reviews, oldest first', async () => {
    const ID = 'biz_00_00';
    const res = await get(`/business/${ID}/rating_trend`);
    const byMonth = {};
    for (const r of reviewsOf(ID).filter((x) => x.review_date)) (byMonth[r.review_date.slice(0, 7)] = byMonth[r.review_date.slice(0, 7)] || []).push(r.stars);
    expect(res.body.map((r) => r.month.slice(0, 7))).toEqual(Object.keys(byMonth).sort());
    for (const row of res.body) {
      const stars = byMonth[row.month.slice(0, 7)];
      expect(row.review_count).toBe(stars.length);
      expect(Number(row.avg_stars)).toBeCloseTo(mean(stars), 3);
    }
  });

  test('an unknown business is a 404', async () => {
    const res = await get('/business/nope/rating_trend');
    expect(res.status).toBe(404);
  });
});

describe('GET /compare', () => {
  test('profiles each ZIP in the order requested', async () => {
    const zips = ['19103', '19104', '33602'];
    const res = await get('/compare', { zips: zips.join(',') });
    expect(res.status).toBe(200);
    expect(res.body.zips.map((z) => z.postal_code)).toEqual(zips);

    for (const profile of res.body.zips) {
      const businesses = data.business.filter((b) => b.postal_code === profile.postal_code);
      const reviews = businesses.flatMap((b) => reviewsOf(b.business_id));
      expect(profile.found).toBe(true);
      expect(profile.business_count).toBe(businesses.length);
      expect(profile.open_count).toBe(businesses.filter((b) => b.is_open === 1).length);
      expect(Number(profile.avg_business_stars)).toBeCloseTo(mean(businesses.map((b) => b.stars)), 2);
      expect(profile.total_reviews).toBe(reviews.length);
      expect(Number(profile.avg_review_stars)).toBeCloseTo(mean(reviews.map((r) => r.stars)), 2);

      const housing = data.housingTrend.filter((h) => h.postal_code === profile.postal_code).sort((a, b) => a.trend_date.localeCompare(b.trend_date));
      const latest = housing[housing.length - 1];
      const yearEarlier = `${Number(latest.trend_date.slice(0, 4)) - 1}${latest.trend_date.slice(4)}`;
      const ago = housing.filter((h) => h.trend_date <= yearEarlier).pop();
      expect(Number(profile.latest_zhvi)).toBeCloseTo(latest.zhvi_value, 2);
      expect(Number(profile.zhvi_one_year_ago)).toBeCloseTo(ago.zhvi_value, 2);
      expect(Number(profile.zhvi_change_pct)).toBeCloseTo((100 * (latest.zhvi_value - ago.zhvi_value)) / ago.zhvi_value, 2);

      const counts = {};
      for (const b of businesses) for (const c of categoriesOf(b)) counts[c] = (counts[c] || 0) + 1;
      const top = Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, 5);
      expect(profile.top_categories).toEqual(top.map(([category, n]) => ({ category, business_count: n })));
    }
  });

  test('a ZIP without housing data has no home values but is still profiled', async () => {
    const res = await get('/compare', { zips: `19104,${ZIP_WITHOUT_HOUSING}` });
    const noHousing = res.body.zips[1];
    expect(noHousing.found).toBe(true);
    expect(noHousing.business_count).toBeGreaterThan(0);
    expect(noHousing.latest_zhvi).toBeNull();
    expect(noHousing.zhvi_change_pct).toBeNull();
  });

  test('an unknown ZIP is reported as not found instead of failing the request', async () => {
    const res = await get('/compare', { zips: '19104,00000' });
    expect(res.status).toBe(200);
    expect(res.body.zips[1]).toMatchObject({ postal_code: '00000', found: false, business_count: 0, top_categories: [] });
  });

  test('a ZIP with businesses but no zip_region row is still found', async () => {
    const unlisted = data.business.find((b) => !data.zipRegion.some((z) => z.postal_code === b.postal_code));
    const res = await get('/compare', { zips: `19104,${unlisted.postal_code}` });
    expect(res.body.zips[1]).toMatchObject({ found: true, city: unlisted.city });
  });

  test.each([
    [{}, /2 to 4/],
    [{ zips: '19104' }, /2 to 4/],
    [{ zips: '19104,19103,33602,33606,37203' }, /2 to 4/],
    [{ zips: '19104,1910' }, /5 digits/],
    [{ zips: '19104,19104' }, /repeat/],
  ])('rejects %j', async (query, message) => {
    const res = await get('/compare', query);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('tolerates spaces and a trailing comma', async () => {
    const res = await get('/compare', { zips: ' 19104 , 19103 ,' });
    expect(res.body.zips.map((z) => z.postal_code)).toEqual(['19104', '19103']);
  });
});

describe('sanity of the fixture for these features', () => {
  test('categories include multi-word names', () => {
    expect(categoriesOf(businessById.biz_00_00).length).toBeGreaterThan(0);
    expect(data.business.some((b) => categoriesOf(b).includes('Coffee & Tea'))).toBe(true);
  });
});
