require('dotenv').config();

const path = require('path');
const express = require('express');

const connectDatabase = require('./config/database');
const sessionMiddleware = require('./middleware/session');
const { createGetCurrentUserMiddleware } = require('./middleware/auth');
const { requireInvitation } = require('./middleware/invite');
const createImageAccessMiddleware = require('./middleware/imageAccess');
const { upload, generalUpload, uploadsDir } = require('./middleware/upload');

const createMainRoutes = require('./routes/main');
const createAuthRoutes = require('./routes/auth');
const createMessageRoutes = require('./routes/messages');
const createCommentRoutes = require('./routes/comments');
const createUploadRoutes = require('./routes/upload');
const createSearchRoutes = require('./routes/search');
const createInviteRoutes = require('./routes/invite');
const createChatRoutes = require('./routes/chat');

const createRAGService = require('./utils/rag-service');

const app = express();
const port = 1989;
const db = connectDatabase(uploadsDir);

const ragService = createRAGService();

app.use((req, res, next) => {
  req.setTimeout(30000);
  res.setTimeout(30000);
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(express.json());

app.use(sessionMiddleware);
app.use(createGetCurrentUserMiddleware(db));

app.use('/uploads/:filename', createImageAccessMiddleware(db));
app.use('/uploads', express.static(uploadsDir));

const inviteRoutes = createInviteRoutes();
app.use('/invite', inviteRoutes);
app.use('/api/invite', inviteRoutes);

app.use('/', requireInvitation, createMainRoutes(db));

const authRoutes = createAuthRoutes(db);
const messageRoutes = createMessageRoutes(db, uploadsDir, ragService);
const commentRoutes = createCommentRoutes(db, ragService);
const uploadRoutes = createUploadRoutes(upload, generalUpload, uploadsDir);
const searchRoutes = createSearchRoutes(db, ragService);

app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/search', searchRoutes);
app.use('/api', uploadRoutes);

// --- Portfolio chat endpoint (cross-origin, called directly by the CV site) ---
// CORS scoped to /api/chat only; whitelist overridable via CHAT_ALLOWED_ORIGINS.
const chatAllowedOrigins = (process.env.CHAT_ALLOWED_ORIGINS ||
  'https://cv.goldierill.com,http://localhost:5173,http://localhost:4173')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Allow any localhost / 127.0.0.1 port during development (vite may shift ports).
const isLocalhostOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

const chatCors = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (chatAllowedOrigins.includes(origin) || isLocalhostOrigin(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
};

app.use('/api/chat', chatCors, createChatRoutes(db, ragService));

const server = app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);

  if (process.env.RUN_VEC_MIGRATION === 'true') {
    const runMigration = require('./database/vec-migration');
    setTimeout(() => runMigration(db), 5000);
  }
});

let reindexRunning = false;
app.post('/api/admin/reindex', (req, res) => {
  if (reindexRunning) {
    return res.status(409).json({ error: 'Reindex already running' });
  }
  reindexRunning = true;
  res.json({ status: 'started' });

  const runMigration = require('./database/vec-migration');
  runMigration(db).then(() => {
    reindexRunning = false;
    console.log('[Admin] Reindex completed');
  }).catch(err => {
    reindexRunning = false;
    console.error('[Admin] Reindex failed:', err.message);
  });
});

setInterval(() => {
  const used = process.memoryUsage();
  console.log(`[Memory] RSS: ${(used.rss / 1024 / 1024).toFixed(1)}MB | Heap: ${(used.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(used.heapTotal / 1024 / 1024).toFixed(1)}MB | External: ${(used.external / 1024 / 1024).toFixed(1)}MB`);
}, 30000);

server.setTimeout(30000);
