'use strict';

// Builds the Express application. Kept separate from server.js so tests can
// drive the app in-process without opening a port.

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { TtlCache, cacheMiddleware } = require('./cache');
const routes = require('./routes_optimized');
const pool = require('./db');

function createApp(config) {
  const app = express();
  const cache = new TtlCache(config.cache);

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  // Several endpoints return thousands of rows; gzip cuts those payloads by roughly 10x.
  app.use(compression());

  // Liveness and readiness: confirms the process is up and the database answers.
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', cache: cache.stats() });
    } catch (err) {
      res.status(503).json({ status: 'unavailable', error: 'database unreachable' });
    }
  });

  app.use(cacheMiddleware(cache));

  app.get('/businesses', routes.businesses);
  app.get('/postal_code_stats', routes.postalCodeStats);
  app.get('/city_business_stats', routes.cityBusinessStats);
  app.get('/business_review_stats', routes.businessReviewStats);
  app.get('/high_rated_with_housing', routes.highRatedWithHousing);
  app.get('/top_business_per_zip', routes.topBusinessPerZip);
  app.get('/housing_trend/:postal_code', routes.housingTrend);
  app.get('/rating_vs_housing', routes.ratingVsHousing);
  app.get('/zip_business_count', routes.zipBusinessCount);
  app.get('/monthly_housing', routes.monthlyHousing);
  app.get('/opportunity_score', routes.opportunityScore);
  app.get('/cities', routes.cities);
  app.get('/zip_codes', routes.zipCodes);
  app.get('/business/:id', routes.businessById);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  // Last-resort handler so a failure still yields JSON, not an HTML stack trace.
  // Express reports client mistakes (for example a malformed URL escape) with a 4xx status.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const clientError = err && err.status >= 400 && err.status < 500;
    if (!clientError) console.error(err);
    res.status(clientError ? err.status : 500)
      .json({ error: clientError ? 'Bad request' : 'Internal server error' });
  });

  app.locals.cache = cache;
  return app;
}

module.exports = { createApp };
