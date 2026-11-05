'use strict';

// Starts a throwaway PostgreSQL server for tests and benchmarks, using the
// binaries shipped by the embedded-postgres dev dependency. No Docker, no
// system install and no root needed. CI uses a service container instead and
// never loads this file.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function binaryDir() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const platform = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[process.platform];
  const pkg = `@embedded-postgres/${platform}-${arch}`;
  // The package does not export its package.json, so locate it on disk.
  const native = path.join(__dirname, '..', 'node_modules', pkg, 'native');
  if (!fs.existsSync(path.join(native, 'bin'))) {
    throw new Error(
      `PostgreSQL binaries not found (${pkg}). Run "npm install" in server/, ` +
      'or point the tests at an existing database with PGHOST/PGPORT/PGUSER/PGPASSWORD.'
    );
  }
  return native;
}

function start({ dataDir, port }) {
  const native = binaryDir();
  const bin = (name) => path.join(native, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  const env = { ...process.env, LD_LIBRARY_PATH: path.join(native, 'lib'), DYLD_LIBRARY_PATH: path.join(native, 'lib') };
  const run = (name, args) => execFileSync(bin(name), args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

  fs.rmSync(dataDir, { recursive: true, force: true });
  run('initdb', ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  // TCP on loopback only; no unix socket so nothing is written outside dataDir.
  const options = `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off`;
  run('pg_ctl', ['-D', dataDir, '-l', path.join(dataDir, 'server.log'), '-w', '-o', options, 'start']);

  return {
    connection: { host: '127.0.0.1', port, user: 'postgres', password: '', database: 'postgres' },
    stop() {
      try {
        run('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    },
  };
}

function stopByDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) return;
  const native = binaryDir();
  const env = { ...process.env, LD_LIBRARY_PATH: path.join(native, 'lib'), DYLD_LIBRARY_PATH: path.join(native, 'lib') };
  try {
    execFileSync(path.join(native, 'bin', 'pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop'], { env, stdio: 'ignore' });
  } catch (err) {
    // Already stopped.
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}

module.exports = { start, stopByDataDir };
