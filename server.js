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
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

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

    const previous = readCurrent();
    const entry = {
      url: `/uploads/${req.file.filename}`,
      caption: (req.body.caption || '').slice(0, 200),
      updatedAt: new Date().toISOString(),
    };
    writeCurrent(entry);

    if (previous && previous.url) {
      const oldPath = path.join(DATA_DIR, previous.url.replace('/uploads', 'uploads'));
      fs.unlink(oldPath, () => {});
    }

    res.json(entry);
  });
});

app.listen(PORT, () => {
  console.log(`Dog of the Day listening on port ${PORT}`);
});
