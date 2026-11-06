'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig, readFileConfig, toBool, toInt } = require('../config');

describe('loadConfig', () => {
  test('environment variables win over config.json', () => {
    const config = loadConfig(
      { PGHOST: 'env-host', PGPORT: '6543', PGUSER: 'env-user', PGPASSWORD: 'env-pass', PGDATABASE: 'env-db', PORT: '9090' },
      { rds_host: 'file-host', rds_port: '5432', rds_user: 'file-user', rds_password: 'file-pass', rds_db: 'file-db', server_port: '8080' }
    );
    expect(config.db).toMatchObject({ host: 'env-host', port: 6543, user: 'env-user', password: 'env-pass', database: 'env-db' });
    expect(config.server.port).toBe(9090);
  });

  test('falls back to config.json, then to local defaults', () => {
    const fromFile = loadConfig({}, { rds_host: 'db.example.com', rds_user: 'app', rds_password: 'secret', rds_db: 'yelp' });
    expect(fromFile.db).toMatchObject({ host: 'db.example.com', user: 'app', password: 'secret', database: 'yelp', port: 5432 });

    const defaults = loadConfig({}, {});
    expect(defaults.db).toMatchObject({ host: 'localhost', port: 5432, user: 'postgres', database: 'postgres' });
    expect(defaults.server).toEqual({ host: 'localhost', port: 8080 });
    expect(defaults.corsOrigin).toBe('*');
  });

  test('TLS is on for remote hosts and off for local ones unless PGSSL says otherwise', () => {
    expect(loadConfig({ PGHOST: 'db.example.com' }, {}).db.ssl).toBe(true);
    expect(loadConfig({ PGHOST: 'localhost' }, {}).db.ssl).toBe(false);
    expect(loadConfig({ PGHOST: '127.0.0.1' }, {}).db.ssl).toBe(false);
    expect(loadConfig({ PGHOST: 'db.example.com', PGSSL: 'false' }, {}).db.ssl).toBe(false);
    expect(loadConfig({ PGHOST: 'localhost', PGSSL: 'true' }, {}).db.ssl).toBe(true);
  });

  test('an empty PGPASSWORD is respected instead of falling through to the file', () => {
    expect(loadConfig({ PGPASSWORD: '' }, { rds_password: 'file-pass' }).db.password).toBe('');
  });

  test('rate limiting and proxy trust are tunable, and on by default', () => {
    expect(loadConfig({}, {}).rateLimit).toEqual({ perMinute: 300, burst: 60 });
    expect(loadConfig({}, {}).trustProxy).toBe(0);
    const config = loadConfig({ RATE_LIMIT_PER_MINUTE: '0', RATE_LIMIT_BURST: '5', TRUST_PROXY: '1' }, {});
    expect(config.rateLimit).toEqual({ perMinute: 0, burst: 5 });
    expect(config.trustProxy).toBe(1);
  });

  test('cache and pool settings are tunable', () => {
    const config = loadConfig({ CACHE_TTL_MS: '0', CACHE_MAX_ENTRIES: '10', CACHE_MAX_BYTES: '2048', PG_POOL_MAX: '4', PG_STATEMENT_TIMEOUT_MS: '1500' }, {});
    expect(config.cache).toEqual({ ttlMs: 0, maxEntries: 10, maxBytes: 2048 });
    expect(config.db.poolMax).toBe(4);
    expect(config.db.statementTimeoutMs).toBe(1500);
  });
});

describe('parsing helpers', () => {
  test('toBool', () => {
    expect(toBool('TRUE', false)).toBe(true);
    expect(toBool('1', false)).toBe(true);
    expect(toBool('no', true)).toBe(false);
    expect(toBool(undefined, true)).toBe(true);
    expect(toBool('', false)).toBe(false);
  });

  test('toInt', () => {
    expect(toInt('42', 7)).toBe(42);
    expect(toInt('abc', 7)).toBe(7);
    expect(toInt(undefined, 7)).toBe(7);
  });
});

describe('readFileConfig', () => {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-cfg-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('a missing file means "no file config", not an error', () => {
    expect(readFileConfig(path.join(dir, 'absent.json'))).toEqual({});
  });

  test('reads a valid file', () => {
    const file = path.join(dir, 'ok.json');
    fs.writeFileSync(file, JSON.stringify({ rds_host: 'db.example.com' }));
    expect(readFileConfig(file)).toEqual({ rds_host: 'db.example.com' });
  });

  test('a corrupt file fails loudly with the file named', () => {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, '{ not json');
    expect(() => readFileConfig(file)).toThrow(/config\.json is not valid JSON/);
  });
});
