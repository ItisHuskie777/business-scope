'use strict';

// Input helpers shared by the route modules.

const ZIP_RE = /^\d{5}$/;
const STATE_RE = /^[A-Za-z]{2}$/;

const isValidZip = (zip) => typeof zip === 'string' && ZIP_RE.test(zip);

// Parse an integer query parameter into [min, max]; anything unparsable gives the fallback.
const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const clampFloat = (raw, fallback, min, max) => {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

// Express turns a repeated parameter (?q=a&q=b) into an array; treat that as invalid
// instead of letting an array reach a query.
const singleString = (value) => (typeof value === 'string' ? value : undefined);

// 57014 is PostgreSQL's statement_timeout; report it as 504 so the client knows to narrow the request.
const handleDbError = (err, res, fallbackMsg) => {
  console.error(err);
  if (err && err.code === '57014') {
    return res.status(504).json({ error: 'Query timed out — please refine your filters' });
  }
  res.status(500).json({ error: fallbackMsg });
};

module.exports = { ZIP_RE, STATE_RE, isValidZip, clampInt, clampFloat, singleString, handleDbError };
