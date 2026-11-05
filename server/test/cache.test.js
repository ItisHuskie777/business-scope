'use strict';

const request = require('supertest');
const { TtlCache } = require('../cache');
const { buildApp } = require('./helpers/app');
const pool = require('../db');

afterAll(() => pool.end());

describe('TtlCache', () => {
  test('returns a stored value until its TTL passes', () => {
    let now = 1000;
    const cache = new TtlCache({ ttlMs: 500, maxEntries: 10, now: () => now });
    cache.set('a', 'value');
    expect(cache.get('a')).toBe('value');
    now += 499;
    expect(cache.get('a')).toBe('value');
    now += 1;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0, hits: 2, misses: 1 });
  });

  test('evicts the least recently used entry when full', () => {
    const cache = new TtlCache({ ttlMs: 1000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');        // 'b' is now the least recently used
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  test('evicts by total size, not only by entry count', () => {
    const cache = new TtlCache({ ttlMs: 1000, maxEntries: 100, maxBytes: 100 });
    cache.set('a', 'x'.repeat(40));
    cache.set('b', 'x'.repeat(40));
    expect(cache.stats().bytes).toBe(80);
    cache.set('c', 'x'.repeat(40));          // 120 bytes would exceed the budget
    expect(cache.get('a')).toBeUndefined();   // oldest entry made room
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.stats().bytes).toBe(80);
  });

  test('does not keep a value larger than the whole budget', () => {
    const cache = new TtlCache({ ttlMs: 1000, maxEntries: 100, maxBytes: 100 });
    cache.set('small', 'x'.repeat(10));
    cache.set('huge', 'x'.repeat(500));
    expect(cache.get('huge')).toBeUndefined();
    expect(cache.get('small')).toBeDefined();
    expect(cache.stats().bytes).toBe(10);
  });

  test('replacing a key does not double-count its size', () => {
    const cache = new TtlCache({ ttlMs: 1000, maxEntries: 100, maxBytes: 1000 });
    cache.set('a', 'x'.repeat(50));
    cache.set('a', 'x'.repeat(20));
    expect(cache.stats()).toMatchObject({ entries: 1, bytes: 20 });
  });

  test('peek reads without counting a hit or refreshing recency', () => {
    const cache = new TtlCache({ ttlMs: 1000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.peek('a')).toBe(1);
    cache.set('c', 3);                        // 'a' is still the oldest, so it goes
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.stats().hits).toBe(0);
  });

  test('an explicit size is used for values that are not strings', () => {
    const cache = new TtlCache({ ttlMs: 1000, maxEntries: 10, maxBytes: 100 });
    cache.set('a', { json: 'x', gzip: null }, 60);
    cache.set('b', { json: 'y', gzip: null }, 60);
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.stats()).toMatchObject({ entries: 1, bytes: 60 });
  });

  test('stores nothing when disabled', () => {
    const cache = new TtlCache({ ttlMs: 0, maxEntries: 10 });
    cache.set('a', 1);
    expect(cache.enabled).toBe(false);
    expect(cache.get('a')).toBeUndefined();
  });

  test('clear empties the cache', () => {
    const cache = new TtlCache({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    cache.clear();
    expect(cache.stats().entries).toBe(0);
  });
});

describe('response cache middleware', () => {
  const app = buildApp({ cache: { ttlMs: 60000, maxEntries: 50, maxBytes: 8 * 1024 * 1024 } });
  let querySpy;

  beforeEach(() => {
    app.locals.cache.clear();
    querySpy = jest.spyOn(pool, 'query');
  });
  afterEach(() => querySpy.mockRestore());

  test('a repeated request is served from memory without touching the database', async () => {
    const first = await request(app).get('/city_business_stats');
    expect(first.status).toBe(200);
    expect(first.headers['x-cache']).toBe('MISS');
    expect(querySpy).toHaveBeenCalledTimes(1);

    const second = await request(app).get('/city_business_stats');
    expect(second.status).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.headers['cache-control']).toBe('public, max-age=60');
    expect(second.body).toEqual(first.body);
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  // The gzip copy is produced in the background right after the first response.
  const waitForGzip = async (url) => {
    for (let i = 0; i < 200; i += 1) {
      const entry = app.locals.cache.peek(url);
      if (entry && entry.gzip) return entry;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`no gzip copy was stored for ${url}`);
  };

  test('a hit on a large response sends the stored gzip bytes', async () => {
    const url = '/businesses?limit=1000&open_only=false';
    const first = await request(app).get(url);
    const entry = await waitForGzip(url);

    const second = await request(app).get(url);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.headers['content-encoding']).toBe('gzip');
    expect(second.headers.vary).toMatch(/Accept-Encoding/);
    expect(second.body).toEqual(first.body);
    expect(querySpy).toHaveBeenCalledTimes(1);
    // The cache accounts for both copies of the body.
    expect(app.locals.cache.stats().bytes).toBe(Buffer.byteLength(entry.json) + entry.gzip.length);
    expect(entry.gzip.length).toBeLessThan(Buffer.byteLength(entry.json) / 3);
  });

  test('a client that does not accept gzip gets the plain body from the same entry', async () => {
    const url = '/businesses?limit=1000&open_only=false';
    const first = await request(app).get(url);
    await waitForGzip(url);

    const plain = await request(app).get(url).set('Accept-Encoding', 'identity');
    expect(plain.headers['x-cache']).toBe('HIT');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toEqual(first.body);
  });

  test('small responses are stored uncompressed', async () => {
    const url = '/cities?state=PA';
    await request(app).get(url);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.locals.cache.peek(url)).toEqual({ json: JSON.stringify([{ city: 'Philadelphia', state: 'PA' }]), gzip: null });
    const hit = await request(app).get(url);
    expect(hit.headers['x-cache']).toBe('HIT');
    expect(hit.headers['content-encoding']).toBeUndefined();
    expect(hit.body).toEqual([{ city: 'Philadelphia', state: 'PA' }]);
  });

  test('different query strings are cached separately', async () => {
    const a = await request(app).get('/opportunity_score?min_businesses=1');
    const b = await request(app).get('/opportunity_score?min_businesses=8');
    expect(a.headers['x-cache']).toBe('MISS');
    expect(b.headers['x-cache']).toBe('MISS');
    expect(a.body.length).toBeGreaterThan(b.body.length);
    expect(querySpy).toHaveBeenCalledTimes(2);
  });

  test('error responses are not cached', async () => {
    const first = await request(app).get('/housing_trend/abc');
    const second = await request(app).get('/housing_trend/abc');
    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(second.headers['x-cache']).toBeUndefined();
  });

  test('/health always checks the database', async () => {
    await request(app).get('/health');
    await request(app).get('/health');
    expect(querySpy).toHaveBeenCalledTimes(2);
  });
});
