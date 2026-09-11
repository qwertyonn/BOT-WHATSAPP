// handlers/media/playerRenderer.js
// Render card player musik (gaya aplikasi player) jadi gambar PNG via Html → screenshot.
// Pakai puppeteer (Chromium headless). Launch sekali, di-cache, auto-close saat idle.
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'player.html');

// Browser singleton: launch sekali, reuse. Close saat idle > 60s untuk hemat RAM.
let browser = null;
let idleTimer = null;

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (browser) {
      try { await browser.close(); } catch (e) { /* abaikan */ }
      browser = null;
    }
  }, 60 * 1000);
  if (idleTimer.unref) idleTimer.unref();
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const puppeteer = require('puppeteer');
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return browser;
}

// Potong lirik agar muat di card (max ~14 baris). Pertahankan bait pertama.
function trimLyrics(text, maxLines = 14) {
  if (!text) return 'Lyrics not available';
  const normalized = text.replace(/\r/g, '').split('\n');
  const lines = normalized.map(l => l.trim());
  // Hapus baris kosong beruntun di awal + leading heading "[Verse 1]"
  while (lines.length && lines[0] === '') lines.shift();
  const content = lines.filter(Boolean);
  let kept = content.slice(0, maxLines);
  if (content.length > maxLines) kept = kept.concat(['. . .']);
  return kept.join('\n');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render card → PNG Buffer. Return null bila gagal (caller fallback ke teks).
async function renderPlayerCard({ title, artist, duration, coverBase64, lyrics }) {
  try {
    let template;
    try {
      template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    } catch (e) {
      return null;
    }

    const hasCover = Boolean(coverBase64);
    const html = template
      .replace('{{COVER_SRC}}', hasCover ? `data:image/jpeg;base64,${coverBase64}` : '')
      .replace('{{COVER_PH}}', hasCover ? '' : '🎵')
      .replace('{{TITLE}}', escapeHtml(title || 'Unknown'))
      .replace('{{ARTIST}}', escapeHtml(artist || 'Unknown Artist'))
      .replace(/\{\{DURATION\}\}/g, escapeHtml(duration || '0:00'))
      .replace('{{LYRICS}}', escapeHtml(trimLyrics(lyrics)));

    const page = await (await getBrowser()).newPage();
    await page.setViewport({ width: 512, height: 800, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // Tunggu gambar cover termuat (bila ada) sebelum screenshot
    if (hasCover) {
      try { await page.waitForFunction(() => { const i = document.querySelector('.thumb img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 8000 }); } catch (e) { /* lanjut walau gagal */ }
    }
    // Puppeteer v20+ mengembalikan Uint8Array (bukan Buffer) dari screenshot.
    // Baileys hanya menerima Buffer asli → konversi eksplisit.
    const buffer = Buffer.from(await page.screenshot({ type: 'png' }));
    await page.close();
    scheduleIdleClose();
    return buffer;
  } catch (e) {
    console.error('❌ Player render gagal:', e.message);
    try { if (browser) { await browser.close(); } } catch (e2) { /* abaikan */ }
    browser = null;
    return null;
  }
}

module.exports = { renderPlayerCard };

// Self-check (demo): render card contoh → pastikan buffer PNG valid.
if (require.main === module) {
  (async () => {
    const buf = await renderPlayerCard({
      title: 'Example Song Title',
      artist: 'Demo Artist',
      duration: '3:45',
      lyrics: 'Line one\nLine two\nLine three\nAnd more lyrics here...',
    });
    const ok = buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
    if (ok) console.log('OK: render="PNG"', buf.length, 'bytes');
    else console.log('FAIL', buf && buf.length);
    process.exit(ok ? 0 : 1);
  })();
}
