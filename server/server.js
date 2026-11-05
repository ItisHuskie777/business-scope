'use strict';

const { loadConfig } = require('./config');
const { createApp } = require('./app');
const pool = require('./db');

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.server.port, () => {
  console.log(`Server running at http://${config.server.host}:${config.server.port}/`);
});

// Finish in-flight requests and release database connections on shutdown.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
