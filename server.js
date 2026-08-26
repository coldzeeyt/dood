const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CURRENT_FILE = path.join(DATA_DIR, 'current.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const PASSWORD_FILE = path.join(DATA_DIR, 'admin-password.json');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const AUTOPILOT_ENABLED = process.env.AUTOPILOT_ENABLED !== 'false';
const HISTORY_MAX_ENTRIES = Number(process.env.HISTORY_MAX_ENTRIES) || 60;

const AUTOPILOT_NAMES = [
  'Buddy', 'Bella', 'Max', 'Charlie', 'Luna', 'Cooper', 'Daisy', 'Rocky',
  'Milo', 'Lucy', 'Duke', 'Sadie', 'Bear', 'Molly', 'Tucker', 'Zoey',
  'Jack', 'Ruby', 'Winston', 'Maggie', 'Leo', 'Stella', 'Bentley', 'Coco',
  'Otis', 'Nala', 'Baxter', 'Willow', 'Finn', 'Peanut',
];

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function readCurrent() {
  try {
    return JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeCurrent(entry) {
  fs.writeFileSync(CURRENT_FILE, JSON.stringify(entry, null, 2));
}

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeHistory(list) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2));
}

function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeQueue(list) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(list, null, 2));
}

function deleteUploadFile(entry) {
  if (!entry || !entry.url || !entry.url.startsWith('/uploads/')) return;
  fs.unlink(path.join(DATA_DIR, entry.url.slice(1)), () => {});
}

// Moves the outgoing "current" dog into the history list instead of
// deleting its photo, so past dogs stay viewable. Oldest entries past the
// cap are dropped and their local files cleaned up.
function archiveToHistory(previous) {
  if (!previous) return;
  const history = readHistory();
  history.unshift(previous);
  const overflow = history.splice(HISTORY_MAX_ENTRIES);
  overflow.forEach(deleteUploadFile);
  writeHistory(history);
}

function formatBreed(breedPath) {
  return breedPath.split('/').reverse().map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
}

async function fetchAutopilotDog() {
  const res = await fetch('https://dog.ceo/api/breeds/image/random');
  const data = await res.json();
  const match = data.message.match(/\/breeds\/([^/]+(?:\/[^/]+)?)\//);
  const breed = match ? formatBreed(match[1]) : 'Dog';
  const name = AUTOPILOT_NAMES[Math.floor(Math.random() * AUTOPILOT_NAMES.length)];
  return {
    url: data.message,
    name: `${name} the ${breed}`,
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
    const previous = readCurrent();
    const queue = readQueue();
    const idx = queue.findIndex((item) => item.status === 'approved');
    let entry;
    if (idx !== -1) {
      const [next] = queue.splice(idx, 1);
      writeQueue(queue);
      entry = { url: next.url, name: next.name, caption: next.caption || '', updatedAt: new Date().toISOString() };
      console.log(`Next dog from queue: ${entry.name}`);
    } else {
      entry = await fetchAutopilotDog();
      console.log(`Autopilot picked ${entry.name}`);
    }
    writeCurrent(entry);
    archiveToHistory(previous);
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

  const checkAndRun = () => {
    const current = readCurrent();
    const now = new Date();
    if (!current) {
      advanceDog();
      return;
    }
    const updated = new Date(current.updatedAt);
    if (isSameLocalDay(updated, now)) return;
    if (now.getHours() === 0 && now.getMinutes() < 5) {
      advanceDog();
    }
  };

  checkAndRun();
  setInterval(checkAndRun, 60 * 1000);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function readStoredPassword() {
  try {
    return JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeStoredPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(PASSWORD_FILE, JSON.stringify({ salt, hash: hashPassword(password, salt) }));
}

// Checks against a changed password stored on disk if one has been set via
// /api/change-password, otherwise falls back to the ADMIN_PASSWORD env var.
function passwordMatches(candidate) {
  if (!candidate) return false;
  const stored = readStoredPassword();
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
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype));
  },
});

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
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/current', (req, res) => {
  res.json(readCurrent());
});

app.get('/api/history', (req, res) => {
  res.json(readHistory());
});

app.post('/api/upload', (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!passwordMatches(req.body.password)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    if (!req.body.name || !req.body.name.trim()) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Dog's name is required" });
    }

    const previous = readCurrent();
    const entry = {
      url: `/uploads/${req.file.filename}`,
      name: req.body.name.trim().slice(0, 80),
      caption: (req.body.caption || '').slice(0, 200),
      updatedAt: new Date().toISOString(),
    };
    writeCurrent(entry);
    archiveToHistory(previous);

    res.json(entry);
  });
});

app.post('/api/autopilot', multer().none(), async (req, res) => {
  if (!passwordMatches(req.body.password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  try {
    const entry = await advanceDog();
    res.json(entry);
  } catch {
    res.status(502).json({ error: 'Could not fetch a dog right now, try again' });
  }
});

app.post('/api/request', (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    if (!req.body.name || !req.body.name.trim()) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Dog's name is required" });
    }

    const queue = readQueue();
    queue.push({
      id: crypto.randomUUID(),
      url: `/uploads/${req.file.filename}`,
      name: req.body.name.trim().slice(0, 80),
      caption: (req.body.caption || '').slice(0, 200),
      submittedAt: new Date().toISOString(),
      status: 'pending',
    });
    writeQueue(queue);

    res.json({ position: queue.length });
  });
});

app.post('/api/queue/list', multer().none(), (req, res) => {
  if (!passwordMatches(req.body.password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json(readQueue());
});

app.post('/api/queue/accept', multer().none(), (req, res) => {
  if (!passwordMatches(req.body.password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const queue = readQueue();
  const item = queue.find((q) => q.id === req.body.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  item.status = 'approved';
  writeQueue(queue);
  res.json({ success: true });
});

app.post('/api/queue/deny', multer().none(), (req, res) => {
  if (!passwordMatches(req.body.password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const queue = readQueue();
  const idx = queue.findIndex((q) => q.id === req.body.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = queue.splice(idx, 1);
  deleteUploadFile(removed);
  writeQueue(queue);
  res.json({ success: true });
});

app.post('/api/change-password', multer().none(), (req, res) => {
  if (!passwordMatches(req.body.currentPassword)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (!req.body.newPassword || req.body.newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }
  writeStoredPassword(req.body.newPassword);
  res.json({ success: true });
});

// Catches anything unexpected so clients get clean JSON instead of an
// Express-generated HTML page with a stack trace (which leaks file paths).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Dog of the Day listening on port ${PORT}`);
  scheduleMidnightAutopilot();
});
