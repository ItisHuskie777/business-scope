'use strict';

// Runs in every test worker before any module is loaded: point the server's
// config at the database prepared by globalSetup.

const fs = require('fs');
const path = require('path');

const { connection } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.test-db.json'), 'utf8'));

process.env.PGHOST = connection.host;
process.env.PGPORT = String(connection.port);
process.env.PGUSER = connection.user;
process.env.PGPASSWORD = connection.password;
process.env.PGDATABASE = connection.database;
process.env.PGSSL = 'false';
