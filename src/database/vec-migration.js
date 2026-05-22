const createRAGService = require('../utils/rag-service');

async function runMigration(db) {
  const ragService = createRAGService();

  console.log('[Migration] Starting RAG migration...');

  await migrateMessages(db, ragService);
  await migrateComments(db, ragService);

  console.log('[Migration] RAG migration completed.');
}

function dbAll(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function migrateMessages(db, ragService) {
  const messages = await dbAll(db, 'SELECT id, content FROM messages WHERE is_private = 0', []);

  console.log(`[Migration] Migrating ${messages.length} messages...`);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    try {
      await ragService.indexContent('message', msg.id, msg.content);
    } catch (err) {
      console.error(`[Migration] Error migrating message #${msg.id}: ${err.message}`);
    }
    if ((i + 1) % 10 === 0) {
      console.log(`[Migration] Messages: ${i + 1}/${messages.length}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`[Migration] Messages done (${messages.length}).`);
}

async function migrateComments(db, ragService) {
  const comments = await dbAll(db, 'SELECT id, text FROM comments WHERE is_deleted = 0', []);

  console.log(`[Migration] Migrating ${comments.length} comments...`);

  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    try {
      await ragService.indexContent('comment', c.id, c.text);
    } catch (err) {
      console.error(`[Migration] Error migrating comment #${c.id}: ${err.message}`);
    }
    if ((i + 1) % 10 === 0) {
      console.log(`[Migration] Comments: ${i + 1}/${comments.length}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`[Migration] Comments done (${comments.length}).`);
}

module.exports = runMigration;
