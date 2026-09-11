// utils/ffmpeg.js
// Resolusi path ffmpeg/ffprobe — WAJIB di dalam folder proyek (root-only),
// sejajar index.js. Tidak ada fallback ke C:\ffmpeg/bin maupun PATH.
// Layout yang ketemu (urutan prioritas):
//   1. <root>/ffmpeg/bin/<name>[.exe]   (layout utama, seperti C:\ffmpeg\bin)
//   2. <root>/<name>[.exe]              (flat, sejajar index.js)
//   3. <root>/ffmpeg/<name>[.exe]       (flat di dalam folder ffmpeg)
// Bila tidak ketemu, tetap kembalikan kandidat utama agar spawn gagal dengan
// error yang jelas (dan peringatan startup menunjuk ke lokasi yang benar).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..'); // utils -> folder proyek (index.js)
const IS_WIN = process.platform === 'win32';

function findBinary(name) {
  const exe = IS_WIN ? `${name}.exe` : name;
  const candidates = [
    path.join(ROOT, 'ffmpeg', 'bin', exe),
    path.join(ROOT, exe),
    path.join(ROOT, 'ffmpeg', exe),
  ];
  return candidates.find(fs.existsSync) || candidates[0];
}

function resolveFfmpeg() {
  return { ffmpeg: findBinary('ffmpeg'), ffprobe: findBinary('ffprobe') };
}

module.exports = { IS_WIN, ROOT, findBinary, resolveFfmpeg };