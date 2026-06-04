const { calculateHotScore } = require('../utils/hot-score');

/**
 * 初始化数据库表结构和索引
 * @param {import('sqlite3').Database} db - SQLite 数据库实例
 * @param {() => void} cleanupOrphanedImages - 清理孤儿文件的函数
 */
function initializeDatabase(db, cleanupOrphanedImages) {
  // 作品集站(cv-web)相关：获客线索 + AI 助手问答记录。
  // 与下方主流程链式建表互不依赖，独立创建即可。
  db.run(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT NULL,
    contact TEXT NOT NULL,
    message TEXT DEFAULT NULL,
    session_id TEXT DEFAULT NULL,
    ip TEXT DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating leads table:', err.message);
    else console.log('Leads table created or already exists.');
  });

  db.run(`CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT DEFAULT NULL,
    question TEXT NOT NULL,
    answer TEXT DEFAULT NULL,
    sources TEXT DEFAULT NULL,
    ip TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating chat_logs table:', err.message);
    else console.log('Chat_logs table created or already exists.');
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_chat_logs_session ON chat_logs(session_id)`);

  // 创建 messages 表
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_private INTEGER DEFAULT 0,
    private_key TEXT DEFAULT NULL,
    user_id INTEGER DEFAULT NULL,
    has_image INTEGER DEFAULT 0,
    image_filename TEXT DEFAULT NULL,
    image_mime_type TEXT DEFAULT NULL,
    image_size INTEGER DEFAULT NULL,
    comment_count INTEGER DEFAULT 0,
    hot_score REAL DEFAULT 0,
    likes INTEGER DEFAULT 0,
    likers TEXT DEFAULT '[]'
  )`, (err) => {
    if (err) {
      console.error('Error creating messages table:', err.message);
    } else {
      console.log('Messages table created or already exists.');

      // 确保现有表也有新字段（如果表已存在但缺少字段）
      addMissingColumns();
    }
  });

  // 添加缺失的列
  function addMissingColumns() {
    const alterColumns = [
      { sql: `ALTER TABLE messages ADD COLUMN is_private INTEGER DEFAULT 0`, name: 'is_private' },
      { sql: `ALTER TABLE messages ADD COLUMN private_key TEXT DEFAULT NULL`, name: 'private_key' },
      { sql: `ALTER TABLE messages ADD COLUMN user_id INTEGER DEFAULT NULL`, name: 'user_id' },
      { sql: `ALTER TABLE messages ADD COLUMN has_image INTEGER DEFAULT 0`, name: 'has_image' },
      { sql: `ALTER TABLE messages ADD COLUMN image_filename TEXT DEFAULT NULL`, name: 'image_filename' },
      { sql: `ALTER TABLE messages ADD COLUMN image_mime_type TEXT DEFAULT NULL`, name: 'image_mime_type' },
      { sql: `ALTER TABLE messages ADD COLUMN image_size INTEGER DEFAULT NULL`, name: 'image_size' },
      { sql: `ALTER TABLE messages ADD COLUMN comment_count INTEGER DEFAULT 0`, name: 'comment_count' },
      { sql: `ALTER TABLE messages ADD COLUMN hot_score REAL DEFAULT 0`, name: 'hot_score' },
      { sql: `ALTER TABLE messages ADD COLUMN likes INTEGER DEFAULT 0`, name: 'likes' },
      { sql: `ALTER TABLE messages ADD COLUMN likers TEXT DEFAULT '[]'`, name: 'likers' }
    ];

    let completed = 0;

    alterColumns.forEach((column) => {
      db.run(column.sql, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error(`Error adding ${column.name} column:`, err.message);
        } else if (!err || err.message.includes('duplicate column name')) {
          console.log(`${column.name} column added or already exists.`);
        }

        completed++;
        if (completed === alterColumns.length) {
          // 所有列添加完成后，创建 users 表
          createUsersTable();
        }
      });
    });
  }

  // 创建 users 表
  function createUsersTable() {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error creating users table:', err.message);
      } else {
        console.log('Users table created or already exists.');

        // 创建 comments 表
        createCommentsTable();
      }
    });
  }

  // 创建 comments 表
  function createCommentsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pid INTEGER DEFAULT NULL,  -- 父评论ID，用于回复
      user_id INTEGER DEFAULT NULL,  -- 用户ID，NULL表示匿名用户
      username TEXT NOT NULL,  -- 用户名，即使是匿名用户也会有名称
      text TEXT NOT NULL,  -- 评论内容
      likes INTEGER DEFAULT 0, -- 点赞数
      likers TEXT DEFAULT '[]', -- 存储点赞用户信息，格式为JSON字符串数组
      time DATETIME DEFAULT CURRENT_TIMESTAMP,  -- 评论时间
      is_deleted INTEGER DEFAULT 0,  -- 是否删除
      is_editable INTEGER DEFAULT 1,  -- 是否可编辑
      message_id INTEGER,  -- 关联的消息ID
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )`, (err) => {
      if (err) {
        console.error('Error creating comments table:', err.message);
      } else {
        console.log('Comments table created or already exists.');

        // 创建数据库索引
        createDatabaseIndexes();
      }
    });
  }

  /**
   * 对现有数据进行一次性回填，计算 comment_count 和基于总点赞数的 hot_score
   */
  function backfillHotScores() {
    console.log('[Backfill] Starting to backfill comment_count and hot_score for existing messages...');

    db.serialize(() => {
      // 步骤 1: 更新所有消息的 comment_count (此逻辑仍然有用)
      const updateCountsSql = `
        UPDATE messages
        SET comment_count = (
          SELECT COUNT(*)
          FROM comments
          WHERE comments.message_id = messages.id AND comments.is_deleted = 0
        )
        WHERE EXISTS (
          SELECT 1 FROM comments WHERE comments.message_id = messages.id
        );
      `;

      db.run(updateCountsSql, function(err) {
        if (err) {
          console.error('[Backfill] Error updating comment_count:', err.message);
          // Don't stop, proceed to hot_score backfill
        }
        console.log(`[Backfill] Successfully updated comment_count for ${this.changes} messages.`);

        // 步骤 2: 获取所有消息及其总点赞数，计算并更新 hot_score
        const messagesWithLikesSql = `
          SELECT
            m.id,
            m.timestamp,
            (SELECT SUM(c.likes) FROM comments c WHERE c.message_id = m.id AND c.is_deleted = 0) as total_likes
          FROM messages m
        `;
        
        db.all(messagesWithLikesSql, [], (err, messages) => {
          if (err) {
            console.error('[Backfill] Error fetching messages for hot_score calculation:', err.message);
            return;
          }

          if (messages.length === 0) {
            console.log('[Backfill] No messages to backfill for hot_score. Completed.');
            return;
          }
          
          console.log(`[Backfill] Calculating hot_score for ${messages.length} messages based on total likes...`);
          
          db.serialize(() => {
            const stmt = db.prepare(`UPDATE messages SET hot_score = ? WHERE id = ?`);
            messages.forEach(message => {
              const totalLikes = message.total_likes || 0;
              const hotScore = calculateHotScore(totalLikes, message.timestamp);
              stmt.run(hotScore, message.id, (err) => {
                if (err) {
                  console.error(`[Backfill] Error updating hot_score for message ${message.id}:`, err.message);
                }
              });
            });
            
            stmt.finalize((err) => {
              if (err) {
                console.error('[Backfill] Error finalizing statement:', err.message);
              } else {
                console.log('[Backfill] hot_score backfill process completed.');
              }
            });
          });
        });
      });
    });
  }

  // 创建数据库索引
  function createDatabaseIndexes() {
    console.log('Creating database indexes for performance optimization...');

    const indexes = [
      { sql: `CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)`, name: 'idx_messages_timestamp' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_messages_is_private ON messages(is_private)`, name: 'idx_messages_is_private' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)`, name: 'idx_messages_user_id' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_messages_private_key ON messages(private_key)`, name: 'idx_messages_private_key' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_messages_has_image ON messages(has_image)`, name: 'idx_messages_has_image' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`, name: 'idx_users_username' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_comments_time ON comments(time DESC)`, name: 'idx_comments_time' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_comments_pid ON comments(pid)`, name: 'idx_comments_pid' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id)`, name: 'idx_comments_user_id' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_comments_message_id ON comments(message_id)`, name: 'idx_comments_message_id' },
      { sql: `CREATE INDEX IF NOT EXISTS idx_messages_hot_score ON messages(hot_score DESC)`, name: 'idx_messages_hot_score' }
    ];

    let completed = 0;

    indexes.forEach((index) => {
      db.run(index.sql, (err) => {
        if (err) {
          console.error(`Error creating ${index.name} index:`, err.message);
        } else {
          console.log(`Index ${index.name} created or already exists.`);
        }

        completed++;
        if (completed === indexes.length) {
          console.log('Database indexes creation completed.');

          // 在索引创建完成后并且在设置其他任务之前，运行回填脚本
          backfillHotScores();

          // 数据库初始化完成后，清理孤儿图片文件
          cleanupOrphanedImages();

          // 每小时清理一次孤儿图片文件
          setInterval(cleanupOrphanedImages, 60 * 60 * 1000);
        }
      });
    });
  }
}

module.exports = initializeDatabase;
