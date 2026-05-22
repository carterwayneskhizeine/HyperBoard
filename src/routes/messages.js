const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getAIResponse } = require('../utils/ai-handler');

module.exports = function (db, uploadsDir, ragService) {
  router.get('/', (req, res) => {
    const { privateKey, page = 1, limit = 5, type } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let baseSql;
    let params = [];

    if (type === 'private' && req.userId) {
      baseSql = 'FROM messages m WHERE m.is_private = 1 AND m.user_id = ?';
      params = [req.userId];
    } else if (type === 'posts' && req.userId) {
      if (privateKey && privateKey.trim() !== '') {
        baseSql = 'FROM messages m WHERE (m.is_private = 0 OR (m.is_private = 1 AND m.private_key = ?)) AND m.user_id = ?';
        params = [privateKey.trim(), req.userId];
      } else {
        baseSql = 'FROM messages m WHERE m.is_private = 0 AND m.user_id = ?';
        params = [req.userId];
      }
    } else if (privateKey && privateKey.trim() !== '') {
      baseSql = 'FROM messages m WHERE m.is_private = 0 OR (m.is_private = 1 AND m.private_key = ?)';
      params = [privateKey.trim()];
    } else {
      baseSql = 'FROM messages m WHERE m.is_private = 0';
    }

    const countSql = `SELECT COUNT(m.id) as total ${baseSql}`;

    const dataSql = `
      SELECT m.*, EXISTS(
        SELECT 1 FROM comments c WHERE c.message_id = m.id AND c.username = 'GoldieRill' AND c.is_deleted = 0
      ) as has_ai_reply
      ${baseSql}
      ORDER BY m.is_private DESC, m.timestamp DESC
      LIMIT ? OFFSET ?
    `;

    db.get(countSql, params, (err, countResult) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const total = countResult.total;
      const totalPages = Math.ceil(total / limitNum);

      db.all(dataSql, [...params, limitNum, offset], (err, rows) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }

        const currentUserIdentifier = req.userId ? `user_${req.userId}` : `anonymous_${req.ip || 'unknown'}`;
        const processedRows = rows.map((row) => {
          let likers = [];
          try {
            likers = JSON.parse(row.likers || '[]');
          } catch (e) {
            console.error(`Error parsing likers for message ${row.id}:`, e);
          }
          return {
            ...row,
            has_ai_reply: row.has_ai_reply === 1,
            userHasLiked: likers.includes(currentUserIdentifier),
          };
        });
        const hasPrivateMessages = processedRows.some((row) => row.is_private === 1);

        res.json({
          messages: processedRows,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages,
            hasNextPage: pageNum < totalPages,
            hasPrevPage: pageNum > 1,
          },
          hasPrivateMessages: hasPrivateMessages,
          privateKeyProvided: !!privateKey,
          userId: req.userId || null,
        });
      });
    });
  });

  router.get('/trending', (req, res) => {
    const { page = 1, limit = 5, privateKey } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let baseSql;
    let params = [];

    if (privateKey && privateKey.trim() !== '') {
      baseSql = 'FROM messages m WHERE m.is_private = 0 OR (m.is_private = 1 AND m.private_key = ?)';
      params = [privateKey.trim()];
    } else {
      baseSql = 'FROM messages m WHERE m.is_private = 0';
      params = [];
    }

    const countSql = `SELECT COUNT(m.id) as total ${baseSql}`;

    const dataSql = `
      SELECT m.*, EXISTS(
        SELECT 1 FROM comments c WHERE c.message_id = m.id AND c.username = 'GoldieRill' AND c.is_deleted = 0
      ) as has_ai_reply
      ${baseSql}
      ORDER BY m.hot_score DESC
      LIMIT ? OFFSET ?
    `;

    db.get(countSql, params, (err, countResult) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const total = countResult.total;
      const totalPages = Math.ceil(total / limitNum);

      db.all(dataSql, [...params, limitNum, offset], (err, rows) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }

        const currentUserIdentifier = req.userId ? `user_${req.userId}` : `anonymous_${req.ip || 'unknown'}`;
        const processedRows = rows.map((row) => {
          let likers = [];
          try {
            likers = JSON.parse(row.likers || '[]');
          } catch (e) {
            console.error(`Error parsing likers for message ${row.id}:`, e);
          }
          return {
            ...row,
            has_ai_reply: row.has_ai_reply === 1,
            userHasLiked: likers.includes(currentUserIdentifier),
          };
        });

        const hasPrivateMessages = processedRows.some((row) => row.is_private === 1);

        res.json({
          messages: processedRows,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages,
            hasNextPage: pageNum < totalPages,
            hasPrevPage: pageNum > 1,
          },
          hasPrivateMessages: hasPrivateMessages,
          privateKeyProvided: !!privateKey,
        });
      });
    });
  });

  router.get('/liked', (req, res) => {
    const { page = 1, limit = 5 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    if (!req.userId) {
      return res.status(401).json({ messages: [], pagination: { total: 0 } });
    }

    const currentUserIdentifier = `user_${req.userId}`;
    const searchPattern = `%"${currentUserIdentifier}"%`;

    const baseSql = 'FROM messages m WHERE m.likers LIKE ?';
    const params = [searchPattern];

    const countSql = `SELECT COUNT(m.id) as total ${baseSql}`;

    const dataSql = `
      SELECT m.*, EXISTS(
        SELECT 1 FROM comments c WHERE c.message_id = m.id AND c.username = 'GoldieRill' AND c.is_deleted = 0
      ) as has_ai_reply
      ${baseSql}
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `;

    db.get(countSql, params, (err, countResult) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const total = countResult.total;
      const totalPages = Math.ceil(total / limitNum);

      db.all(dataSql, [...params, limitNum, offset], (err, rows) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }

        const processedRows = rows.map((row) => {
          let likers = [];
          try {
            likers = JSON.parse(row.likers || '[]');
          } catch (e) {
            console.error(`Error parsing likers for message ${row.id}:`, e);
          }
          return {
            ...row,
            has_ai_reply: row.has_ai_reply === 1,
            userHasLiked: likers.includes(currentUserIdentifier),
          };
        });

        res.json({
          messages: processedRows,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages,
            hasNextPage: pageNum < totalPages,
            hasPrevPage: pageNum > 1,
          },
        });
      });
    });
  });

  router.post('/', (req, res) => {
    const { content, isPrivate, privateKey, hasImage, imageFilename, imageMimeType, imageSize } = req.body;

    if ((!content || content.trim() === '') && !hasImage) {
      return res.status(400).json({ error: 'Message must have either text content or a file' });
    }

    if (hasImage) {
      if (!imageFilename || !imageMimeType || !imageSize) {
        return res.status(400).json({ error: 'Missing file information' });
      }

      const imagePath = path.join(uploadsDir, imageFilename);
      if (!fs.existsSync(imagePath)) {
        return res.status(400).json({ error: 'File not found' });
      }

      try {
        const stats = fs.statSync(imagePath);
        if (stats.size !== parseInt(imageSize)) {
          fs.unlinkSync(imagePath);
          return res.status(400).json({ error: 'File size mismatch' });
        }
      } catch (statError) {
        console.error('Error checking file stats:', statError);
        return res.status(400).json({ error: 'File access error' });
      }
    }

    if (isPrivate && !req.userId && (!privateKey || privateKey.trim() === '')) {
      return res.status(400).json({ error: 'Private message must have a KEY when not logged in' });
    }

    const isPrivateInt = isPrivate ? 1 : 0;
    const userId = req.userId || null;

    let finalPrivateKey = null;
    if (isPrivate) {
      if (privateKey && privateKey.trim() !== '') {
        finalPrivateKey = privateKey.trim();
      } else if (req.userId) {
        const timestamp = Date.now();
        finalPrivateKey = `user_${req.userId}_${timestamp}`;
      } else {
        return res.status(400).json({ error: 'Private message must have a KEY when not logged in' });
      }
    }

    const hasImageInt = hasImage ? 1 : 0;
    const finalContent = content ? content.trim() : '';

    db.run(
      `INSERT INTO messages (content, is_private, private_key, user_id, has_image, image_filename, image_mime_type, image_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [finalContent, isPrivateInt, finalPrivateKey, userId, hasImageInt, imageFilename, imageMimeType, imageSize],
      function (err) {
        if (err) {
          if (hasImage && imageFilename) {
            const imagePath = path.join(uploadsDir, imageFilename);
            try {
              fs.unlinkSync(imagePath);
              console.log(`Cleaned up file due to DB error: ${imageFilename}`);
            } catch (unlinkError) {
              console.error(`Failed to clean up file ${imageFilename}:`, unlinkError);
            }
          }
          return res.status(500).json({ error: err.message });
        }
        db.get(`SELECT * FROM messages WHERE id = ?`, [this.lastID], (err, row) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          res.status(201).json(row);

          // RAG index (async, non-blocking)
          if (ragService && row.content && !row.is_private) {
            ragService.indexContent('message', row.id, row.content).catch(() => {});
          }

          // AI trigger (async)
          if (row.content && row.content.toLowerCase().includes('@goldierill')) {
            console.log(`[AI Trigger] Mention detected in message ID: ${row.id}.`);
            (async () => {
              try {
                const aiResponseText = await getAIResponse(row.content, '', ragService);
                if (aiResponseText) {
                  console.log(`[AI] Received response. Saving to DB for message ${row.id}.`);
                  db.run(
                    `INSERT INTO comments (pid, user_id, username, text, message_id) VALUES (?, ?, ?, ?, ?)`,
                    [null, null, 'GoldieRill', aiResponseText, row.id],
                    function (err) {
                      if (err) {
                        console.error('[AI Error] Failed to insert AI comment:', err);
                      } else {
                        console.log(`[AI Success] AI comment saved with ID: ${this.lastID}.`);
                      }
                    }
                  );
                } else {
                  console.log('[AI] Handler returned no response.');
                }
              } catch (aiError) {
                console.error(`[AI Error] for message ${row.id}:`, aiError);
              }
            })();
          }
        });
      }
    );
  });

  router.delete('/:id', (req, res) => {
    const { id } = req.params;

    db.get(`SELECT * FROM messages WHERE id = ?`, [id], (err, message) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (message.is_private === 1 && message.user_id && message.user_id !== req.userId) {
        return res.status(403).json({ error: 'You can only delete your own private messages' });
      }

      if (message.has_image === 1 && message.image_filename) {
        const imagePath = path.join(uploadsDir, message.image_filename);
        try {
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
            console.log(`Deleted file: ${message.image_filename}`);
          }
        } catch (unlinkError) {
          console.error(`Failed to delete file ${message.image_filename}:`, unlinkError);
        }
      }

      db.run(`DELETE FROM messages WHERE id = ?`, id, function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Message not found' });
        }

        res.status(204).send();

        // RAG remove (async)
        if (ragService) {
          ragService.removeContent('message', parseInt(id)).catch(() => {});
        }
      });
    });
  });

  router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Message content cannot be empty' });
    }

    db.get(`SELECT * FROM messages WHERE id = ?`, [id], (err, message) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (message.user_id && message.user_id !== req.userId) {
        return res.status(403).json({ error: 'You can only update your own messages' });
      }

      db.run(`UPDATE messages SET content = ? WHERE id = ?`, [content, id], function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Message not found' });
        }
        db.get(`SELECT * FROM messages WHERE id = ?`, [id], (err, row) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          if (!row) {
            return res.status(404).json({ error: 'Message not found' });
          }
          res.status(200).json(row);

          // RAG re-index (async)
          if (ragService && row.content && !row.is_private) {
            ragService.indexContent('message', row.id, row.content).catch(() => {});
          }
        });
      });
    });
  });

  router.post('/:id/like', (req, res) => {
    const { id } = req.params;
    const messageId = parseInt(id);

    db.get(`SELECT likes, likers FROM messages WHERE id = ?`, [messageId], (err, message) => {
      if (err) {
        console.error('Error fetching message for liking:', err);
        return res.status(500).json({ error: err.message });
      }

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      let likers = [];
      try {
        likers = JSON.parse(message.likers || '[]');
      } catch (e) {
        console.error('Error parsing likers JSON:', e);
        return res.status(500).json({ error: 'Could not process like data.' });
      }

      const currentUserIdentifier = req.userId ? `user_${req.userId}` : `anonymous_${req.ip || 'unknown'}`;
      const userIndex = likers.indexOf(currentUserIdentifier);
      let newLikesCount;
      let userHasLiked;

      if (userIndex > -1) {
        likers.splice(userIndex, 1);
        newLikesCount = Math.max(0, message.likes - 1);
        userHasLiked = false;
      } else {
        likers.push(currentUserIdentifier);
        newLikesCount = message.likes + 1;
        userHasLiked = true;
      }

      const newLikersJson = JSON.stringify(likers);
      db.run(`UPDATE messages SET likes = ?, likers = ? WHERE id = ?`, [newLikesCount, newLikersJson, messageId], function (err) {
        if (err) {
          console.error('Error updating message likes:', err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, likes: newLikesCount, userHasLiked: userHasLiked });
      });
    });
  });

  router.put('/:id/make-private', (req, res) => {
    const { id } = req.params;
    const { privateKey } = req.body;

    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Only administrators can make messages private' });
    }

    if (!privateKey || privateKey.trim() === '') {
      return res.status(400).json({ error: 'Private key is required' });
    }

    db.get(`SELECT * FROM messages WHERE id = ?`, [id], (err, message) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (message.is_private === 1) {
        return res.status(400).json({ error: 'Message is already private' });
      }

      const finalPrivateKey = privateKey.trim();
      db.run(`UPDATE messages SET is_private = 1, private_key = ? WHERE id = ?`, [finalPrivateKey, id], function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Message not found' });
        }

        // RAG remove (async) - private messages shouldn't be searchable
        if (ragService) {
          ragService.removeContent('message', parseInt(id)).catch(() => {});
        }

        db.get(`SELECT * FROM messages WHERE id = ?`, [id], (err, updatedMessage) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(200).json(updatedMessage);
        });
      });
    });
  });

  return router;
};
