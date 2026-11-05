'use strict';

// One shared connection pool for the whole process.

const { Pool, types } = require('pg');
const { loadConfig } = require('./config');

// BIGINT (OID 20) arrives as a string by default; counts here fit in a JS number.
types.setTypeParser(20, (val) => parseInt(val, 10));

const { db } = loadConfig();

const pool = new Pool({
  host: db.host,
  port: db.port,
  user: db.user,
  password: db.password,
  database: db.database,
  ssl: db.ssl ? { rejectUnauthorized: false } : false,
  max: db.poolMax,
  statement_timeout: db.statementTimeoutMs,
  query_timeout: db.statementTimeoutMs,
});

// An idle client can be dropped by the server; log it instead of crashing the process.
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = pool;
