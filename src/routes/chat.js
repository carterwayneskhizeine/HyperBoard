const express = require('express');
const fs = require('fs');
const path = require('path');
const { getChatResponse } = require('../utils/ai-handler');

// Resume lives in the mounted ./data volume, so it can be updated without
// rebuilding the image. Cached in memory; re-read if the file changes (mtime).
const RESUME_PATH = path.join(__dirname, '..', '..', 'data', 'resume.md');
let resumeCache = '';
let resumeMtime = 0;

function loadResume() {
  try {
    const stat = fs.statSync(RESUME_PATH);
    if (stat.mtimeMs !== resumeMtime) {
      resumeCache = fs.readFileSync(RESUME_PATH, 'utf8');
      resumeMtime = stat.mtimeMs;
      console.log(`[Chat] Loaded resume (${resumeCache.length} chars)`);
    }
  } catch (err) {
    if (!resumeCache) console.error(`[Chat] Resume not found at ${RESUME_PATH}: ${err.message}`);
  }
  return resumeCache;
}

// Very small in-memory per-IP rate limiter (no extra deps).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 12; // requests per window per IP
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

// Periodic cleanup so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) {
    if (now - rec.start > RATE_WINDOW_MS) hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref?.();

module.exports = function (db, ragService) {
  const router = express.Router();

  // warm the cache at mount time
  loadResume();

  router.post('/', async (req, res) => {
    // The AI call can take up to ~60s (RAG retrieval + large prompt). Override the
    // global 30s socket timeout for this route, otherwise Node destroys the socket
    // mid-generation and the browser sees ERR_EMPTY_RESPONSE despite a valid reply.
    req.setTimeout(75000);
    res.setTimeout(75000);

    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    if (rateLimited(ip)) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试。' });
    }

    const { question, history } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question 不能为空' });
    }
    if (question.length > 2000) {
      return res.status(400).json({ error: 'question 过长' });
    }

    try {
      const resumeText = loadResume();
      const result = await getChatResponse({
        question,
        history: Array.isArray(history) ? history : [],
        resumeText,
        ragService,
        db,
      });

      if (result && result.error === 'busy') {
        return res.status(503).json({ error: 'AI 正忙，请稍后重试。' });
      }
      if (!result) {
        return res.status(502).json({ error: 'AI 暂时无法回答，请稍后重试。' });
      }
      return res.json({ reply: result });
    } catch (err) {
      console.error('[Chat] Handler error:', err.message);
      return res.status(500).json({ error: '服务器内部错误' });
    }
  });

  return router;
};
