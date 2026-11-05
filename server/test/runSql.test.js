'use strict';

const fs = require('fs');
const path = require('path');
const { runSqlFile, stripPsqlMetaCommands } = require('../db/runSql');
const pool = require('../db');

afterAll(() => pool.end());

describe('stripPsqlMetaCommands', () => {
  test('drops psql meta-commands and keeps the SQL', () => {
    const sql = ['\\timing on', "\\echo '--- creating index ---'", 'CREATE INDEX i ON t (c);', "  \\echo indented", 'ANALYZE t;'].join('\n');
    expect(stripPsqlMetaCommands(sql)).toBe('CREATE INDEX i ON t (c);\nANALYZE t;');
  });

  test('leaves a backslash inside a statement alone', () => {
    const sql = "SELECT E'a\\nb';";
    expect(stripPsqlMetaCommands(sql)).toBe(sql);
  });
});

describe('runSqlFile', () => {
  test('executes every statement of a psql-style script', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-sql-'));
    const file = path.join(dir, 'script.sql');
    fs.writeFileSync(file, [
      '\\timing on',
      'DROP TABLE IF EXISTS run_sql_probe;',
      'CREATE TABLE run_sql_probe (n INT);',
      "\\echo 'loading'",
      'INSERT INTO run_sql_probe VALUES (1), (2), (3);',
    ].join('\n'));

    const client = await pool.connect();
    try {
      await runSqlFile(client, file);
      const { rows } = await client.query('SELECT COUNT(*) AS n FROM run_sql_probe');
      expect(rows[0].n).toBe(3);
      await client.query('DROP TABLE run_sql_probe');
    } finally {
      client.release();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
