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

async function runAutopilot() {
  try {
    const previous = readCurrent();
    const entry = await fetchAutopilotDog();
    writeCurrent(entry);
    archiveToHistory(previous);
    console.log(`Autopilot picked ${entry.name}`);
    return entry;
  } catch (err) {
    console.error('Autopilot fetch failed:', err.message);
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
      runAutopilot();
      return;
    }
    const updated = new Date(current.updatedAt);
    if (isSameLocalDay(updated, now)) return;
    if (now.getHours() === 0 && now.getMinutes() < 5) {
      runAutopilot();
    }
  };

  checkAndRun();
  setInterval(checkAndRun, 60 * 1000);
}

function passwordMatches(candidate) {
  if (!ADMIN_PASSWORD || !candidate) return false;
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
    const entry = await runAutopilot();
    res.json(entry);
  } catch {
    res.status(502).json({ error: 'Could not fetch a dog right now, try again' });
  }
});

app.listen(PORT, () => {
  console.log(`Dog of the Day listening on port ${PORT}`);
  scheduleMidnightAutopilot();
});
