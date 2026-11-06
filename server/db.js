'use strict';

// One shared connection pool for the whole process.

const { Pool, types } = require('pg');
const { loadConfig } = require('./config');

// BIGINT (OID 20) arrives as a string by default; counts here fit in a JS number.
types.setTypeParser(20, (val) => parseInt(val, 10));

// DATE (1082) and TIMESTAMP WITHOUT TIME ZONE (1114) carry no time zone. By
// default the driver turns them into JavaScript Dates at local midnight, so on a
// server east of UTC every date serializes as the previous day. Return them as
// the ISO 8601 text PostgreSQL stored instead.
types.setTypeParser(1082, (val) => val);
types.setTypeParser(1114, (val) => val.replace(' ', 'T'));

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
