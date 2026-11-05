'use strict';

const { loadConfig } = require('../../config');
const { createApp } = require('../../app');

// App instance for tests. The response cache is off unless a test asks for it,
// so each request really reaches the database.
function buildApp({ cache = { ttlMs: 0, maxEntries: 0, maxBytes: 0 } } = {}) {
  return createApp({ ...loadConfig(), cache });
}

// Call an Express handler directly and capture what it sent.
async function callHandler(handler, { query = {}, params = {} } = {}) {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({ query, params }, res);
  return res;
}

module.exports = { buildApp, callHandler };
