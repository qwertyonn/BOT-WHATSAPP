// ============================================================
// ACHIEVEMENT FISHIT
// Daftar achievement deklaratif. Tiap entri:
//   id      — key unik, disimpan di p.achievements[id] = timestamp
//   name    — judul achievement
//   desc    — deskripsi syarat
//   emoji   — ikon
//   check(p) — predicate terhadap data pemain FishIt (true = tercapai)
//   progress(p) — string progress ditampilkan di list (opsional)
//   reward  — Money yang diberikan sekali saat tercapai
// ============================================================

const ACHV = [];

function add(id, name, desc, emoji, check, reward, progress) {
  ACHV.push({ id, name, desc, emoji, check, reward, progress });
}

// progress helper
const n = v => String(v);
const maxWeight = p => {
  let m = 0;
  for (const d of Object.values(p.fishdex || {})) if (d.maxWeight > m) m = d.maxWeight;
  return m;
};
const maxTier = p => {
  let t = 0;
  for (const d of Object.values(p.fishdex || {})) if (d.tier > t) t = d.tier;
  return t;
};
const fishdexCount = p => Object.keys(p.fishdex || {}).length;

// ─── TANGKAPAN ────────────────────────────────────────────
add('catch_10', 'Pengalaman Pertama',  'Tangkap 10 ikan',         25, p => (p.totalCaught || 0) >= 10,  100000, p => n(p.totalCaught || 0) + '/10');
add('catch_100', 'Nelayan Rajin',      'Tangkap 100 ikan',         39, p => (p.totalCaught || 0) >= 100, 1000000, p => n(p.totalCaught || 0) + '/100');
add('catch_1000', 'Raja Laut',         'Tangkap 1.000 ikan',       111, p => (p.totalCaught || 0) >= 1000, 10000000, p => n(p.totalCaught || 0) + '/1000');

// ─── FISHDEX ──────────────────────────────────────────────
add('dex_10', 'Kolektor Amatir',      'Catat 10 jenis ikan di Fishdex',   45, p => fishdexCount(p) >= 10,  200000, p => n(fishdexCount(p)) + '/10');
add('dex_20', 'Kolektor Ahli',        'Catat 20 jenis ikan di Fishdex',   47, p => fishdexCount(p) >= 20,  1000000, p => n(fishdexCount(p)) + '/20');
add('dex_30', 'Kolektor Master',      'Catat 30 jenis ikan di Fishdex',   49, p => fishdexCount(p) >= 30,  3000000, p => n(fishdexCount(p)) + '/30');
add('dex_complete', 'Ensiklopedia Ikan', 'Catat SEMUA jenis ikan di Fishdex', 52, p => fishdexCount(p) >= 53, 25000000, p => n(fishdexCount(p)) + '/53');

// ─── TIER LANGKA ──────────────────────────────────────────
add('tier5',  'Pemburu Legenda',   'Tangkap ikan tier 5+ (Legendary)',  31, p => maxTier(p) >= 5,  500000, p => 'Tier terbanyak: ' + (maxTier(p) || 0));
add('tier8',  'Penakluk Ilahi',    'Tangkap ikan tier 8+ (Divine)',      33, p => maxTier(p) >= 8,  5000000, p => 'Tier terbanyak: ' + (maxTier(p) || 0));
add('tier10', 'Penguasa Alam Semesta', 'Tangkap ikan tier 10+ (Celestial)', 36, p => maxTier(p) >= 10, 25000000, p => 'Tier terbanyak: ' + (maxTier(p) || 0));

// ─── BOBOT ────────────────────────────────────────────────
add('weight_100',   'Pemecah Rekor',  'Tangkap ikan > 100 kg',      78, p => maxWeight(p) >= 100,   300000, p => 'Rekor: ' + n(maxWeight(p)));
add('weight_1000',  'Penangkap Raksasa', 'Tangkap ikan > 1.000 kg', 80, p => maxWeight(p) >= 1000,  2000000, p => 'Rekor: ' + n(maxWeight(p)));
add('weight_10000', 'Penghuni Jurang', 'Tangkap ikan > 10.000 kg',  82, p => maxWeight(p) >= 10000, 10000000, p => 'Rekor: ' + n(maxWeight(p)));

module.exports = { FISHIT_ACHIEVEMENTS: ACHV };