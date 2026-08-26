const crypto = require('crypto');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const AUTOPILOT_ENABLED = process.env.AUTOPILOT_ENABLED !== 'false';
const HISTORY_MAX_ENTRIES = Number(process.env.HISTORY_MAX_ENTRIES) || 60;

const AUTOPILOT_NAMES = [
  'Buddy', 'Bella', 'Max', 'Charlie', 'Luna', 'Cooper', 'Daisy', 'Rocky',
  'Milo', 'Lucy', 'Duke', 'Sadie', 'Bear', 'Molly', 'Tucker', 'Zoey',
  'Jack', 'Ruby', 'Winston', 'Maggie', 'Leo', 'Stella', 'Bentley', 'Coco',
  'Otis', 'Nala', 'Baxter', 'Willow', 'Finn', 'Peanut',
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      id UUID PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS history (
      id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      name TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS queue (
      id UUID PRIMARY KEY,
      url TEXT NOT NULL,
      name TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      submitted_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
  `);
}

async function getState(key) {
  const { rows } = await pool.query('SELECT value FROM app_state WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}

async function setState(key, value) {
  await pool.query(
    'INSERT INTO app_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [key, value]
  );
}

const readCurrent = () => getState('current');
const writeCurrent = (entry) => setState('current', entry);

async function readHistory() {
  const { rows } = await pool.query(
    'SELECT url, name, caption, updated_at AS "updatedAt" FROM history ORDER BY updated_at DESC LIMIT $1',
    [HISTORY_MAX_ENTRIES]
  );
  return rows;
}

async function savePhoto(buffer, mimeType) {
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO photos (id, mime_type, data) VALUES ($1, $2, $3)', [id, mimeType, buffer]);
  return `/photos/${id}`;
}

async function deletePhotoFromUrl(url) {
  if (!url || !url.startsWith('/photos/')) return;
  await pool.query('DELETE FROM photos WHERE id = $1', [url.slice('/photos/'.length)]);
}

// Moves the outgoing "current" dog into the history table instead of
// deleting its photo, so past dogs stay viewable. Oldest entries past the
// cap are dropped and their photos cleaned up.
async function archiveToHistory(previous) {
  if (!previous) return;
  await pool.query(
    'INSERT INTO history (url, name, caption, updated_at) VALUES ($1, $2, $3, $4)',
    [previous.url, previous.name, previous.caption || '', previous.updatedAt]
  );
  const { rows: overflow } = await pool.query(
    `DELETE FROM history WHERE id IN (
       SELECT id FROM history ORDER BY updated_at DESC OFFSET $1
     ) RETURNING url`,
    [HISTORY_MAX_ENTRIES]
  );
  await Promise.all(overflow.map((row) => deletePhotoFromUrl(row.url)));
}

async function readQueue() {
  const { rows } = await pool.query(
    'SELECT id, url, name, caption, submitted_at AS "submittedAt", status FROM queue ORDER BY submitted_at ASC'
  );
  return rows;
}

async function fetchAutopilotDog() {
  const res = await fetch('https://dog.ceo/api/breeds/image/random');
  const data = await res.json();
  const name = AUTOPILOT_NAMES[Math.floor(Math.random() * AUTOPILOT_NAMES.length)];
  return {
    url: data.message,
    name,
    caption: '',
    updatedAt: new Date().toISOString(),
    auto: true,
  };
}

// Advances to the next dog: the oldest *approved* queued request takes
// priority, and only once there are none does this fall back to fetching a
// random dog. Pending (not yet moderated) submissions are skipped.
async function advanceDog() {
  try {
    const previous = await readCurrent();
    const { rows } = await pool.query(
      "SELECT * FROM queue WHERE status = 'approved' ORDER BY submitted_at ASC LIMIT 1"
    );
    const approved = rows[0];
    let entry;
    if (approved) {
      await pool.query('DELETE FROM queue WHERE id = $1', [approved.id]);
      entry = { url: approved.url, name: approved.name, caption: approved.caption || '', updatedAt: new Date().toISOString() };
      console.log(`Next dog from queue: ${entry.name}`);
    } else {
      entry = await fetchAutopilotDog();
      console.log(`Autopilot picked ${entry.name}`);
    }
    await writeCurrent(entry);
    await archiveToHistory(previous);
    return entry;
  } catch (err) {
    console.error('Advancing to next dog failed:', err.message);
    throw err;
  }
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Runs autopilot once at server start if there's nothing to show yet, and
// otherwise only in the few minutes after local midnight each day, so it
// never kicks in mid-day and overrides a manual upload. The other way to
// get a fresh autopilot dog is the password-protected /api/autopilot route.
function scheduleMidnightAutopilot() {
  if (!AUTOPILOT_ENABLED) return;

  const checkAndRun = async () => {
    const current = await readCurrent();
    const now = new Date();
    if (!current) {
      await advanceDog();
      return;
    }
    const updated = new Date(current.updatedAt);
    if (isSameLocalDay(updated, now)) return;
    if (now.getHours() === 0 && now.getMinutes() < 5) {
      await advanceDog();
    }
  };

  checkAndRun();
  setInterval(checkAndRun, 60 * 1000);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

const readStoredPassword = () => getState('password');

async function writeStoredPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  await setState('password', { salt, hash: hashPassword(password, salt) });
}

// Checks against a changed password stored in the database if one has been
// set via /api/change-password, otherwise falls back to ADMIN_PASSWORD.
async function passwordMatches(candidate) {
  if (!candidate) return false;
  const stored = await readStoredPassword();
  if (stored) {
    const a = Buffer.from(hashPassword(candidate, stored.salt), 'hex');
    const b = Buffer.from(stored.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype));
  },
});

const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
// multer only populates req.body for actual multipart/form-data requests,
// leaving it undefined otherwise (e.g. a bare POST with no body) — default
// it to an empty object so route handlers can safely read req.body.<field>.
app.use((req, res, next) => {
  if (!req.body) req.body = {};
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/photos/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT mime_type, data FROM photos WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.sendStatus(404);
  res.set('Content-Type', rows[0].mime_type);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(rows[0].data);
}));

app.get('/api/current', asyncHandler(async (req, res) => {
  res.json(await readCurrent());
}));

app.get('/api/history', asyncHandler(async (req, res) => {
  res.json(await readHistory());
}));

app.post('/api/upload', (req, res, next) => {
  upload.single('photo')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!(await passwordMatches(req.body.password))) {
        return res.status(401).json({ error: 'Wrong password' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
      }
      if (!req.body.name || !req.body.name.trim()) {
        return res.status(400).json({ error: "Dog's name is required" });
      }

      const url = await savePhoto(req.file.buffer, req.file.mimetype);
      const previous = await readCurrent();
      const entry = {
        url,
        name: req.body.name.trim().slice(0, 80),
        caption: (req.body.caption || '').slice(0, 200),
        updatedAt: new Date().toISOString(),
      };
      await writeCurrent(entry);
      await archiveToHistory(previous);

      res.json(entry);
    } catch (e) {
      next(e);
    }
  });
});

app.post('/api/autopilot', multer().none(), asyncHandler(async (req, res) => {
  if (!(await passwordMatches(req.body.password))) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  try {
    const entry = await advanceDog();
    res.json(entry);
  } catch {
    res.status(502).json({ error: 'Could not fetch a dog right now, try again' });
  }
}));

app.post('/api/request', (req, res, next) => {
  upload.single('photo')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
      }
      if (!req.body.name || !req.body.name.trim()) {
        return res.status(400).json({ error: "Dog's name is required" });
      }

      const url = await savePhoto(req.file.buffer, req.file.mimetype);
      await pool.query(
        'INSERT INTO queue (id, url, name, caption, submitted_at, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [crypto.randomUUID(), url, req.body.name.trim().slice(0, 80), (req.body.caption || '').slice(0, 200), new Date().toISOString(), 'pending']
      );
      const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM queue');

      res.json({ position: Number(countRows[0].count) });
    } catch (e) {
      next(e);
    }
  });
});

app.post('/api/queue/list', multer().none(), asyncHandler(async (req, res) => {
  if (!(await passwordMatches(req.body.password))) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json(await readQueue());
}));

app.post('/api/queue/accept', multer().none(), asyncHandler(async (req, res) => {
  if (!(await passwordMatches(req.body.password))) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const { rows } = await pool.query("UPDATE queue SET status = 'approved' WHERE id = $1 RETURNING id", [req.body.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
}));

app.post('/api/queue/deny', multer().none(), asyncHandler(async (req, res) => {
  if (!(await passwordMatches(req.body.password))) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const { rows } = await pool.query('DELETE FROM queue WHERE id = $1 RETURNING url', [req.body.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await deletePhotoFromUrl(rows[0].url);
  res.json({ success: true });
}));

app.post('/api/change-password', multer().none(), asyncHandler(async (req, res) => {
  if (!(await passwordMatches(req.body.currentPassword))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (!req.body.newPassword || req.body.newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }
  await writeStoredPassword(req.body.newPassword);
  res.json({ success: true });
}));

// Catches anything unexpected so clients get clean JSON instead of an
// Express-generated HTML page with a stack trace (which leaks file paths).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Dog of the Day listening on port ${PORT}`);
    scheduleMidnightAutopilot();
  });
}

start();
