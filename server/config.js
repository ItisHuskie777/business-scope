'use strict';

// Configuration is read from environment variables first and falls back to an
// optional, git-ignored config.json (the format used during the course).
// Nothing secret lives in the repository.

const fs = require('fs');
const path = require('path');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function readFileConfig(file = path.join(__dirname, 'config.json')) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`server/config.json is not valid JSON: ${err.message}`);
  }
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function loadConfig(env = process.env, file = readFileConfig()) {
  const host = env.PGHOST || file.rds_host || 'localhost';
  return {
    db: {
      host,
      port: toInt(env.PGPORT || file.rds_port, 5432),
      user: env.PGUSER || file.rds_user || 'postgres',
      password: env.PGPASSWORD !== undefined ? env.PGPASSWORD : file.rds_password,
      database: env.PGDATABASE || file.rds_db || 'postgres',
      // RDS requires TLS; a local or CI database does not offer it.
      ssl: toBool(env.PGSSL, !LOCAL_HOSTS.has(host)),
      statementTimeoutMs: toInt(env.PG_STATEMENT_TIMEOUT_MS, 60000),
      poolMax: toInt(env.PG_POOL_MAX, 10),
    },
    server: {
      host: env.HOST || file.server_host || 'localhost',
      port: toInt(env.PORT || file.server_port, 8080),
    },
    cache: {
      // The Yelp and Zillow data is a static snapshot, so responses are safe to reuse.
      ttlMs: toInt(env.CACHE_TTL_MS, 5 * 60 * 1000),
      maxEntries: toInt(env.CACHE_MAX_ENTRIES, 500),
      maxBytes: toInt(env.CACHE_MAX_BYTES, 64 * 1024 * 1024),
    },
    corsOrigin: env.CORS_ORIGIN || '*',
  };
}

module.exports = { loadConfig, readFileConfig, toBool, toInt };
