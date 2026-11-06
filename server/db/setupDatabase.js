'use strict';

// Builds everything the API needs in an existing database, in dependency order.
//
//   node db/setupDatabase.js            create tables, indexes and materialized views
//   node db/setupDatabase.js --derived  only (re)build indexes and materialized views
//
// The connection comes from the same environment variables / config.json as the server.

const path = require('path');
const { runSqlFile } = require('./runSql');

const ROOT = path.join(__dirname, '..', '..');
const SCHEMA = path.join(ROOT, 'RDS setup instructions and data upload', 'create_tables.sql');
const optimization = (name) => path.join(ROOT, 'optimization', name);
// Milestone 4 optimizations, then the precomputed summaries built on top of them.
const CORE = ['02_create_indexes.sql', '03_create_materialized_views.sql', '05_summary_materialized_views.sql'].map(optimization);
const LOOKUP_INDEXES = optimization('06_lookup_indexes.sql');
const FEATURES = optimization('07_search_categories_reviews.sql');
const REFRESH = optimization('08_refresh_materialized_views.sql');
const MATERIALIZED_VIEWS = [
  'mv_category_summary', 'mv_business_category',
  'mv_top_business_per_zip', 'mv_zip_summary',
  'mv_business_review_summary', 'mv_latest_housing', 'mv_oldest_housing',
];

async function createSchema(client) {
  await runSqlFile(client, SCHEMA);
}

async function dropDerived(client) {
  await client.query(`DROP MATERIALIZED VIEW IF EXISTS ${MATERIALIZED_VIEWS.join(', ')} CASCADE`);
}

// Indexes and materialized views: run once the base tables hold data.
// `lookupIndexes: false` stops before step 6 and `features: false` before step 7
// (the benchmark times those steps separately).
async function buildDerived(client, { lookupIndexes = true, features = true } = {}) {
  for (const file of CORE) {
    await runSqlFile(client, file);
  }
  if (lookupIndexes) await runSqlFile(client, LOOKUP_INDEXES);
  if (lookupIndexes && features) await runSqlFile(client, FEATURES);
}

module.exports = { createSchema, dropDerived, buildDerived, SCHEMA, CORE, LOOKUP_INDEXES, FEATURES, REFRESH };

if (require.main === module) {
  const pool = require('../db');
  (async () => {
    const client = await pool.connect();
    try {
      if (!process.argv.includes('--derived')) {
        await createSchema(client);
        console.log('Tables created (empty). Load data, then rerun with --derived.');
      } else {
        await buildDerived(client);
        console.log('Indexes and materialized views built.');
      }
    } finally {
      client.release();
      await pool.end();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
