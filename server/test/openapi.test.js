'use strict';

const request = require('supertest');
const { buildApp } = require('./helpers/app');
const spec = require('../openapi');
const pool = require('../db');

const app = buildApp();
afterAll(() => pool.end());

// Express paths ("/business/:id") in OpenAPI form ("/business/{id}").
const registeredRoutes = () => app._router.stack
  .filter((layer) => layer.route)
  .flatMap((layer) => Object.keys(layer.route.methods).map((method) => ({
    method,
    path: layer.route.path.replace(/:(\w+)/g, '{$1}'),
  })));

describe('OpenAPI document', () => {
  test('is served at /openapi.json', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths).toEqual(JSON.parse(JSON.stringify(spec.paths)));
  });

  test('documents every route the app serves, and nothing it does not', () => {
    const routes = registeredRoutes();
    expect(routes.length).toBeGreaterThan(15);
    const documented = Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m} ${p}`)).sort();
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(documented);
  });

  test('every path parameter in a URL is declared', () => {
    for (const [p, ops] of Object.entries(spec.paths)) {
      const inUrl = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const operation of Object.values(ops)) {
        const declared = (operation.parameters || []).filter((x) => x.in === 'path').map((x) => x.name).sort();
        expect({ path: p, params: declared }).toEqual({ path: p, params: inUrl });
      }
    }
  });

  test('every schema reference resolves', () => {
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(5);
    for (const name of refs) expect(spec.components.schemas[name]).toBeDefined();
  });
});
