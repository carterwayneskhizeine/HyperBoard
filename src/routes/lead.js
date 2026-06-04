const express = require('express');

// Very small in-memory per-IP rate limiter (no extra deps), mirrors chat.js.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5; // lead submissions per window per IP
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) {
    if (now - rec.start > RATE_WINDOW_MS) hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref?.();

module.exports = function (db) {
  const router = express.Router();

  router.post('/', (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    if (rateLimited(ip)) {
      return res.status(429).json({ error: '提交过于频繁，请稍后再试。' });
    }

    const { name, contact, message, sessionId, company } = req.body || {};

    // Honeypot: `company` is a hidden field no real user fills in. If present, silently
    // pretend success so bots don't learn they were caught.
    if (company) {
      return res.json({ ok: true });
    }

    if (!contact || typeof contact !== 'string' || !contact.trim()) {
      return res.status(400).json({ error: '请留下联系方式' });
    }
    if (contact.length > 200) {
      return res.status(400).json({ error: '联系方式过长' });
    }

    const cleanName = typeof name === 'string' ? name.trim().substring(0, 100) : null;
    const cleanContact = contact.trim().substring(0, 200);
    const cleanMessage = typeof message === 'string' ? message.trim().substring(0, 1000) : null;
    const cleanSession = typeof sessionId === 'string' ? sessionId.substring(0, 64) : null;
    const userAgent = (req.headers['user-agent'] || '').substring(0, 300);

    db.run(
      'INSERT INTO leads (name, contact, message, session_id, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      [cleanName, cleanContact, cleanMessage, cleanSession, String(ip).substring(0, 64), userAgent],
      function (err) {
        if (err) {
          console.error('[Lead] Failed to save:', err.message);
          return res.status(500).json({ error: '提交失败，请稍后重试。' });
        }
        console.log(`[Lead] New lead #${this.lastID} from ${cleanContact}`);
        return res.json({ ok: true });
      }
    );
  });

  return router;
};
