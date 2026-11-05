'use strict';

// Runs a .sql file through node-postgres.
// The scripts in optimization/ were written for psql and contain meta-commands
// (\echo, \timing); those lines are dropped so one file serves both psql and Node.

const fs = require('fs');

function stripPsqlMetaCommands(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('\\'))
    .join('\n');
}

async function runSqlFile(client, file) {
  const sql = stripPsqlMetaCommands(fs.readFileSync(file, 'utf8'));
  // No bind parameters, so the simple query protocol runs every statement in the file.
  await client.query(sql);
}

module.exports = { runSqlFile, stripPsqlMetaCommands };
