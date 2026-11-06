'use strict';

// Per-client rate limiting with a token bucket.
//
// Each client (by IP address) has a bucket holding up to `burst` tokens that
// refills at `perMinute` tokens a minute. A request spends one token; with the
// bucket empty the request is refused with 429 and a Retry-After header. This
// allows short bursts, such as a page firing several requests at once, while
// capping sustained load per client.
//
// Buckets live in memory. Idle buckets are swept periodically, so the map does
// not grow with every address ever seen; `maxClients` is a hard cap on top.

class TokenBucketLimiter {
  constructor({ perMinute = 300, burst = 60, maxClients = 10000, now = Date.now } = {}) {
    this.ratePerMs = perMinute / 60000;
    this.burst = burst;
    this.maxClients = maxClients;
    this.now = now;
    this.buckets = new Map();
    this.lastSweep = now();
  }

  get enabled() {
    return this.ratePerMs > 0 && this.burst > 0;
  }

  // Returns { allowed, remaining, retryAfterSeconds }.
  take(key) {
    const t = this.now();
    this.sweep(t);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxClients) {
        // Full: drop the longest-idle client (Map keeps insertion order, and
        // every use re-inserts its key, so the first key is the stalest).
        this.buckets.delete(this.buckets.keys().next().value);
      }
      bucket = { tokens: this.burst, updated: t };
    } else {
      bucket.tokens = Math.min(this.burst, bucket.tokens + (t - bucket.updated) * this.ratePerMs);
      bucket.updated = t;
      this.buckets.delete(key);
    }
    this.buckets.set(key, bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / this.ratePerMs / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  // Forget clients whose bucket has refilled completely: they are back at the
  // starting state, so keeping them changes nothing.
  sweep(t) {
    if (t - this.lastSweep < 60000) return;
    this.lastSweep = t;
    const fullAfterMs = this.burst / this.ratePerMs;
    for (const [key, bucket] of this.buckets) {
      if (t - bucket.updated >= fullAfterMs) this.buckets.delete(key);
    }
  }
}

function rateLimitMiddleware(limiter, { exempt = [] } = {}) {
  return (req, res, next) => {
    if (!limiter.enabled || exempt.includes(req.path)) return next();
    const result = limiter.take(req.ip || 'unknown');
    res.set('RateLimit-Limit', String(limiter.burst));
    res.set('RateLimit-Remaining', String(result.remaining));
    if (result.allowed) return next();
    res.set('Retry-After', String(result.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many requests, slow down' });
  };
}

module.exports = { TokenBucketLimiter, rateLimitMiddleware };
