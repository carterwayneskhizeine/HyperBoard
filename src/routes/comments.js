const express = require('express');
const router = express.Router();
const { getAIResponse } = require('../utils/ai-handler');
const { calculateHotScore } = require('../utils/hot-score');

module.exports = function (db, ragService) {
  async function updateMessageHotScore(messageId) {
    console.log(`[HotScore] Starting update for message ID: ${messageId}`);

    const getMessageTimestampSql = `SELECT timestamp FROM messages WHERE id = ?`;
    const getTotalLikesSql = `SELECT SUM(likes) as total_likes FROM comments WHERE message_id = ? AND is_deleted = 0`;

    db.get(getMessageTimestampSql, [messageId], (err, message) => {
      if (err) {
        console.error(`[HotScore] Error fetching message ${messageId}:`, err);
        return;
      }
      if (!message) {
        console.error(`[HotScore] Message ${messageId} not found.`);
        return;
      }

      db.get(getTotalLikesSql, [messageId], (err, result) => {
        if (err) {
          console.error(`[HotScore] Error calculating total likes for message ${messageId}:`, err);
          return;
        }

        const totalLikes = result.total_likes || 0;
        const newHotScore = calculateHotScore(totalLikes, message.timestamp);

        db.run(`UPDATE messages SET hot_score = ? WHERE id = ?`, [newHotScore, messageId], (err) => {
          if (err) {
            console.error(`[HotScore] Error updating hot_score for message ${messageId}:`, err);
          } else {
            console.log(`[HotScore] Updated hot_score for message ${messageId} to ${newHotScore}.`);
          }
        });
      });
    });
  }

  router.get('/', (req, res) => {
    const { messageId, sort = '-time', page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    if (!messageId) {
      return res.status(400).json({ error: 'messageId parameter is required' });
    }

    let baseSql = `SELECT c.*, u.username as user_username
                   FROM comments c
                   LEFT JOIN users u ON c.user_id = u.id
                   WHERE c.message_id = ? AND c.is_deleted = 0 AND c.pid IS NULL`;
    let params = [messageId];

    let orderBy = '';
    switch (sort) {
      case '-time':
        orderBy = 'ORDER BY c.time DESC';
        break;
      case '+time':
        orderBy = 'ORDER BY c.time ASC';
        break;
      case '-score':
        orderBy = 'ORDER BY c.score DESC, c.time DESC';
        break;
      case '+score':
        orderBy = 'ORDER BY c.score ASC, c.time ASC';
        break;
      default:
        orderBy = 'ORDER BY c.time DESC';
    }

    const countSql = `SELECT COUNT(*) as total FROM comments WHERE message_id = ? AND is_deleted = 0 AND pid IS NULL`;
    const dataSql = `${baseSql} ${orderBy} LIMIT ? OFFSET ?`;

    db.get(countSql, [messageId], (err, countResult) => {
      if (err) {
        console.error('Error counting comments:', err);
        return res.status(500).json({ error: err.message });
      }

      const total = countResult.total || 0;
      const totalPages = Math.ceil(total / limitNum);

      db.all(dataSql, [...params, limitNum, offset], (err, rows) => {
        if (err) {
          console.error('Error fetching comments:', err);
          return res.status(500).json({ error: err.message });
        }

        const currentUserIdentifier = req.userId ? `user_${req.userId}` : `anonymous_${req.ip || 'unknown'}`;
        const comments = rows.map((row) => {
          let likers = [];
          try {
            likers = JSON.parse(row.likers || '[]');
          } catch (e) {
            console.error(`Error parsing likers for comment ${row.id}:`, e);
          }
          return {
            id: row.id.toString(),
            pid: row.pid ? row.pid.toString() : null,
            text: row.text,
            user: {
              id: row.user_id ? `user_${row.user_id}` : `anonymous_${row.username}`,
              name: row.user_username || row.username,
              picture: '',
              profile: '',
              verified: false,
            },
            likes: row.likes || 0,
            userHasLiked: likers.includes(currentUserIdentifier),
            time: new Date(row.time).toISOString(),
            edit: row.is_editable
              ? {
                  edited: false,
                  reason: '',
                  time: null,
                }
              : null,
            vote: 0,
            controversy: 0,
            deletable: row.user_id === req.userId || req.isAdmin,
            editable: (row.user_id === req.userId && row.is_editable === 1) || req.isAdmin,
            replies: [],
          };
        });

        function fetchNestedReplies(parentIds) {
          if (!parentIds || parentIds.length === 0) {
            return Promise.resolve([]);
          }

          const placeholders = parentIds.map(() => '?').join(',');
          const nestedRepliesSql = `SELECT c.*, u.username as user_username
                                   FROM comments c
                                   LEFT JOIN users u ON c.user_id = u.id
                                   WHERE c.pid IN (${placeholders}) AND c.is_deleted = 0
                                   ORDER BY c.time ASC`;

          return new Promise((resolve, reject) => {
            db.all(nestedRepliesSql, parentIds, (err, replies) => {
              if (err) {
                console.error('Error fetching nested replies:', err);
                reject(err);
                return;
              }

              if (replies.length === 0) {
                resolve([]);
                return;
              }

              const replyObjects = replies.map((reply) => {
                let likers = [];
                try {
                  likers = JSON.parse(reply.likers || '[]');
                } catch (e) {
                  console.error(`Error parsing likers for comment ${reply.id}:`, e);
                }
                return {
                  id: reply.id.toString(),
                  pid: reply.pid ? reply.pid.toString() : null,
                  text: reply.text,
                  user: {
                    id: reply.user_id ? `user_${reply.user_id}` : `anonymous_${reply.username}`,
                    name: reply.user_username || reply.username,
                    picture: '',
                    profile: '',
                    verified: false,
                  },
                  likes: reply.likes || 0,
                  userHasLiked: likers.includes(currentUserIdentifier),
                  time: new Date(reply.time).toISOString(),
                  edit: reply.is_editable
                    ? {
                        edited: false,
                        reason: '',
                        time: null,
                      }
                    : null,
                  vote: 0,
                  controversy: 0,
                  deletable: reply.user_id === req.userId || req.isAdmin,
                  editable: (reply.user_id === req.userId && reply.is_editable === 1) || req.isAdmin,
                  replies: [],
                };
              });

              const replyIds = replies.map((r) => parseInt(r.id));
              fetchNestedReplies(replyIds)
                .then((nestedReplies) => {
                  replyObjects.forEach((replyObj) => {
                    const nested = nestedReplies.filter((nr) => nr.pid === replyObj.id);
                    replyObj.replies = nested;
                  });
                  resolve(replyObjects);
                })
                .catch(reject);
            });
          });
        }

        if (comments.length > 0) {
          const topCommentIds = comments.map((c) => parseInt(c.id));

          fetchNestedReplies(topCommentIds)
            .then((nestedReplies) => {
              comments.forEach((comment) => {
                const repliesToThisComment = nestedReplies.filter((reply) => reply.pid === comment.id);
                comment.replies = repliesToThisComment;
              });

              res.json({
                comments: comments,
                info: {
                  messageId: messageId,
                  count: total,
                  first_time: comments.length > 0 ? comments[comments.length - 1].time : null,
                  last_time: comments.length > 0 ? comments[0].time : null,
                  sort: sort,
                },
                pagination: {
                  page: pageNum,
                  limit: limitNum,
                  total,
                  totalPages,
                  hasNextPage: pageNum < totalPages,
                  hasPrevPage: pageNum > 1,
                },
              });
            })
            .catch((err) => {
              console.error('Error in nested replies:', err);
              res.status(500).json({ error: err.message });
            });
        } else {
          res.json({
            comments: comments,
            info: {
              messageId: messageId,
              count: total,
              first_time: null,
              last_time: null,
              sort: sort,
            },
            pagination: {
              page: pageNum,
              limit: limitNum,
              total,
              totalPages,
              hasNextPage: pageNum < totalPages,
              hasPrevPage: pageNum > 1,
            },
          });
        }
      });
    });
  });

  router.post('/', (req, res) => {
    const { pid = null, text, messageId } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    if (!messageId) {
      return res.status(400).json({ error: 'messageId is required' });
    }

    if (pid) {
      db.get('SELECT id FROM comments WHERE id = ?', [pid], (err, row) => {
        if (err) {
          console.error('Error checking parent comment:', err);
          return res.status(500).json({ error: err.message });
        }
        if (!row) {
          return res.status(400).json({ error: 'Parent comment does not exist' });
        }
        insertComment();
      });
    } else {
      insertComment();
    }

    function insertComment() {
      const userId = req.userId || null;
      const username = req.userId ? req.username : `anonymous_${Math.random().toString(36).substring(2, 10)}`;

      db.run(
        `INSERT INTO comments (pid, user_id, username, text, message_id) VALUES (?, ?, ?, ?, ?)`,
        [pid, userId, username, text.trim(), messageId],
        function (err) {
          if (err) {
            console.error('Error inserting comment:', err);
            return res.status(500).json({ error: err.message });
          }

          const newCommentId = this.lastID;

          db.get(`SELECT * FROM comments WHERE id = ?`, [newCommentId], (err, row) => {
            if (err) {
              console.error('Error fetching inserted comment:', err);
              return res.status(500).json({ error: err.message });
            }

            const comment = {
              id: row.id.toString(),
              pid: row.pid ? row.pid.toString() : null,
              text: row.text,
              user: {
                id: row.user_id ? `user_${row.user_id}` : `anonymous_${row.username}`,
                name: req.username || row.username,
                picture: '',
                profile: '',
                verified: false,
              },
              likes: row.likes || 0,
              time: new Date(row.time).toISOString(),
              edit: row.is_editable
                ? {
                    edited: false,
                    reason: '',
                    time: null,
                  }
                : null,
              vote: 0,
              controversy: 0,
              deletable: row.user_id === req.userId || req.isAdmin,
              editable: (row.user_id === req.userId && row.is_editable === 1) || req.isAdmin,
            };

            res.status(201).json(comment);

            // Update message stats (async)
            db.serialize(() => {
              db.run(`UPDATE messages SET comment_count = comment_count + 1 WHERE id = ?`, [messageId], (err) => {
                if (err) {
                  console.error(`[Comment Post] Error incrementing comment_count for message ${messageId}:`, err);
                } else {
                  updateMessageHotScore(messageId);
                }
              });
            });

            // RAG index (async, non-blocking)
            if (ragService) {
              ragService.indexContent('comment', newCommentId, text.trim()).catch(() => {});
            }

            // AI trigger (async)
            if (row.text && row.text.toLowerCase().includes('@goldierill')) {
              console.log(`[AI Trigger] Mention detected in comment ID: ${newCommentId}.`);

              db.get('SELECT content FROM messages WHERE id = ?', [messageId], async (err, messageRow) => {
                if (err) {
                  console.error(`[AI Error] Could not fetch parent message (ID: ${messageId}):`, err);
                  return;
                }
                if (!messageRow) {
                  console.error(`[AI Error] Parent message (ID: ${messageId}) not found.`);
                  return;
                }

                try {
                  const aiResponseText = await getAIResponse(messageRow.content, row.text, ragService);
                  if (aiResponseText) {
                    console.log(`[AI] Received response. Saving as reply to comment ${newCommentId}.`);
                    db.run(
                      `INSERT INTO comments (pid, user_id, username, text, message_id) VALUES (?, ?, ?, ?, ?)`,
                      [newCommentId, null, 'GoldieRill', aiResponseText, messageId],
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
                  console.error(`[AI Error] for comment ${newCommentId}:`, aiError);
                }
              });
            }
          });
        }
      );
    }
  });

  router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { text } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Comment text cannot be empty' });
    }

    db.get(`SELECT * FROM comments WHERE id = ?`, [id], (err, comment) => {
      if (err) {
        console.error('Error fetching comment for update:', err);
        return res.status(500).json({ error: err.message });
      }

      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      if (!req.isAdmin) {
        if (!comment.user_id || comment.user_id !== req.userId) {
          return res.status(403).json({ error: 'You can only update your own comments' });
        }
        if (comment.is_editable !== 1) {
          return res.status(400).json({ error: 'This comment is not editable' });
        }
      } else {
        if (comment.is_editable !== 1) {
          return res.status(400).json({ error: 'This comment is not editable' });
        }
      }

      db.run(`UPDATE comments SET text = ? WHERE id = ?`, [text.trim(), id], function (err) {
        if (err) {
          console.error('Error updating comment:', err);
          return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Comment not found' });
        }

        db.get(`SELECT * FROM comments WHERE id = ?`, [id], (err, row) => {
          if (err) {
            console.error('Error fetching updated comment:', err);
            return res.status(500).json({ error: err.message });
          }

          if (!row) {
            return res.status(404).json({ error: 'Comment not found' });
          }

          const updatedComment = {
            id: row.id.toString(),
            pid: row.pid ? row.pid.toString() : null,
            text: row.text,
            user: {
              id: row.user_id ? `user_${row.user_id}` : `anonymous_${row.username}`,
              name: row.user_id ? req.username : row.username,
              picture: '',
              profile: '',
              verified: false,
            },
            likes: row.likes || 0,
            time: new Date(row.time).toISOString(),
            edit: {
              edited: true,
              reason: '',
              time: new Date().toISOString(),
            },
            vote: 0,
            controversy: 0,
            deletable: row.user_id === req.userId || req.isAdmin,
            editable: (row.user_id === req.userId && row.is_editable === 1) || req.isAdmin,
          };

          res.status(200).json(updatedComment);

          // RAG re-index (async)
          if (ragService) {
            ragService.indexContent('comment', parseInt(id), text.trim()).catch(() => {});
          }
        });
      });
    });
  });

  router.delete('/:id', (req, res) => {
    const { id } = req.params;

    db.get(`SELECT * FROM comments WHERE id = ?`, [id], (err, comment) => {
      if (err) {
        console.error('Error fetching comment for deletion:', err);
        return res.status(500).json({ error: err.message });
      }

      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      if (!req.isAdmin && (!comment.user_id || comment.user_id !== req.userId)) {
        return res.status(403).json({ error: 'You can only delete your own comments' });
      }

      const messageId = comment.message_id;

      db.run(`UPDATE comments SET is_deleted = 1 WHERE id = ?`, [id], function (err) {
        if (err) {
          console.error('Error deleting comment:', err);
          return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Comment not found' });
        }

        res.status(204).send();

        // Update message stats (async)
        db.serialize(() => {
          db.run(`UPDATE messages SET comment_count = comment_count - 1 WHERE id = ? AND comment_count > 0`, [messageId], (err) => {
            if (err) {
              console.error(`[Comment Delete] Error decrementing comment_count for message ${messageId}:`, err);
            } else {
              updateMessageHotScore(messageId);
            }
          });
        });

        // RAG remove (async)
        if (ragService) {
          ragService.removeContent('comment', parseInt(id)).catch(() => {});
        }
      });
    });
  });

  router.post('/:id/like', (req, res) => {
    const { id } = req.params;
    const commentId = parseInt(id);

    db.get(`SELECT likes, likers FROM comments WHERE id = ?`, [commentId], (err, comment) => {
      if (err) {
        console.error('Error fetching comment for liking:', err);
        return res.status(500).json({ error: err.message });
      }

      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      let likers = [];
      try {
        likers = JSON.parse(comment.likers || '[]');
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
        newLikesCount = Math.max(0, comment.likes - 1);
        userHasLiked = false;
      } else {
        likers.push(currentUserIdentifier);
        newLikesCount = comment.likes + 1;
        userHasLiked = true;
      }

      const newLikersJson = JSON.stringify(likers);
      db.run(`UPDATE comments SET likes = ?, likers = ? WHERE id = ?`, [newLikesCount, newLikersJson, commentId], function (err) {
        if (err) {
          console.error('Error updating comment likes:', err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, likes: newLikesCount, userHasLiked: userHasLiked });
      });
    });
  });

  return router;
};
