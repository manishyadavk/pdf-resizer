const form = document.getElementById('form');
const fileInput = document.getElementById('file');
const dropzone = document.getElementById('dropzone');
const fileLabel = document.getElementById('fileLabel');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  fileLabel.textContent = f ? `${f.name} (${formatBytes(f.size)})` : 'Click to choose a PDF, or drag one here';
});

['dragover', 'dragenter'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (dt.files && dt.files[0]) {
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change'));
  }
});

function showStatus(msg) {
  statusEl.hidden = false;
  statusEl.textContent = msg;
}

function hideStatus() {
  statusEl.hidden = true;
}

function showResult(html, variant) {
  resultEl.hidden = false;
  resultEl.className = `result ${variant}`;
  resultEl.innerHTML = html;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  resultEl.hidden = true;

  const file = fileInput.files[0];
  const targetSize = document.getElementById('targetSize').value;
  const unit = document.getElementById('unit').value;

  if (!file) return;

  const fd = new FormData();
  fd.append('file', file);
  fd.append('targetSize', targetSize);
  fd.append('unit', unit);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Resizing…';
  showStatus('Uploading and compressing — this can take a little while for large files.');

  try {
    const res = await fetch('/api/compress', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) {
      showResult(`<p>${data.error || 'Something went wrong.'}</p>`, 'error');
      return;
    }

    hideStatus();

    const achievedStr = formatBytes(data.achievedSize);
    const originalStr = formatBytes(data.originalSize);
    const pagesLine = `${data.resultPages} of ${data.originalPages} pages kept — no content removed.`;

    if (data.alreadyUnderTarget) {
      showResult(
        `<p>Your PDF is already ${achievedStr}, under your ${document.getElementById('targetSize').value}${unit} target — no compression needed.</p>
         <p>${pagesLine}</p>
         <a class="download-btn" href="${data.downloadUrl}">Download PDF</a>`,
        'success'
      );
    } else if (data.achievedTarget) {
      showResult(
        `<p>Done — resized from ${originalStr} to ${achievedStr}.</p>
         <p>${pagesLine}</p>
         <a class="download-btn" href="${data.downloadUrl}">Download PDF</a>`,
        'success'
      );
    } else {
      showResult(
        `<p>Couldn't hit your exact target without dropping content. Best achievable size while keeping every page: <strong>${achievedStr}</strong> (from ${originalStr}).</p>
         <p>${pagesLine}</p>
         <a class="download-btn" href="${data.downloadUrl}">Download closest result</a>`,
        'warn'
      );
    }
  } catch (err) {
    hideStatus();
    showResult(`<p>Network error: ${err.message}</p>`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Resize PDF';
  }
});
