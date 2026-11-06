'use strict';

const request = require('supertest');
const { TokenBucketLimiter } = require('../rateLimit');
const { buildApp } = require('./helpers/app');
const pool = require('../db');

afterAll(() => pool.end());

describe('TokenBucketLimiter', () => {
  const make = (opts) => {
    const clock = { t: 0 };
    const limiter = new TokenBucketLimiter({ now: () => clock.t, ...opts });
    return { limiter, clock };
  };

  test('allows a burst, then refuses until tokens refill', () => {
    const { limiter, clock } = make({ perMinute: 60, burst: 3 });   // one token a second
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, true]);
    const refused = limiter.take('a');
    expect(refused).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
    clock.t += 999;
    expect(limiter.take('a').allowed).toBe(false);
    clock.t += 1;
    expect(limiter.take('a').allowed).toBe(true);
  });

  test('refills up to the burst size and no further', () => {
    const { limiter, clock } = make({ perMinute: 60, burst: 3 });
    limiter.take('a');
    clock.t += 60 * 60 * 1000;   // an hour idle
    expect(limiter.take('a').remaining).toBe(2);
  });

  test('clients have separate buckets', () => {
    const { limiter } = make({ perMinute: 60, burst: 1 });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    expect(limiter.take('b').allowed).toBe(true);
  });

  test('Retry-After reflects how long the next token takes', () => {
    const { limiter } = make({ perMinute: 6, burst: 1 });   // one token every 10 s
    limiter.take('a');
    expect(limiter.take('a').retryAfterSeconds).toBe(10);
  });

  test('idle clients are swept once their bucket would be full again', () => {
    const { limiter, clock } = make({ perMinute: 60, burst: 2 });
    limiter.take('a');
    limiter.take('b');
    clock.t += 61000;
    limiter.take('c');   // triggers the sweep
    expect([...limiter.buckets.keys()]).toEqual(['c']);
  });

  test('memory stays bounded: the stalest client is dropped at the cap', () => {
    const { limiter } = make({ perMinute: 60, burst: 2, maxClients: 2 });
    limiter.take('a');
    limiter.take('b');
    limiter.take('a');   // 'b' is now the stalest
    limiter.take('c');
    expect([...limiter.buckets.keys()].sort()).toEqual(['a', 'c']);
  });

  test('a zero rate turns limiting off', () => {
    expect(new TokenBucketLimiter({ perMinute: 0, burst: 10 }).enabled).toBe(false);
  });
});

describe('rate limiting over HTTP', () => {
  test('the 4th request in a burst of 3 is refused with 429 and Retry-After', async () => {
    const app = buildApp({ rateLimit: { perMinute: 60, burst: 3 } });
    const statuses = [];
    let last;
    for (let i = 0; i < 4; i += 1) {
      last = await request(app).get('/cities?state=PA');
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(last.body).toEqual({ error: 'Too many requests, slow down' });
    expect(Number(last.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(last.headers['ratelimit-limit']).toBe('3');
    expect(last.headers['ratelimit-remaining']).toBe('0');
  });

  test('/health is never limited', async () => {
    const app = buildApp({ rateLimit: { perMinute: 60, burst: 1 } });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await request(app).get('/health')).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });

  test('cached responses count too, so a client cannot bypass the limit via the cache', async () => {
    const app = buildApp({ rateLimit: { perMinute: 60, burst: 2 }, cache: { ttlMs: 60000, maxEntries: 10, maxBytes: 1e6 } });
    await request(app).get('/cities?state=PA');
    const hit = await request(app).get('/cities?state=PA');
    expect(hit.headers['x-cache']).toBe('HIT');
    expect((await request(app).get('/cities?state=PA')).status).toBe(429);
  });
});
