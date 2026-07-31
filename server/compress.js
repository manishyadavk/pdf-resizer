const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

// Ordered from lightest compression (best quality) to heaviest.
// Each profile downsamples embedded images to `res` dpi and re-encodes
// them as JPEG at quality `q`. Page count and page content are never
// touched — only embedded raster images and font subsetting are affected.
const PROFILES = [
  { res: 300, q: 90 },
  { res: 200, q: 85 },
  { res: 150, q: 80 },
  { res: 120, q: 75 },
  { res: 100, q: 70 },
  { res: 90, q: 60 },
  { res: 72, q: 50 },
  { res: 60, q: 40 },
  { res: 50, q: 35 },
  { res: 40, q: 30 },
  { res: 30, q: 25 },
  { res: 20, q: 20 },
];

function runGhostscript(inputPath, outputPath, { res, q }) {
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    '-dNOPAUSE',
    '-dQUIET',
    '-dBATCH',
    '-dSAFER',
    '-dDetectDuplicateImages=true',
    '-dDownsampleColorImages=true',
    `-dColorImageResolution=${res}`,
    '-dColorImageDownsampleType=/Bicubic',
    '-dDownsampleGrayImages=true',
    `-dGrayImageResolution=${res}`,
    '-dGrayImageDownsampleType=/Bicubic',
    '-dDownsampleMonoImages=true',
    `-dMonoImageResolution=${res}`,
    '-dAutoFilterColorImages=false',
    '-dColorImageFilter=/DCTEncode',
    `-dJPEGQ=${q}`,
    '-dAutoFilterGrayImages=false',
    '-dGrayImageFilter=/DCTEncode',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];
  return execFileAsync('gs', args, { timeout: 120000 });
}

async function getPageCount(pdfPath) {
  const { stdout } = await execFileAsync('pdfinfo', [pdfPath]);
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error('Could not determine page count');
  return parseInt(match[1], 10);
}

/**
 * Compresses inputPath toward targetBytes without dropping pages/content.
 * Uses binary search over PROFILES (image DPI + JPEG quality) since output
 * size is effectively monotonic with compression aggressiveness.
 */
async function compressToTarget(inputPath, workDir, targetBytes) {
  const originalSize = fs.statSync(inputPath).size;
  const originalPages = await getPageCount(inputPath);

  if (originalSize <= targetBytes) {
    return {
      outputPath: inputPath,
      achievedSize: originalSize,
      achievedTarget: true,
      alreadyUnderTarget: true,
      originalPages,
      resultPages: originalPages,
    };
  }

  const cache = new Map();
  const runProfile = async (i) => {
    if (cache.has(i)) return cache.get(i);
    const outPath = path.join(workDir, `attempt-${i}.pdf`);
    await runGhostscript(inputPath, outPath, PROFILES[i]);
    const size = fs.statSync(outPath).size;
    const result = { index: i, size, path: outPath };
    cache.set(i, result);
    return result;
  };

  let lo = 0;
  let hi = PROFILES.length - 1;
  let bestFit = null;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const result = await runProfile(mid);
    if (result.size <= targetBytes) {
      bestFit = result;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const winner = bestFit || (await runProfile(PROFILES.length - 1));
  const resultPages = await getPageCount(winner.path);

  // Clean up every attempt file except the winner.
  for (const [i, result] of cache.entries()) {
    if (result.path !== winner.path && fs.existsSync(result.path)) {
      fs.unlinkSync(result.path);
    }
  }

  return {
    outputPath: winner.path,
    achievedSize: winner.size,
    achievedTarget: Boolean(bestFit),
    alreadyUnderTarget: false,
    originalPages,
    resultPages,
    originalSize,
  };
}

module.exports = { compressToTarget, PROFILES };
