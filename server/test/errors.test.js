'use strict';

const request = require('supertest');
const { buildApp } = require('./helpers/app');
const pool = require('../db');

const app = buildApp();
afterAll(() => pool.end());

// Every endpoint that runs a query, with inputs that pass validation.
const QUERY_ROUTES = [
  '/businesses',
  '/postal_code_stats',
  '/city_business_stats',
  '/business_review_stats',
  '/high_rated_with_housing',
  '/top_business_per_zip',
  '/housing_trend/19104',
  '/rating_vs_housing',
  '/zip_business_count',
  '/monthly_housing?postal_code=19104',
  '/opportunity_score',
  '/cities',
  '/cities?state=PA',
  '/zip_codes',
  '/zip_codes?city=Tampa',
  '/business/biz_00_00',
];

describe('database failures', () => {
  let querySpy;
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    querySpy.mockRestore();
    errorSpy.mockRestore();
  });

  test.each(QUERY_ROUTES)('%s answers 504 when the statement times out', async (url) => {
    querySpy = jest.spyOn(pool, 'query').mockRejectedValue(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }));
    const res = await request(app).get(url);
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/timed out/i);
  });

  test.each(QUERY_ROUTES)('%s answers 500 with a JSON error on any other failure', async (url) => {
    querySpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('connection refused'));
    const res = await request(app).get(url);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/^Failed to fetch/);
    // The driver's message must not leak to the client.
    expect(JSON.stringify(res.body)).not.toMatch(/connection refused/);
  });

  test('/health reports 503 when the database is unreachable', async () => {
    querySpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
  });
});

describe('routing', () => {
  test('/health reports ok when the database answers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('unknown paths get a JSON 404', async () => {
    const res = await request(app).get('/no_such_route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  test('a malformed URL escape is a JSON 400, not an HTML error page', async () => {
    const res = await request(app).get('/business/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad request' });
  });

  test('a synchronous throw from the driver is still a JSON 500', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const spy = jest.spyOn(pool, 'query').mockImplementation(() => { throw new Error('boom'); });
    const res = await request(app).get('/cities');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch cities' });
    spy.mockRestore();
    errorSpy.mockRestore();
  });

  test('an idle-connection error is logged instead of crashing the process', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => pool.emit('error', new Error('server closed the connection'))).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('the framework is not advertised', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
