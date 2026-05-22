const express = require('express');
const router = express.Router();

module.exports = function (db, ragService) {
  router.get('/', async (req, res) => {
    const { q, page = 1, limit = 5, mode } = req.query;
    const searchMode = mode || process.env.DEFAULT_SEARCH_MODE || 'keyword';

    if (!q || q.trim() === '') {
      return res.status(400).json({ error: 'Search query cannot be empty' });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const userId = req.userId || null;

    if ((searchMode === 'semantic' || searchMode === 'hybrid') && ragService) {
      try {
        const semanticIds = await ragService.searchMessageIds(q, 20);

        if (searchMode === 'semantic') {
          if (semanticIds.length === 0) {
            return res.json({
              messages: [],
              pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
              searchQuery: q,
              mode: 'semantic',
            });
          }

          const total = semanticIds.length;
          const totalPages = Math.ceil(total / limitNum);
          const pagedIds = semanticIds.slice(offset, offset + limitNum);
          const placeholders = pagedIds.map(() => '?').join(',');

          db.all(
            `SELECT * FROM messages WHERE id IN (${placeholders}) AND (is_private = 0 OR user_id = ?) ORDER BY timestamp DESC`,
            [...pagedIds, userId],
            (err, rows) => {
              if (err) return res.status(500).json({ error: err.message });
              const processedRows = rows.map((row) => ({
                ...row,
                userHasLiked: parseLikers(row.likers).includes(getUserIdentifier(userId, req.ip)),
              }));
              res.json({
                messages: processedRows,
                pagination: { page: pageNum, limit: limitNum, total, totalPages, hasNextPage: pageNum < totalPages, hasPrevPage: pageNum > 1 },
                searchQuery: q,
                mode: 'semantic',
              });
            }
          );
          return;
        }

        // hybrid: merge keyword + semantic
        const keywordIds = await getKeywordIds(db, q, userId);
        const mergedIds = Array.from(new Set([...semanticIds, ...keywordIds]));
        const total = mergedIds.length;
        const totalPages = Math.ceil(total / limitNum);
        const pagedIds = mergedIds.slice(offset, offset + limitNum);

        if (pagedIds.length === 0) {
          return res.json({
            messages: [],
            pagination: { page: pageNum, limit: limitNum, total, totalPages, hasNextPage: false, hasPrevPage: pageNum > 1 },
            searchQuery: q,
            mode: 'hybrid',
          });
        }

        const placeholders = pagedIds.map(() => '?').join(',');
        db.all(
          `SELECT * FROM messages WHERE id IN (${placeholders}) ORDER BY timestamp DESC`,
          pagedIds,
          (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const processedRows = rows.map((row) => ({
              ...row,
              userHasLiked: parseLikers(row.likers).includes(getUserIdentifier(userId, req.ip)),
            }));
            res.json({
              messages: processedRows,
              pagination: { page: pageNum, limit: limitNum, total, totalPages, hasNextPage: pageNum < totalPages, hasPrevPage: pageNum > 1 },
              searchQuery: q,
              mode: 'hybrid',
            });
          }
        );
      } catch (err) {
        console.error('[Search] Semantic error, fallback to keyword:', err.message);
        doKeywordSearchAndRespond(db, q, userId, offset, limitNum, pageNum, res);
      }
      return;
    }

    doKeywordSearchAndRespond(db, q, userId, offset, limitNum, pageNum, res);
  });

  return router;
};

function parseLikers(likersJson) {
  try { return JSON.parse(likersJson || '[]'); } catch { return []; }
}

function getUserIdentifier(userId, ip) {
  return userId ? `user_${userId}` : `anonymous_${ip || 'unknown'}`;
}

function doKeywordSearchAndRespond(db, q, userId, offset, limitNum, pageNum, res) {
  const searchQuery = `%${q.trim()}%`;
  let baseSql, params;

  if (userId) {
    baseSql = 'FROM messages m WHERE (m.content LIKE ? AND m.is_private = 0) OR (m.content LIKE ? AND m.is_private = 1 AND m.user_id = ?)';
    params = [searchQuery, searchQuery, userId];
  } else {
    baseSql = 'FROM messages m WHERE m.content LIKE ? AND m.is_private = 0';
    params = [searchQuery];
  }

  db.get(`SELECT COUNT(m.id) as total ${baseSql}`, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: err.message });
    const total = countResult.total;
    const totalPages = Math.ceil(total / limitNum);
    const dataSql = `SELECT m.* FROM messages m WHERE m.id IN (SELECT m.id ${baseSql} ORDER BY m.timestamp DESC LIMIT ? OFFSET ?) ORDER BY m.timestamp DESC`;
    db.all(dataSql, [...params, limitNum, offset], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        messages: rows,
        pagination: { page: pageNum, limit: limitNum, total, totalPages, hasNextPage: pageNum < totalPages, hasPrevPage: pageNum > 1 },
        searchQuery: q,
        mode: 'keyword',
      });
    });
  });
}

function getKeywordIds(db, q, userId) {
  return new Promise((resolve) => {
    const searchQuery = `%${q.trim()}%`;
    let sql, params;
    if (userId) {
      sql = 'SELECT id FROM messages m WHERE (m.content LIKE ? AND m.is_private = 0) OR (m.content LIKE ? AND m.is_private = 1 AND m.user_id = ?)';
      params = [searchQuery, searchQuery, userId];
    } else {
      sql = 'SELECT id FROM messages m WHERE m.content LIKE ? AND m.is_private = 0';
      params = [searchQuery];
    }
    db.all(sql, params, (err, rows) => {
      if (err) { resolve([]); return; }
      resolve(rows.map((r) => r.id));
    });
  });
}
