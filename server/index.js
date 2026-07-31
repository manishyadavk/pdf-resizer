const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compressToTarget } = require('./compress');

const UPLOAD_DIR = path.join(__dirname, '..', 'tmp', 'uploads');
const OUTPUT_DIR = path.join(__dirname, '..', 'tmp', 'output');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB
const JOB_TTL_MS = 10 * 60 * 1000; // delete job files 10 min after completion

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const app = express();

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are accepted'));
    }
    cb(null, true);
  },
});

// jobId -> { outputPath, uploadPath, originalName, cleanupTimer }
const jobs = new Map();

function isPdfHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(5);
  fs.readSync(fd, buf, 0, 5, 0);
  fs.closeSync(fd);
  return buf.toString('ascii') === '%PDF-';
}

function scheduleCleanup(jobId) {
  const timer = setTimeout(() => {
    const job = jobs.get(jobId);
    if (!job) return;
    if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
    jobs.delete(jobId);
  }, JOB_TTL_MS);
  timer.unref();
  return timer;
}

app.post('/api/compress', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadPath = req.file.path;

    try {
      if (!isPdfHeader(uploadPath)) {
        fs.unlinkSync(uploadPath);
        return res.status(400).json({ error: 'Uploaded file is not a valid PDF' });
      }

      const targetSize = parseFloat(req.body.targetSize);
      const unit = req.body.unit === 'KB' ? 'KB' : 'MB';
      if (!Number.isFinite(targetSize) || targetSize <= 0) {
        fs.unlinkSync(uploadPath);
        return res.status(400).json({ error: 'Enter a valid target size greater than 0' });
      }

      const targetBytes = Math.round(targetSize * (unit === 'MB' ? 1024 * 1024 : 1024));

      const jobId = crypto.randomUUID();
      const jobDir = path.join(OUTPUT_DIR, jobId);
      fs.mkdirSync(jobDir, { recursive: true });

      const result = await compressToTarget(uploadPath, jobDir, targetBytes);

      let outputPath = result.outputPath;
      if (result.alreadyUnderTarget) {
        // outputPath currently points at the original upload; copy it into
        // the job dir so the upload file can be cleaned up independently.
        outputPath = path.join(jobDir, 'result.pdf');
        fs.copyFileSync(uploadPath, outputPath);
      }
      fs.unlinkSync(uploadPath);

      jobs.set(jobId, { outputPath, originalName: req.file.originalname });
      scheduleCleanup(jobId);

      res.json({
        jobId,
        downloadUrl: `/api/download/${jobId}`,
        originalSize: result.originalSize ?? result.achievedSize,
        achievedSize: result.achievedSize,
        achievedTarget: result.achievedTarget,
        alreadyUnderTarget: result.alreadyUnderTarget,
        originalPages: result.originalPages,
        resultPages: result.resultPages,
        targetBytes,
      });
    } catch (e) {
      if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
      console.error(e);
      res.status(500).json({ error: 'Compression failed: ' + e.message });
    }
  });
});

app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'File not found or expired' });
  }
  const downloadName = job.originalName
    ? job.originalName.replace(/\.pdf$/i, '') + '-resized.pdf'
    : 'resized.pdf';
  res.download(job.outputPath, downloadName);
});

app.use(express.static(PUBLIC_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`pdf-resizer listening on http://localhost:${PORT}`);
});
