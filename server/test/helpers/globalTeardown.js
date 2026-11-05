'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.test-db.json');

module.exports = async () => {
  if (!fs.existsSync(STATE_FILE)) return;
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  fs.rmSync(STATE_FILE, { force: true });
  if (state.managed) {
    require('../../db/localPostgres').stopByDataDir(state.dataDir);
  }
};
