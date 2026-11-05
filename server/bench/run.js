'use strict';

// Benchmark: baseline handlers vs the Milestone 4 rewrite vs the current code,
// on a synthetic dataset at production row counts, plus the HTTP-level effect
// of the response cache and gzip.
//
//   npm run bench                 full scale (several GB, 10-20 minutes)
//   BENCH_SCALE=0.05 npm run bench   quick run on 5% of the data
//
// Uses PGHOST if set (the database's tables are dropped and recreated);
// otherwise starts a throwaway local PostgreSQL in BENCH_DATA_DIR
// (default server/.pgdata-bench) and removes it afterwards.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');

const SCALE = Number(process.env.BENCH_SCALE || 1);
const RUNS = Number(process.env.BENCH_RUNS || 5);
const BASELINE_RUNS = Number(process.env.BENCH_BASELINE_RUNS || 2);
const DATA_DIR = process.env.BENCH_DATA_DIR || path.join(__dirname, '..', '.pgdata-bench');
const OUT = path.join(__dirname, 'results.json');

const log = (msg) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;

async function timed(fn, runs) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    await fn();
    samples.push(ms(start));
  }
  return { median: median(samples), min: Math.min(...samples), samples };
}

function httpGet(port, url, gzip) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const req = http.get({ host: '127.0.0.1', port, path: url, headers: gzip ? { 'accept-encoding': 'gzip' } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ms: ms(start), bytes: Buffer.concat(chunks).length, cache: res.headers['x-cache'], status: res.statusCode }));
    });
    req.on('error', reject);
  });
}

(async () => {
  let server;
  if (!process.env.PGHOST) {
    const localPostgres = require('../db/localPostgres');
    localPostgres.stopByDataDir(DATA_DIR);
    log(`starting local PostgreSQL in ${DATA_DIR}`);
    server = localPostgres.start({ dataDir: DATA_DIR, port: Number(process.env.BENCH_PG_PORT || 55433) });
    Object.assign(process.env, { PGHOST: '127.0.0.1', PGPORT: String(server.connection.port), PGUSER: 'postgres', PGPASSWORD: '', PGDATABASE: 'postgres', PGSSL: 'false' });
  }
  process.env.PG_STATEMENT_TIMEOUT_MS = '0';   // baselines can run for a long time

  const pool = require('../db');
  const setup = require('../db/setupDatabase');
  const { runSqlFile } = require('../db/runSql');
  const { seed } = require('./seed');
  const { callHandler } = require('../test/helpers/app');
  const baseline = require('../routes');
  const current = require('../routes_optimized');
  const ms4 = require('../test/helpers/ms4Queries');
  const { createApp } = require('../app');
  const { loadConfig } = require('../config');

  const rowCount = (body) => (Array.isArray(body) ? body.length : body && Array.isArray(body.rows) ? body.rows.length : 1);
  // Times a handler and records how many rows it returned.
  const bench = async (fn, runs, warm = true) => {
    let rows = null;
    if (warm) rows = rowCount((await fn()).body);
    const t = await timed(async () => { const res = await fn(); if (rows === null) rows = rowCount(res.body); }, runs);
    return { ...t, rows };
  };

  const results = { scale: SCALE, runs: RUNS, baselineRuns: BASELINE_RUNS, startedAt: new Date().toISOString(), cpus: require('os').cpus().length };
  const client = await pool.connect();
  try {
    results.postgres = (await client.query('SHOW server_version')).rows[0].server_version;
    await setup.dropDerived(client);
    await setup.createSchema(client);
    let t = process.hrtime.bigint();
    results.rowCounts = await seed(client, SCALE, log);
    results.seedSeconds = ms(t) / 1000;
    log(`seeded in ${results.seedSeconds.toFixed(0)} s`);

    const top = (await client.query('SELECT business_id, COUNT(*) AS n FROM review GROUP BY business_id ORDER BY n DESC LIMIT 1')).rows[0];
    results.sampleBusiness = { id: top.business_id, reviews: top.n };

    // ---- 1. Baseline: before any optimization object exists -------------------
    log('timing BASELINE handlers (no extra indexes, no materialized views)');
    const baselineCases = {
      q4_high_rated_with_housing: () => callHandler(baseline.highRatedWithHousing, { query: {} }),
      q5_business_review_stats: () => callHandler(baseline.businessReviewStats, { query: {} }),
      q6_top_business_per_zip: () => callHandler(baseline.topBusinessPerZip, { query: {} }),
      q8_rating_vs_housing: () => callHandler(baseline.ratingVsHousing, { query: {} }),
      q11_opportunity_score: () => callHandler(baseline.opportunityScore, { query: {} }),
      business_by_id: () => callHandler(baseline.businessById, { params: { id: top.business_id } }),
    };
    results.baseline = {};
    for (const [name, fn] of Object.entries(baselineCases)) {
      results.baseline[name] = await bench(fn, BASELINE_RUNS, false);
      log(`  ${name}: ${results.baseline[name].median.toFixed(0)} ms (${results.baseline[name].rows} rows)`);
    }

    // ---- 2. Milestone 4: indexes + three materialized views ------------------
    t = process.hrtime.bigint();
    await setup.buildDerived(client, { lookupIndexes: false });
    results.buildCoreSeconds = ms(t) / 1000;
    log(`indexes + materialized views built in ${results.buildCoreSeconds.toFixed(0)} s`);

    log('timing MILESTONE 4 queries (aggregated per request from three materialized views)');
    const ms4TopPerZip = `
      SELECT postal_code, name, review_count FROM (
        SELECT b.postal_code, b.name, b.business_id, COALESCE(brs.review_count, 0) AS review_count,
               RANK() OVER (PARTITION BY b.postal_code ORDER BY COALESCE(brs.review_count, 0) DESC) AS rnk
        FROM business b LEFT JOIN mv_business_review_summary brs ON b.business_id = brs.business_id) t
      WHERE rnk = 1 ORDER BY review_count DESC LIMIT $1`;
    const asBody = (promise) => promise.then((r) => ({ body: r.rows }));
    results.ms4 = {
      q6_top_business_per_zip: await bench(() => asBody(pool.query(ms4TopPerZip, [100])), RUNS),
      q8_rating_vs_housing: await bench(() => asBody(pool.query(ms4.RATING_VS_HOUSING, [5])), RUNS),
      q11_opportunity_score: await bench(() => asBody(pool.query(ms4.OPPORTUNITY_SCORE, [10])), RUNS),
      // Milestone 4 aggregated the business's reviews through idx_review_business_id.
      business_by_id: await bench(() => callHandler(baseline.businessById, { params: { id: top.business_id } }), RUNS),
    };
    for (const [name, r] of Object.entries(results.ms4)) log(`  ${name}: ${r.median.toFixed(2)} ms (${r.rows} rows)`);

    // ---- 3. Lookup endpoints before and after their indexes -------------------
    const lookupCases = {
      businesses_by_state_city: () => callHandler(current.businesses, { query: { state: 'PA', city: 'City 14', limit: '500' } }),
      businesses_first_page: () => callHandler(current.businesses, { query: { limit: '100' } }),
      cities_by_state: () => callHandler(current.cities, { query: { state: 'PA' } }),
      zip_codes_by_city: () => callHandler(current.zipCodes, { query: { city: 'City 14' } }),
    };
    log('timing lookup endpoints WITHOUT their indexes');
    results.lookupBefore = {};
    for (const [name, fn] of Object.entries(lookupCases)) {
      results.lookupBefore[name] = await bench(fn, RUNS);
      log(`  ${name}: ${results.lookupBefore[name].median.toFixed(2)} ms (${results.lookupBefore[name].rows} rows)`);
    }
    t = process.hrtime.bigint();
    await runSqlFile(client, setup.LOOKUP_INDEXES);
    results.buildLookupIndexSeconds = ms(t) / 1000;

    // ---- 4. Current code ------------------------------------------------------
    log('timing CURRENT handlers');
    const cases = {
      q4_high_rated_with_housing: () => callHandler(current.highRatedWithHousing, { query: {} }),
      q5_business_review_stats: () => callHandler(current.businessReviewStats, { query: {} }),
      q6_top_business_per_zip: () => callHandler(current.topBusinessPerZip, { query: {} }),
      q8_rating_vs_housing: () => callHandler(current.ratingVsHousing, { query: {} }),
      q11_opportunity_score: () => callHandler(current.opportunityScore, { query: {} }),
      business_by_id: () => callHandler(current.businessById, { params: { id: top.business_id } }),
      ...lookupCases,
      businesses_by_zip: () => callHandler(current.businesses, { query: { postal_code: '10014', limit: '500' } }),
      cities_all: () => callHandler(current.cities, { query: {} }),
      postal_code_stats: () => callHandler(current.postalCodeStats, { query: {} }),
      city_business_stats: () => callHandler(current.cityBusinessStats, { query: {} }),
      zip_business_count: () => callHandler(current.zipBusinessCount, { query: {} }),
      housing_trend: () => callHandler(current.housingTrend, { params: { postal_code: '10014' } }),
      monthly_housing: () => callHandler(current.monthlyHousing, { query: { postal_code: '10014' } }),
    };
    results.current = {};
    for (const [name, fn] of Object.entries(cases)) {
      results.current[name] = await bench(fn, RUNS);
      log(`  ${name}: ${results.current[name].median.toFixed(2)} ms (${results.current[name].rows} rows)`);
    }

    results.sizes = (await client.query(`
      SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS rows, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm') ORDER BY pg_total_relation_size(c.oid) DESC`)).rows;

    log('timing a full refresh of the materialized views');
    t = process.hrtime.bigint();
    await runSqlFile(client, setup.REFRESH);
    results.refreshAllSeconds = ms(t) / 1000;
  } finally {
    client.release();
  }

  // ---- 5. HTTP layer: response cache and gzip ----------------------------------
  log('HTTP layer: cache miss vs hit, raw vs gzip payload');
  const config = loadConfig();
  const app = createApp({ ...config, cache: { ...config.cache, ttlMs: 600000 } });
  const httpServer = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = httpServer.address().port;
  results.http = {};
  for (const url of ['/rating_vs_housing', '/opportunity_score', '/zip_business_count', '/postal_code_stats', '/cities', '/top_business_per_zip?limit=1000', '/high_rated_with_housing']) {
    app.locals.cache.clear();
    const miss = await httpGet(port, url, true);
    await new Promise((resolve) => setTimeout(resolve, 300));   // let the background gzip copy land
    const hits = [];
    for (let i = 0; i < 30; i += 1) hits.push((await httpGet(port, url, true)).ms);
    const raw = await httpGet(port, url, false);
    results.http[url] = { missMs: miss.ms, hitMsMedian: median(hits), rawBytes: raw.bytes, gzipBytes: miss.bytes };
    log(`  ${url}: miss ${miss.ms.toFixed(1)} ms, hit ${median(hits).toFixed(2)} ms, ${raw.bytes} -> ${miss.bytes} bytes`);
  }
  await new Promise((resolve) => httpServer.close(resolve));

  results.finishedAt = new Date().toISOString();
  results.loadAverage = require('os').loadavg();
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  log(`results written to ${OUT}`);

  await pool.end();
  if (server) server.stop();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
