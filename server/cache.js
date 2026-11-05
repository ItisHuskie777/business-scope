'use strict';

const zlib = require('zlib');

// In-process response cache for GET requests.
//
// Every endpoint reads a static snapshot of the Yelp and Zillow data, so a
// response stays valid until the dataset is reloaded. Entries expire after a
// TTL, and the least recently used entries are evicted once the cache holds too
// many entries or too many bytes, so memory use stays bounded.
//
// Each entry also keeps a gzip copy of its body. Without it, a cache hit on a
// large response still spends several milliseconds compressing the same bytes
// again; with it, a hit is a memory read and a socket write.
// A Map keeps insertion order, which is all an LRU needs.

class TtlCache {
  constructor({ ttlMs = 300000, maxEntries = 500, maxBytes = 64 * 1024 * 1024, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.now = now;
    this.store = new Map();
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  get enabled() {
    return this.ttlMs > 0 && this.maxEntries > 0 && this.maxBytes > 0;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.remove(key);
      this.misses += 1;
      return undefined;
    }
    // Re-insert so this key becomes the most recently used.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  // Reads an entry without counting a hit or changing its recency.
  peek(key) {
    const entry = this.store.get(key);
    return entry && entry.expiresAt > this.now() ? entry.value : undefined;
  }

  // `size` is the number of bytes the value occupies; it defaults to the byte
  // length of a string value.
  set(key, value, size = typeof value === 'string' ? Buffer.byteLength(value) : 0) {
    if (!this.enabled) return;
    // A single response larger than the whole budget is never worth keeping.
    if (size > this.maxBytes) return;
    this.remove(key);
    this.store.set(key, { value, size, expiresAt: this.now() + this.ttlMs });
    this.bytes += size;
    // Evict least recently used entries until both limits hold. The entry count
    // alone is not enough: one response can be a megabyte of JSON.
    while (this.store.size > this.maxEntries || this.bytes > this.maxBytes) {
      this.remove(this.store.keys().next().value);
    }
  }

  remove(key) {
    const entry = this.store.get(key);
    if (!entry) return;
    this.bytes -= entry.size;
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
    this.bytes = 0;
  }

  stats() {
    return { entries: this.store.size, bytes: this.bytes, hits: this.hits, misses: this.misses };
  }
}

// Below this size compression saves little and the compression middleware skips it too.
const MIN_COMPRESS_BYTES = 1024;

// Express middleware: serve a stored body on a hit, otherwise let the route run
// and remember its JSON body if it answered 200.
function cacheMiddleware(cache) {
  const cacheControl = () => `public, max-age=${Math.floor(cache.ttlMs / 1000)}`;

  return (req, res, next) => {
    if (req.method !== 'GET' || !cache.enabled) return next();

    const key = req.originalUrl;
    const entry = cache.get(key);
    if (entry !== undefined) {
      res.set('X-Cache', 'HIT');
      res.set('Cache-Control', cacheControl());
      res.vary('Accept-Encoding');
      res.type('application/json');
      if (entry.gzip && req.acceptsEncodings('gzip')) {
        // Already compressed: the compression middleware sees the header and leaves it alone.
        res.set('Content-Encoding', 'gzip');
        return res.send(entry.gzip);
      }
      return res.send(entry.json);
    }

    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode !== 200) return sendJson(body);

      const json = JSON.stringify(body);
      const jsonBytes = Buffer.byteLength(json);
      const fresh = { json, gzip: null };
      cache.set(key, fresh, jsonBytes);

      if (jsonBytes >= MIN_COMPRESS_BYTES) {
        // Compress off the request path; the response below does not wait for it.
        zlib.gzip(json, (err, gzip) => {
          // Only attach if this entry is still the one in the cache.
          if (err || cache.peek(key) !== fresh) return;
          fresh.gzip = gzip;
          cache.set(key, fresh, jsonBytes + gzip.length);
        });
      }

      res.set('X-Cache', 'MISS');
      res.set('Cache-Control', cacheControl());
      return res.type('application/json').send(json);
    };
    return next();
  };
}

module.exports = { TtlCache, cacheMiddleware, MIN_COMPRESS_BYTES };
