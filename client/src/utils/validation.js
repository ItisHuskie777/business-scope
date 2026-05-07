/**
 * Client-side validation helpers mirroring the server's isValidZip / STATE_RE
 * checks so we fail fast in the UI rather than waiting for a 400 response.
 * Keep these aligned with server/routes.js if the backend contract changes.
 */

const ZIP_RE = /^\d{5}$/;
const STATE_RE = /^[A-Za-z]{2}$/;

export const isValidZip = (value) =>
  typeof value === "string" && ZIP_RE.test(value);

export const isValidState = (value) =>
  typeof value === "string" && STATE_RE.test(value);

export const clampNumber = (raw, fallback, min, max) => {
  const n = Number(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};
