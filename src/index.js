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

const createRAGService = require('./utils/rag-service');

const app = express();
const port = 1989;
const db = connectDatabase(uploadsDir);

const ragService = createRAGService();

app.use((req, res, next) => {
  req.setTimeout(300000);
  res.setTimeout(300000);
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

const server = app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);

  if (process.env.RUN_VEC_MIGRATION === 'true') {
    const runMigration = require('./database/vec-migration');
    setTimeout(() => runMigration(db), 5000);
  }
});

server.setTimeout(300000);
