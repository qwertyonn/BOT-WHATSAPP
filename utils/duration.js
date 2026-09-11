// utils/duration.js
// Parsing durasi terpadu di seluruh bot. Skema satuan:
//   s  → detik   (1.000 ms)
//   m  → menit   (60.000 ms)
//   h  → jam     (3.600.000 ms)
//   d  → hari    (86.400.000 ms)
//   w  → minggu  (7 hari)
//   mo → bulan   (30 hari)
// Return { ms, label } bila valid, null bila tidak ada / format salah.
const DURATION_RE = /(?:^|\s)(\d+)(mo|s|m|h|d|w)\b/i;
const DURATION_UNITS = {
  s: { ms: 1000, label: 'detik' },
  m: { ms: 60 * 1000, label: 'menit' },
  h: { ms: 60 * 60 * 1000, label: 'jam' },
  d: { ms: 24 * 60 * 60 * 1000, label: 'hari' },
  w: { ms: 7 * 24 * 60 * 60 * 1000, label: 'minggu' },
  mo: { ms: 30 * 24 * 60 * 60 * 1000, label: 'bulan' },
};

// Ambil durasi dari teks bebas (body perintah): "!ban @a 10m" → 10 menit.
// Wajib ada spasi/awal sebelum angka agar "-5s" / "@628...10s" tak termatch.
function parseDuration(raw) {
  const m = DURATION_RE.exec(String(raw || ''));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = DURATION_UNITS[m[2].toLowerCase()];
  if (!(Number.isInteger(n) && n > 0) || !unit) return null;
  return { ms: n * unit.ms, label: `${n} ${unit.label}` };
}

module.exports = { parseDuration, DURATION_UNITS, DURATION_RE };