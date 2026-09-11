// handlers/media/download.js
// Infrastruktur download yt-dlp/ffmpeg: resolusi binary, cooldown user,
// antrian global, timeout, & cleanup file tmp. Dipisah dari handler media
// agar bisa diuji & dipakai ulang tanpa logika pengiriman WA.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { enqueue, getQueueStats } = require('../../utils/downloadQueue');
const { IS_WIN, resolveFfmpeg } = require('../../utils/ffmpeg');

// Resolusi path FFmpeg: WAJIB di dalam folder proyek (<root>/ffmpeg/bin), sejajar
// index.js. Tanpa fallback ke C:\ffmpeg/bin maupun PATH — lihat utils/ffmpeg.js.
const { ffmpeg: FFMPEG_PATH, ffprobe: FFPROBE_PATH } = resolveFfmpeg();
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(FFMPEG_PATH);
// Biar library lain yg spawn ffmpeg sendiri (mis. wa-sticker-formatter) pakai
// binary yg sama, set juga env global.
process.env.FFMPEG_PATH = FFMPEG_PATH;
process.env.FFPROBE_PATH = FFPROBE_PATH;

// Resolusi path yt-dlp: yt-dlp.exe (Windows) -> yt-dlp (Termux/Linux) -> PATH sistem
function resolveYtDlp() {
  const candidates = IS_WIN
    ? [path.join(__dirname, '..', '..', 'yt-dlp.exe')]
    : [path.join(__dirname, '..', '..', 'yt-dlp')];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'yt-dlp'; // fallback PATH (Termux: pkg install yt-dlp)
}

// Flag --ffmpeg-location untuk yt-dlp. ffmpeg tidak di PATH (root-only), jadi
// selalu perlu di semua platform; yn-dlp butuh direktori yang berisi binary.
function getFfmpegParam() {
  return ['--ffmpeg-location', path.dirname(resolveFfmpeg().ffmpeg)];
}

// ─── DIREKTORI & KONSTANTA TMP ────────────────────────────
// Direktori khusus file sementara download — tidak lagi bercampur dengan
// root proyek (yang berisi node_modules).
const TMP_DIR = path.join(__dirname, '..', '..', '.tmp');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) { /* abaikan */ }

// Cooldown download per user (mencegah spam !play / !tt)
const DOWNLOAD_COOLDOWN_MS = 30 * 1000;
const downloadCooldowns = new Map(); // userJid → timestamp

// Batas ukuran file download via yt-dlp (agar RAM & kuota aman)
const MAX_VIDEO_SIZE = '50M';
const MAX_AUDIO_SIZE = '20M';

// Matikan proses beserta seluruh turunannya (yt-dlp sering spawn ffmpeg sebagai anak).
function killProcessTree(child) {
  if (!child || child.pid === undefined) return;
  try {
    if (IS_WIN) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // detached: true membuat proses jadi pemimpin grup → kill grup sekaligus
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) { /* abaikan */ } }
    }
  } catch (e) { /* abaikan */ }
}

// Jalankan perintah child_process dengan timeout; kill pohon proses bila hang.
// Menggunakan spawn tanpa shell (shell:false) → aman di Windows cmd maupun Termux:
// karakter khusus (^, &, ?, %(ext)s) tidak lagi dimanipulasi oleh shell.
function execWithTimeout(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      killProcessTree(child);
      reject(new Error('Timeout eksekusi download.'));
    }, timeoutMs);
    if (timer.unref) timer.unref();

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const err = new Error(`Perintah gagal (exit ${code}).`);
        err.code = code;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

// Sisa cooldown (detik) untuk user; 0 = bebas download
function isDownloadCooldown(userJid) {
  const last = downloadCooldowns.get(userJid) || 0;
  const remain = last + DOWNLOAD_COOLDOWN_MS - Date.now();
  return remain > 0 ? Math.ceil(remain / 1000) : 0;
}

function setDownloadCooldown(userJid) {
  downloadCooldowns.set(userJid, Date.now());
  if (downloadCooldowns.size > 200) {
    const now = Date.now();
    for (const [jid, t] of downloadCooldowns) {
      if (now - t > DOWNLOAD_COOLDOWN_MS) downloadCooldowns.delete(jid);
    }
  }
}

// Hapus file hasil download dengan prefix timestamp (sukses/error/timeout)
function cleanupTmpPrefix(timestamp) {
  try {
    const files = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(`tmp_dl_${timestamp}`));
    for (const f of files) {
      try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch (e) { /* abaikan */ }
    }
  } catch (e) { /* abaikan */ }
}

// Jalankan download lewat antrian global (1 download bersamaan).
// Menangani: cooldown user, info posisi antrian, timeout, cleanup file.
async function runQueuedDownload({ sock, msg, chatId, senderJid, label, bin, args, timestamp, resultHandler, retries = 0 }) {
  const remain = isDownloadCooldown(senderJid);
  if (remain > 0) {
    await sock.sendMessage(chatId, { text: `⏳ Sabar! Tunggu *${remain} detik* lagi sebelum download berikutnya.` }, { quoted: msg });
    return;
  }
  setDownloadCooldown(senderJid);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const { position, promise } = enqueue({
    userJid: senderJid,
    label,
    run: async () => {
      let lastErr;
      // Retry ringan untuk error transien (mis. TikTok rate-limit / anti-bot sporadis).
      // Timeout tidak di-retry (biarkan gagal cepat).
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          await execWithTimeout(bin, args, 180 * 1000);
          return;
        } catch (e) {
          lastErr = e;
          if (e.message.includes('Timeout') || attempt === retries) throw e;
          await sleep(1500);
        }
      }
      throw lastErr;
    },
  });

  if (position > 1) {
    const stats = getQueueStats();
    await sock.sendMessage(chatId, {
      text: `⏳ *${label}* masuk antrian download — posisi *ke-${position}* (${stats.waiting + 1} antrean). Kamu akan dikabari saat selesai.`,
    }, { quoted: msg });
  }

  try {
    await promise;
  } catch (err) {
    console.error('❌ Download gagal:', err.message, err.stderr ? `\n${err.stderr}` : '');
    cleanupTmpPrefix(timestamp);
    const pesan = err.message.includes('Timeout')
      ? '❌ Server terlalu lama memproses download. Coba lagi nanti.'
      : `❌ Gagal mengunduh media. Pastikan link valid / tidak di-private.`;
    await sock.sendMessage(chatId, { text: pesan }, { quoted: msg });
    return;
  }

  // Cari file hasil di direktori tmp khusus.
  // Fragment DASH (nama `.fNNN.ext`) = video+audio TIDAK berhasil di-merge (ffmpeg hilang) → tolak.
  const isFragment = (name) => /\.f\d+\./.test(name);
  const findFinal = () => {
    try {
      return fs.readdirSync(TMP_DIR).filter(f => f.startsWith(`tmp_dl_${timestamp}`) && !isFragment(f));
    } catch (e) { return []; }
  };

  let downloadedFile = null;
  // Beri waktu singkat untuk file final hasil merge yang baru saja selesai ditulis
  for (let i = 0; i < 10 && !downloadedFile; i++) {
    const finals = findFinal();
    if (finals.length > 0) downloadedFile = path.join(TMP_DIR, finals[0]);
    else if (i < 9) await new Promise(r => setTimeout(r, 300));
  }

  if (!downloadedFile) {
    let hasFragment = false;
    try { hasFragment = fs.readdirSync(TMP_DIR).some(f => f.startsWith(`tmp_dl_${timestamp}`)); } catch (e) { /* abaikan */ }
    cleanupTmpPrefix(timestamp);
    await sock.sendMessage(chatId, {
      text: hasFragment
        ? '❌ Gagal menggabungkan video & audio (FFmpeg tidak tersedia di server). Pasang FFmpeg lalu coba lagi.'
        : '❌ File hasil unduhan tidak ditemukan di server.'
    }, { quoted: msg });
    return;
  }

  try {
    await resultHandler(downloadedFile);
  } catch (sendErr) {
    console.error('❌ Gagal mengirim file ke WA:', sendErr);
  } finally {
    try { fs.unlinkSync(downloadedFile); } catch (e) { /* abaikan */ }
  }
}

module.exports = {
  IS_WIN,
  ffmpeg,
  TMP_DIR,
  resolveYtDlp,
  getFfmpegParam,
  killProcessTree,
  execWithTimeout,
  isDownloadCooldown,
  setDownloadCooldown,
  cleanupTmpPrefix,
  runQueuedDownload,
  MAX_VIDEO_SIZE,
  MAX_AUDIO_SIZE,
};