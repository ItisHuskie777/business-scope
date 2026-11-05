'use strict';

// Runs once before the whole suite: get a database, create the schema, seed it,
// build indexes and materialized views, and tell the test workers how to connect.
//
// If PGHOST is set (CI service container, or your own database) that server is
// used. Otherwise a throwaway local PostgreSQL is started from the bundled binaries.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const STATE_FILE = path.join(__dirname, '..', '.test-db.json');
const DATA_DIR = path.join(__dirname, '..', '..', '.pgdata-test');

module.exports = async () => {
  let connection;
  let managed = false;

  if (process.env.PGHOST) {
    connection = {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'postgres',
    };
  } else {
    const localPostgres = require('../../db/localPostgres');
    localPostgres.stopByDataDir(DATA_DIR); // clear a server left over from an aborted run
    const server = localPostgres.start({ dataDir: DATA_DIR, port: Number(process.env.TEST_PG_PORT || 55432) });
    connection = server.connection;
    managed = true;
  }

  const { createSchema, dropDerived, buildDerived } = require('../../db/setupDatabase');
  const { seed } = require('./fixtures');
  const client = new Client(connection);
  await client.connect();
  try {
    await dropDerived(client);
    await createSchema(client);
    await seed(client);
    await buildDerived(client);
  } finally {
    await client.end();
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify({ connection, managed, dataDir: DATA_DIR }));
};
