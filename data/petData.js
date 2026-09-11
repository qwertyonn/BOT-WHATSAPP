// data/petData.js
// Data statis fitur Pet: spesies (5 tipe), 4 stage evolusi per spesies,
// base stat, skill flavor, dan syarat evolusi per stage.
// Syarat evolusi = level + pernah makan ikan FishIt tier ≥ fishTier
// (konsumtif per evolusi — dipicu lewat pet.evoReqMet di engine).

// Pengali stat per stage (stage 1 = basis)
const STAGE_MULT = [1, 1.35, 1.7, 2.1];

// Syarat evolusi per stage saat ini (index = stage saat ini, base = null):
// { level, fishTier } — level minimum + tier ikan yang harus dimakan
// sebelum naik ke stage berikutnya.
const EVO_REQS = [
  null,                        // stage 1 (basis)
  { level: 10, fishTier: 6 },  // → stage 2
  { level: 20, fishTier: 10 }, // → stage 3
  { level: 30, fishTier: 12 }, // → stage 4 (mega)
];

const PET_SPECIES = {
  api: {
    id: 'api',
    name: 'Api',
    emoji: '🔥',
    stages: ['Anakan Api', 'Serigala Api', 'Naga Api', 'Fenix Api'],
    base: { hp: 80, atk: 16, def: 7, spd: 10 },
    skill: { name: 'Semburan Api', desc: 'Serangan kuat berpeluang membakar' },
  },
  air: {
    id: 'air',
    name: 'Air',
    emoji: '💧',
    stages: ['Tetes Air', 'Paus Biru', 'Leviathan', 'Naga Laut'],
    base: { hp: 100, atk: 12, def: 11, spd: 7 },
    skill: { name: 'Tornado Air', desc: 'Menghantam musuh dengan pusaran air' },
  },
  dedaunan: {
    id: 'dedaunan',
    name: 'Dedaunan',
    emoji: '🌿',
    stages: ['Tunas', 'Raksasa Rimba', 'Ent Purba', 'Kaisar Hutan'],
    base: { hp: 90, atk: 13, def: 12, spd: 6 },
    skill: { name: 'Tumbuh Subur', desc: 'Memulihkan sebagian HP' },
  },
  kilat: {
    id: 'kilat',
    name: 'Kilat',
    emoji: '⚡',
    stages: ['Spercik Listrik', 'Harimau Listrik', 'Naga Petir', 'Dewa Guntur'],
    base: { hp: 75, atk: 15, def: 6, spd: 14 },
    skill: { name: 'Petir Fang', desc: 'Serangan kilat cepat dengan kritikal tinggi' },
  },
  biasa: {
    id: 'biasa',
    name: 'Biasa',
    emoji: '🐾',
    stages: ['Anak Kucing', 'Kucing Garong', 'Macan Putih', 'Raja Sabana'],
    base: { hp: 95, atk: 14, def: 9, spd: 9 },
    skill: { name: 'Cakar Tajam', desc: 'Serangan seimbang tanpa kelemahan' },
  },
};

const SPECIES_IDS = Object.keys(PET_SPECIES);

// Resolve species by id (tahan alias lowercase); fallback null
function resolveSpecies(id) {
  if (!id) return null;
  const key = String(id).toLowerCase();
  return PET_SPECIES[key] || null;
}

// Nama stage ke-i (1-based) dari sebuah pet
function getStageName(pet) {
  const sp = PET_SPECIES[pet.species];
  if (!sp) return `Stage ${pet.stage}`;
  const idx = Math.min(pet.stage, sp.stages.length) - 1;
  return sp.stages[idx];
}

// Syarat evolusi untuk stage saat ini (null bila sudah max)
function getEvoReq(stage) {
  return EVO_REQS[stage] || null;
}

// Ambang tier ikan yang harus dimakan sebelum evolusi dari stage ini
// (null saat sudah max)
function nextFishTierRequirement(stage) {
  const req = getEvoReq(stage);
  return req ? req.fishTier : null;
}

module.exports = {
  STAGE_MULT,
  EVO_REQS,
  PET_SPECIES,
  SPECIES_IDS,
  resolveSpecies,
  getStageName,
  getEvoReq,
  nextFishTierRequirement,
};