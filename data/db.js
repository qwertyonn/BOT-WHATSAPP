// ============================================================
// UNIFIED DATABASE - Menyimpan data kedua game
// ============================================================
const fs   = require('fs');
const path = require('path');
const { resolveJid, resolveNum } = require('../utils/jid');

// Resolusi JID user ke key kanonik nomor polos (alias LID->HP diterapkan;
// grup/broadcast dibiarkan)
function normJid(jid) { return resolveJid(jid); }

const DB_PATH    = process.env.BOT_DB_PATH ? path.resolve(process.env.BOT_DB_PATH) : path.join(__dirname, '..', 'state', 'database.json');
const DB_TMP     = DB_PATH + '.tmp';
const BACKUP_DIR = process.env.BOT_BACKUP_DIR ? path.resolve(process.env.BOT_BACKUP_DIR) : path.join(__dirname, '..', 'backups');

const MAX_BACKUPS         = 3;
const BACKUP_INTERVAL_MS  = 60 * 60 * 1000; // tiap 1 jam
const FLUSH_DEBOUNCE_MS   = 300;            // debounce penulisan

const DEFAULT_DB = {
  // Pokemon game
  pokemonPlayers: {},
  battles:        {},
  wildSpawns:     {},
  wildBattles:    {},
  // Fishing game
  fishingPlayers: {},
  // RPG game
  rpgPlayers:     {},
  rpgDuels:       {},
  rpgRaids:       {},
  // Pet game
  petPlayers:     {},
  // Gacha game
  gachaStats:     {},
  // Blackjack stats per grup (key grup -> jid pemain -> { loss })
  bjStats:        {},
  // Ban system
  bannedUsers:    {},
  // Ban lokal per grup (key grup -> jid pemain -> info ban)
  groupBans:      {},
  // Togel game
  togelRounds:    {},
  togelStats:     {},
  togelHistory:   [],
  // Mahjong game stats
  mahjongStats:   {},
  // Global Economy
  globalMoney:    {},
  // Bank & Rob System
  bankData:       {},
  robStats:       {},
};

// ─── STATE DI MEMORI (single source of truth) ────────────
// Semua fungsi membaca/menulis cache yang sama, sehingga tidak ada
// "lost update" saat handler async berjalan bersamaan.
let cache       = null;
let dirty       = false;
let flushTimer  = null;
let backupTimer = null;

function ensureCollections(data) {
  if (!data.pokemonPlayers) data.pokemonPlayers = {};
  if (!data.battles)        data.battles        = {};
  if (!data.wildSpawns)     data.wildSpawns     = {};
  if (!data.wildBattles)    data.wildBattles    = {};
  if (!data.fishingPlayers) data.fishingPlayers = {};
  if (!data.rpgPlayers)     data.rpgPlayers     = {};
  if (!data.rpgDuels)       data.rpgDuels       = {};
  if (!data.rpgRaids)       data.rpgRaids       = {};
  if (!data.petPlayers)     data.petPlayers     = {};
  if (!data.gachaStats)     data.gachaStats     = {};
  if (!data.bjStats)        data.bjStats        = {};
  if (!data.bannedUsers)    data.bannedUsers    = {};
  if (!data.groupBans)      data.groupBans      = {};
  if (!data.togelRounds)    data.togelRounds    = {};
  if (!data.togelStats)     data.togelStats     = {};
  if (!data.togelHistory)   data.togelHistory   = [];
  if (!data.mahjongStats)   data.mahjongStats   = {};
  if (!data.globalMoney)    data.globalMoney    = {};
  if (!data.bankData)       data.bankData       = {};
  if (!data.robStats)       data.robStats       = {};
  return data;
}

// Baca file dari disk (hanya sekali saat module init)
function loadFromDisk() {
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    let raw = fs.readFileSync(DB_PATH, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // buang BOM
    const data = JSON.parse(raw);
    return ensureCollections(data);
  } catch (e) {
    // File korup → simpan salinannya dulu, jangan timpa diam-diam
    try {
      const corruptPath = path.join(BACKUP_DIR, `corrupt-${Date.now()}.json`);
      fs.copyFileSync(DB_PATH, corruptPath);
      console.error('⚠️ database.json korup, disalin ke backup:', corruptPath);
    } catch (copyErr) { /* abaikan */ }
    return null;
  }
}

// Tulis atomik: file temp dulu, lalu rename (anti file setengah jadi)
function atomicWrite() {
  fs.writeFileSync(DB_TMP, JSON.stringify(cache, null, 2));
  fs.renameSync(DB_TMP, DB_PATH);
}

// Flush segera bila ada perubahan (dipakai saat shutdown & paksa simpan)
function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!dirty) return;
  dirty = false;
  atomicWrite();
}

function loadDB() {
  return cache;
}

function saveDB() {
  dirty = true;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNow, FLUSH_DEBOUNCE_MS);
  if (flushTimer.unref) flushTimer.unref();
}

// Backup berkala: salin state, sisakan MAX_BACKUPS terakhir
function takeBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    flushNow(); // pastikan file di disk = state terbaru
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest  = path.join(BACKUP_DIR, `database-${stamp}.json`);
    fs.copyFileSync(DB_PATH, dest);
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('database-') && f.endsWith('.json'))
      .sort();
    while (files.length > MAX_BACKUPS) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (e) { /* abaikan */ }
    }
    console.log(`💾 Backup database tersimpan: ${dest}`);
  } catch (err) {
    console.error('❌ Gagal backup database:', err.message);
  }
}

function initDB() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  cache = loadFromDisk();
  if (!cache) {
    cache = { ...DEFAULT_DB };
    ensureCollections(cache);
    atomicWrite(); // buat file kalau belum ada
  }

  // Backup awal menangkap kondisi saat bot start
  takeBackup();

  backupTimer = setInterval(takeBackup, BACKUP_INTERVAL_MS);
  if (backupTimer.unref) backupTimer.unref();

  // Flush + backup terakhir saat bot dimatikan (Ctrl+C / kill)
  const shutdown = () => {
    try { flushNow(); } catch (e) { /* abaikan */ }
    try { takeBackup(); } catch (e) { /* abaikan */ }
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
initDB();

// ─── AUTO-REGISTRASI (SEMUA GAME SEKALIGUS) ──────────────
// User terdaftar otomatis di FishIt + Pokemon + RPG saat pertama
// kali memakai command bot apa pun. Nama memakai nickname WhatsApp.
function sanitizeName(name, fallbackJid) {
  const clean = String(name || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 20);
  if (clean) return clean;
  return `Pemain${fallbackJid ? fallbackJid.split('@')[0] : ''}`;
}

function autoRegisterUser(jid, name) {
  if (!jid) return false;
  jid = normJid(jid);
  const db   = loadDB();
  const nm   = sanitizeName(name, jid);
  const num  = resolveNum(jid);
  let anyNew = false;

  if (!db.fishingPlayers[jid]) {
    db.fishingPlayers[jid] = {
      jid, name: nm,
      rod: 'rod_1',
      bait: { bait_1: 10 },
      inventory: {},
      fishdex: {},
      totalCaught: 0,
      rarityRecord: { tier: 0, fishName: '', weight: 0 },
      achievements: {},
      econV2: true, // pemain baru langsung ekonomi v2 (skip migrasi rombak FishIt)
      createdAt: Date.now(),
      lastFished: 0,
      fishingCooldown: 0,
      lastClaim: 0,
    };
    db.globalMoney[jid] = (db.globalMoney[jid] || 0) + 500;
    anyNew = true;
  }

  if (!db.rpgPlayers[jid]) {
    db.rpgPlayers[jid] = {
      userId: jid, name: nm,
      exp: 0, stamina: 100, currentHp: 80,
      wood: 0, stone: 0, iron: 0,
      inventory: {}, craftedItems: {},
      equippedWeapon: null, equippedArmor: null,
      equippedAxe: null, equippedPickaxe: null,
      wins: 0, losses: 0, monstersKilled: 0,
      lastStaminaRegen: Date.now(), lastClaim: 0, createdAt: Date.now(),
    };
    db.globalMoney[jid] = (db.globalMoney[jid] || 0) + 200;
    anyNew = true;
  }

  if (!db.pokemonPlayers[num]) {
    db.pokemonPlayers[num] = {
      id: num, name: nm, level: 1, exp: 0,
      pokeballs: 10, wins: 0, losses: 0, collection: [],
      activeTeam: [], lastCatch: null, lastBattle: null,
      lastSpawn: null, lastClaim: 0, joinedAt: Date.now(), food: 0,
      jid,
    };
    db.globalMoney[jid] = (db.globalMoney[jid] || 0) + 100;
    anyNew = true;
  }

  if (anyNew) saveDB(db);
  return anyNew;
}

// ─── POKEMON PLAYERS ─────────────────────────────────────
function isPokemonRegistered(userId) {
  return !!loadDB().pokemonPlayers[userId];
}

function getPokemonPlayer(userId) {
  return loadDB().pokemonPlayers[userId] || null;
}

function savePokemonPlayer(userId, data) {
  const db = loadDB();
  db.pokemonPlayers[userId] = { ...db.pokemonPlayers[userId], ...data };
  saveDB(db);
}

function getPokemonLeaderboard() {
  return Object.values(loadDB().pokemonPlayers)
    .sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : b.exp - a.exp)
    .slice(0, 10);
}

// ─── WILD SPAWN / BATTLE ─────────────────────────────────
function getWildSpawn(groupId)             { return loadDB().wildSpawns[groupId] || null; }
function setWildSpawn(groupId, pokemon)    { const db = loadDB(); db.wildSpawns[groupId] = pokemon; saveDB(db); }
function clearWildSpawn(groupId)           { const db = loadDB(); delete db.wildSpawns[groupId]; saveDB(db); }
function getWildBattle(userId)             { return loadDB().wildBattles[userId] || null; }
function setWildBattle(userId, battle)     { const db = loadDB(); db.wildBattles[userId] = battle; saveDB(db); }
function clearWildBattle(userId)           { const db = loadDB(); delete db.wildBattles[userId]; saveDB(db); }

// ─── PVP BATTLES ─────────────────────────────────────────
function getBattle(battleId)               { return loadDB().battles[battleId] || null; }
function setBattle(battleId, battle)       { const db = loadDB(); db.battles[battleId] = battle; saveDB(db); }
function clearBattle(battleId)             { const db = loadDB(); delete db.battles[battleId]; saveDB(db); }

// ─── FISHING PLAYERS ─────────────────────────────────────
function getFishingPlayer(jid) {
  return loadDB().fishingPlayers[normJid(jid)] || null;
}

function updateFishingPlayer(jid, data) {
  jid = normJid(jid);
  const db = loadDB();
  if (!db.fishingPlayers[jid]) return false;
  db.fishingPlayers[jid] = { ...db.fishingPlayers[jid], ...data };
  saveDB(db);
  return true;
}

function deleteFishingPlayer(jid) {
  jid = normJid(jid);
  const db = loadDB();
  if (!db.fishingPlayers[jid]) return false;
  delete db.fishingPlayers[jid];
  saveDB(db);
  return true;
}

function getAllFishingPlayers() {
  return Object.values(loadDB().fishingPlayers);
}

function getTopGlobalMoney(limit = 10) {
  const db = loadDB();
  const rows = [];
  for (const [jid, money] of Object.entries(db.globalMoney || {})) {
    if (!money || money <= 0) continue;
    const num = resolveNum(jid);
    const fp = db.fishingPlayers[jid];
    const rp = db.rpgPlayers[jid];
    let name = null;
    if (fp) name = fp.name;
    else if (rp) name = rp.name;
    else {
      const pp = db.pokemonPlayers[num];
      if (pp) name = pp.name;
    }
    rows.push({ jid, money, name: name || num });
  }
  return rows.sort((a, b) => b.money - a.money).slice(0, limit);
}

function getTopRarity(limit = 10) {
  return getAllFishingPlayers()
    .filter(p => p.rarityRecord.tier > 0)
    .sort((a, b) => {
      if (b.rarityRecord.tier !== a.rarityRecord.tier) return b.rarityRecord.tier - a.rarityRecord.tier;
      return b.rarityRecord.weight - a.rarityRecord.weight;
    })
    .slice(0, limit);
}

function deletePokemonPlayer(userId) {
  const db = loadDB();
  if (!db.pokemonPlayers[userId]) return false;
  delete db.pokemonPlayers[userId];
  saveDB(db);
  return true;
}

// ─── RPG PLAYERS ─────────────────────────────────────────
function getRpgPlayer(userId) {
  return loadDB().rpgPlayers[normJid(userId)] || null;
}

function updateRpgPlayer(userId, data) {
  userId = normJid(userId);
  const db = loadDB();
  if (!db.rpgPlayers[userId]) return false;
  db.rpgPlayers[userId] = { ...db.rpgPlayers[userId], ...data };
  saveDB(db);
  return true;
}

function deleteRpgPlayer(userId) {
  userId = normJid(userId);
  const db = loadDB();
  if (!db.rpgPlayers[userId]) return false;
  delete db.rpgPlayers[userId];
  saveDB(db);
  return true;
}

function getAllRpgPlayers() {
  return Object.values(loadDB().rpgPlayers);
}

// ─── RPG DUELS ───────────────────────────────────────────
function getRpgDuel(groupId)          { return loadDB().rpgDuels[groupId] || null; }
function setRpgDuel(groupId, duel)    {
  const db = loadDB();
  if (duel) {
    if (duel.challenger) duel = { ...duel, challenger: normJid(duel.challenger) };
    if (duel.opponent)   duel = { ...duel, opponent:   normJid(duel.opponent) };
  }
  db.rpgDuels[groupId] = duel;
  saveDB(db);
}
function clearRpgDuel(groupId)        { const db = loadDB(); delete db.rpgDuels[groupId]; saveDB(db); }

// ─── RPG RAIDS ───────────────────────────────────────────
function getRpgRaid(groupId)   { return loadDB().rpgRaids[groupId] || null; }
function setRpgRaid(groupId, raid) {
  const db = loadDB();
  db.rpgRaids[groupId] = raid;
  saveDB(db);
  return true;
}
function clearRpgRaid(groupId) { const db = loadDB(); delete db.rpgRaids[groupId]; saveDB(db); }

// ─── PET PLAYERS ──────────────────────────────────────────
function createPetPlayer(jid, name, species) {
  jid = normJid(jid);
  const db = loadDB();
  if (db.petPlayers[jid]) return null;
  const pet = {
    jid,
    ownerName: name,
    species,
    nickname: '',
    level: 1,
    exp: 0,
    stage: 1,
    evoReqMet: false,
    wins: 0,
    losses: 0,
    lastFed: 0,
    createdAt: Date.now(),
  };
  db.petPlayers[jid] = pet;
  saveDB(db);
  return pet;
}

function getPetPlayer(jid) {
  return loadDB().petPlayers[normJid(jid)] || null;
}

function updatePetPlayer(jid, data) {
  jid = normJid(jid);
  const db = loadDB();
  if (!db.petPlayers[jid]) return false;
  db.petPlayers[jid] = { ...db.petPlayers[jid], ...data };
  saveDB(db);
  return true;
}

function deletePetPlayer(jid) {
  jid = normJid(jid);
  const db = loadDB();
  if (!db.petPlayers[jid]) return false;
  delete db.petPlayers[jid];
  saveDB(db);
  return true;
}

function getAllPetPlayers() {
  return Object.values(loadDB().petPlayers);
}

function getPetLeaderboard(limit = 10) {
  return getAllPetPlayers()
    .sort((a, b) => b.level !== a.level ? b.level - a.level : b.wins - a.wins)
    .slice(0, limit);
}

// ─── GACHA STATS ───────────────────────────────────────────
function getGachaStats(jid) {
  const db = loadDB();
  if (!db.gachaStats) db.gachaStats = {};
  return db.gachaStats[normJid(jid)] || null;
}

function updateGachaStats(jid, data) {
  jid = normJid(jid);
  const db = loadDB();
  if (!db.gachaStats) db.gachaStats = {};
  db.gachaStats[jid] = { ...(db.gachaStats[jid] || {}), ...data };
  saveDB(db);
  return true;
}

function resetGachaStats(jid) {
  jid = normJid(jid);
  const db = loadDB();
  if (!db.gachaStats) db.gachaStats = {};
  delete db.gachaStats[jid];
  saveDB(db);
  return true;
}

// ─── BLACKJACK STATS ──────────────────────────────────────
// Key grup -> jid pemain -> { loss } (total uang hilang saat kalah).
function recordBjLoss(groupId, jid, amount) {
  if (!groupId || !jid || amount <= 0) return false;
  const db = loadDB();
  if (!db.bjStats) db.bjStats = {};
  const g = db.bjStats[groupId] = db.bjStats[groupId] || {};
  const key = normJid(jid);
  g[key] = { loss: (g[key] && g[key].loss || 0) + amount };
  saveDB(db);
  return true;
}

function getBjTop(groupId, limit = 5) {
  const db = loadDB();
  const stats = db.bjStats || {};
  const agg = {};
  const groups = groupId ? [groupId] : Object.keys(stats);
  for (const g of groups) {
    const m = stats[g] || {};
    for (const [jid, st] of Object.entries(m)) {
      if (!st || st.loss <= 0) continue;
      agg[jid] = { jid, loss: (agg[jid] ? agg[jid].loss : 0) + st.loss };
    }
  }
  const rows = Object.values(agg).map(({ jid, loss }) => {
    const fp = db.fishingPlayers[jid];
    const rp = db.rpgPlayers[jid];
    let name = fp ? fp.name : rp ? rp.name : (db.pokemonPlayers[resolveNum(jid)] || {}).name;
    return { jid, loss, name: name || resolveNum(jid) };
  });
  return rows.sort((a, b) => b.loss - a.loss).slice(0, limit);
}

// ─── BAN SYSTEM ──────────────────────────────────────────
// Ban bisa permanen (tanpa expiresAt) atau berdurasi (s/d/j/h — lihat
// parseBanDuration di ownerCommands). Expiry dicek secara lazy tiap kali
// ban diperiksa/dilist, jadi tidak butuh timer yang tak survive restart bot.
function hasBanExpired(rec) {
  return !!rec && typeof rec.expiresAt === 'number' && Date.now() > rec.expiresAt;
}

function makeBanRecord(bannedBy, expiresAt) {
  const rec = { bannedAt: Date.now(), bannedBy: bannedBy ? normJid(bannedBy) : null };
  if (Number.isFinite(expiresAt)) rec.expiresAt = expiresAt;
  return rec;
}

function banUser(userId, bannedBy, expiresAt) {
  const db = loadDB();
  db.bannedUsers[normJid(userId)] = makeBanRecord(bannedBy, expiresAt);
  saveDB(db);
  return true;
}

function unbanUser(userId) {
  userId = normJid(userId);
  const db = loadDB();
  if (!db.bannedUsers[userId]) return false;
  delete db.bannedUsers[userId];
  saveDB(db);
  return true;
}

function isUserBanned(userId) {
  const db = loadDB();
  const key = normJid(userId);
  const rec = db.bannedUsers[key];
  if (!rec) return false;
  if (hasBanExpired(rec)) {
    delete db.bannedUsers[key];
    saveDB(db);
    return false;
  }
  return true;
}

function getBannedList() {
  const db = loadDB();
  const list = db.bannedUsers;
  let changed = false;
  for (const [key, rec] of Object.entries(list)) {
    if (hasBanExpired(rec)) { delete list[key]; changed = true; }
  }
  if (changed) saveDB(db);
  return list;
}

// ─── BAN LOKAL PER GRUP (admin grup ban member di grupnya sendiri) ───
function banUserInGroup(groupId, userId, bannedBy, expiresAt) {
  const db = loadDB();
  if (!db.groupBans[groupId]) db.groupBans[groupId] = {};
  db.groupBans[groupId][normJid(userId)] = makeBanRecord(bannedBy, expiresAt);
  saveDB(db);
  return true;
}

function unbanUserInGroup(groupId, userId) {
  const db = loadDB();
  const list = db.groupBans[groupId];
  if (!list) return false;
  const key = normJid(userId);
  if (!list[key]) return false;
  delete list[key];
  if (Object.keys(list).length === 0) delete db.groupBans[groupId];
  saveDB(db);
  return true;
}

function isUserBannedInGroup(groupId, userId) {
  const db = loadDB();
  const list = db.groupBans[groupId];
  if (!list) return false;
  const key = normJid(userId);
  const rec = list[key];
  if (!rec) return false;
  if (hasBanExpired(rec)) {
    delete list[key];
    if (Object.keys(list).length === 0) delete db.groupBans[groupId];
    saveDB(db);
    return false;
  }
  return true;
}

function getGroupBannedList(groupId) {
  const db = loadDB();
  const list = db.groupBans[groupId];
  if (!list) return {};
  let changed = false;
  for (const [key, rec] of Object.entries(list)) {
    if (hasBanExpired(rec)) { delete list[key]; changed = true; }
  }
  if (changed) {
    if (Object.keys(list).length === 0) delete db.groupBans[groupId];
    saveDB(db);
  }
  return db.groupBans[groupId] || {};
}

// ─── EKONOMI GLOBAL (SATU MATA UANG: MONEY) ─────────────
// Semua game (FishIt, Pokemon, RPG, Casino/Blackjack) memakai satu saldo Money.

function getUserMoney(jid) {
  const db = loadDB();
  if (!db.globalMoney) db.globalMoney = {};
  return db.globalMoney[normJid(jid)] || 0;
}

function addMoney(jid, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const db = loadDB();
  if (!db.globalMoney) db.globalMoney = {};
  db.globalMoney[normJid(jid)] = getUserMoney(jid) + amount;
  saveDB(db);
  return true;
}

function deductMoney(jid, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const db = loadDB();
  if (!db.globalMoney) db.globalMoney = {};
  const current = getUserMoney(jid);
  if (current < amount) return false;
  db.globalMoney[normJid(jid)] = current - amount;
  saveDB(db);
  return true;
}

// Nolkan saldo money. Reset "set 0" bukan "kurangi X" — melewati guard
// deductMoney yang menolak jumlah > MAX_SAFE (saldo korup tak bisa dibersihkan
// via pengurangan normal).
function resetMoney(jid) {
  const db = loadDB();
  if (!db.globalMoney) db.globalMoney = {};
  db.globalMoney[normJid(jid)] = 0;
  saveDB(db);
  return true;
}

// Beri starter Pokemon (100 Money) yang ditangguhkan saat migrasi
// karena key-nya (nomor tanpa domain) tidak bisa dicocokkan ke JID penuh.
function grantPokemonStarter(userId, fullJid) {
  const db = loadDB();
  const p = db.pokemonPlayers[userId];
  if (!p || p.jid) return false;
  if (!db.globalMoney) db.globalMoney = {};
  fullJid = normJid(fullJid);
  db.globalMoney[fullJid] = getUserMoney(fullJid) + 100;
  p.jid = fullJid;
  saveDB(db);
  return true;
}

// ─── BANK & ROB SYSTEM ────────────────────────────────────
const BANK_INTEREST_RATE_PER_DAY = 0.01; // 1% per 24 jam
const BANK_INTEREST_INTERVAL_MS  = 24 * 60 * 60 * 1000;
const MAX_BANK_INTEREST_PER_DAY  = 50000; // batas bunga maksimal per hari

function getBankData(jid) {
  const db = loadDB();
  if (!db.bankData) db.bankData = {};
  const key = normJid(jid);
  if (!db.bankData[key]) {
    db.bankData[key] = {
      balance: 0,
      lastInterest: Date.now(),
    };
  }
  return db.bankData[key];
}

function depositBank(jid, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const currentCash = getUserMoney(jid);
  if (currentCash < amount) return false;

  const db = loadDB();
  if (!db.bankData) db.bankData = {};
  const key = normJid(jid);
  const bank = getBankData(jid);

  if (!deductMoney(jid, amount)) return false;

  bank.balance = (bank.balance || 0) + amount;
  db.bankData[key] = bank;
  saveDB(db);
  return true;
}

function withdrawBank(jid, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const bank = getBankData(jid);
  if ((bank.balance || 0) < amount) return false;

  const db = loadDB();
  if (!db.bankData) db.bankData = {};
  const key = normJid(jid);

  bank.balance = (bank.balance || 0) - amount;
  db.bankData[key] = bank;
  addMoney(jid, amount);
  saveDB(db);
  return true;
}

// Kurangi saldo bank langsung (dipakai buku kasir bobol — uang pindah ke
// pembegal, bukan ke dompet korban).
function deductBankBalance(jid, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const db = loadDB();
  if (!db.bankData) db.bankData = {};
  const key = normJid(jid);
  const bank = getBankData(jid);
  if ((bank.balance || 0) < amount) return false;
  bank.balance = (bank.balance || 0) - amount;
  db.bankData[key] = bank;
  saveDB(db);
  return true;
}

function calculatePendingInterest(jid) {
  const bank = getBankData(jid);
  const balance = bank.balance || 0;
  if (balance <= 0) return 0;

  const now = Date.now();
  const last = bank.lastInterest || now;
  const elapsedMs = Math.max(0, now - last);
  const days = elapsedMs / BANK_INTEREST_INTERVAL_MS;

  if (days < 0.01) return 0; // minimal ~14 menit untuk hitung pecahan

  const rawInterest = Math.floor(balance * BANK_INTEREST_RATE_PER_DAY * days);
  const maxCap = Math.floor(MAX_BANK_INTEREST_PER_DAY * Math.min(days, 30)); // cap max 30 hari akumulasi
  return Math.min(rawInterest, maxCap);
}

function claimBankInterest(jid) {
  const pending = calculatePendingInterest(jid);
  if (pending <= 0) return 0;

  const db = loadDB();
  if (!db.bankData) db.bankData = {};
  const key = normJid(jid);
  const bank = getBankData(jid);

  bank.balance = (bank.balance || 0) + pending;
  bank.lastInterest = Date.now();
  db.bankData[key] = bank;
  saveDB(db);
  return pending;
}

function getRobStats(jid) {
  const db = loadDB();
  if (!db.robStats) db.robStats = {};
  const key = normJid(jid);
  if (!db.robStats[key]) {
    db.robStats[key] = {
      lastRob: 0,
      successCount: 0,
      failCount: 0,
    };
  }
  return db.robStats[key];
}

function updateRobStats(jid, isSuccess, stolen = 0) {
  const db = loadDB();
  if (!db.robStats) db.robStats = {};
  const key = normJid(jid);
  const stats = getRobStats(jid);
  stats.lastRob = Date.now();
  if (isSuccess) {
    stats.successCount = (stats.successCount || 0) + 1;
    if (stolen > 0) stats.stolenTotal = (stats.stolenTotal || 0) + stolen;
  } else {
    stats.failCount = (stats.failCount || 0) + 1;
  }
  db.robStats[key] = stats;
  saveDB(db);
  return stats;
}

function getRobTop(limit = 5) {
  const db = loadDB();
  const stats = db.robStats || {};
  const rows = [];
  for (const [jid, st] of Object.entries(stats)) {
    const stolen = (st && st.stolenTotal) || 0;
    const successCount = (st && st.successCount) || 0;
    const failCount = (st && st.failCount) || 0;
    if (stolen <= 0 && successCount <= 0) continue;
    rows.push({ jid, stolen, successCount, failCount, name: resolvePlayerName(db, jid) });
  }
  return rows.sort((a, b) => (b.stolen - a.stolen) || (b.successCount - a.successCount)).slice(0, limit);
}

// Nama tampilan untuk leaderboard (prioritas FishIt → RPG → Pokemon).
function resolvePlayerName(db, jid) {
  const fp = db.fishingPlayers[jid];
  if (fp && fp.name) return fp.name;
  const rp = db.rpgPlayers[jid];
  if (rp && rp.name) return rp.name;
  const pk = (db.pokemonPlayers[resolveNum(jid)] || {});
  return pk.name || resolveNum(jid);
}

// ─── BOBOL (BOBOL BANK) ────────────────────────────────────
function getBobolStats(jid) {
  const db = loadDB();
  if (!db.bobolStats) db.bobolStats = {};
  const key = normJid(jid);
  if (!db.bobolStats[key]) {
    db.bobolStats[key] = {
      lastBobol: 0,
      successCount: 0,
      failCount: 0,
      stolenTotal: 0,
    };
  }
  return db.bobolStats[key];
}

function updateBobolStats(jid, isSuccess, stolen = 0) {
  const db = loadDB();
  if (!db.bobolStats) db.bobolStats = {};
  const key = normJid(jid);
  const stats = getBobolStats(jid);
  stats.lastBobol = Date.now();
  if (isSuccess) {
    stats.successCount = (stats.successCount || 0) + 1;
    if (stolen > 0) stats.stolenTotal = (stats.stolenTotal || 0) + stolen;
  } else {
    stats.failCount = (stats.failCount || 0) + 1;
  }
  db.bobolStats[key] = stats;
  saveDB(db);
  return stats;
}

function getBobolTop(limit = 5) {
  const db = loadDB();
  const stats = db.bobolStats || {};
  const rows = [];
  for (const [jid, st] of Object.entries(stats)) {
    const stolen = (st && st.stolenTotal) || 0;
    const successCount = (st && st.successCount) || 0;
    const failCount = (st && st.failCount) || 0;
    if (stolen <= 0 && successCount <= 0) continue;
    rows.push({ jid, stolen, successCount, failCount, name: resolvePlayerName(db, jid) });
  }
  return rows.sort((a, b) => (b.stolen - a.stolen) || (b.successCount - a.successCount)).slice(0, limit);
}

// ─── TOGEL ─────────────────────────────────────────────────
function getTogelRound(groupId) {
  const db = loadDB();
  if (!db.togelRounds) db.togelRounds = {};
  return db.togelRounds[groupId] || null;
}

function setTogelRound(groupId, round) {
  const db = loadDB();
  if (!db.togelRounds) db.togelRounds = {};
  db.togelRounds[groupId] = round;
  saveDB(db);
  return true;
}

function getTogelStats(jid) {
  const db = loadDB();
  if (!db.togelStats) db.togelStats = {};
  return db.togelStats[normJid(jid)] || null;
}

function getAllTogelStats() {
  return loadDB().togelStats || {};
}

function updateTogelStats(jid, data) {
  jid = normJid(jid);
  const db = loadDB();
  if (!db.togelStats) db.togelStats = {};
  db.togelStats[jid] = { ...(db.togelStats[jid] || {}), ...data };
  saveDB(db);
  return true;
}

function getTogelHistory() {
  const db = loadDB();
  if (!db.togelHistory) db.togelHistory = [];
  return db.togelHistory;
}

function addTogelHistory(entry, limit) {
  const db = loadDB();
  if (!db.togelHistory) db.togelHistory = [];
  db.togelHistory.push(entry);
  const max = limit || 20;
  if (db.togelHistory.length > max) db.togelHistory = db.togelHistory.slice(-max);
  saveDB(db);
  return true;
}

// ─── MAHJONG STATS ────────────────────────────────────────
// Key = JID pemain → { wins, losses, draws, moneyEarned, moneyLost }.
// Hanya rekap; taruhan aktual ditangani lewat addMoney/deductMoney.
function getMahjongStats(jid) {
  const db = loadDB();
  if (!db.mahjongStats) db.mahjongStats = {};
  return db.mahjongStats[normJid(jid)] || null;
}

function updateMahjongStats(jid, delta) {
  jid = normJid(jid);
  const db = loadDB();
  if (!db.mahjongStats) db.mahjongStats = {};
  const cur = db.mahjongStats[jid] || { wins: 0, losses: 0, draws: 0, moneyEarned: 0, moneyLost: 0 };
  db.mahjongStats[jid] = {
    wins: cur.wins + (delta.wins || 0),
    losses: cur.losses + (delta.losses || 0),
    draws: cur.draws + (delta.draws || 0),
    moneyEarned: cur.moneyEarned + (delta.moneyEarned || 0),
    moneyLost: cur.moneyLost + (delta.moneyLost || 0),
  };
  saveDB(db);
  return true;
}

// ─── CLAIM HARIAN (!claim) ───────────────────────────────
// Reset otomatis jam 00.00 WIB (UTC+7). Satu claim per hari per user.
function getWibDate(ms = Date.now()) {
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getDailyClaim(jid) {
  if (!jid) return null;
  const db = loadDB();
  if (!db.dailyClaims) db.dailyClaims = {};
  return db.dailyClaims[normJid(jid)] || null;
}

function setDailyClaim(jid, dateStr, ms = Date.now()) {
  if (!jid) return false;
  jid = normJid(jid);
  const db = loadDB();
  if (!db.dailyClaims) db.dailyClaims = {};
  db.dailyClaims[jid] = { date: dateStr, lastClaimAt: ms };
  saveDB(db);
  return true;
}

module.exports = {
  // Auto-Registrasi
  autoRegisterUser,
  // Pokemon
  isPokemonRegistered,
  getPokemonPlayer, savePokemonPlayer, getPokemonLeaderboard,
  getWildSpawn, setWildSpawn, clearWildSpawn,
  getWildBattle, setWildBattle, clearWildBattle,
  getBattle, setBattle, clearBattle, deletePokemonPlayer,
  // Fishing
  getFishingPlayer, updateFishingPlayer, deleteFishingPlayer,
  getAllFishingPlayers, getTopGlobalMoney, getTopRarity,
  // RPG
  getRpgPlayer, updateRpgPlayer,
  deleteRpgPlayer, getAllRpgPlayers,
  getRpgDuel, setRpgDuel, clearRpgDuel,
  getRpgRaid, setRpgRaid, clearRpgRaid,
  // Pet
  createPetPlayer, getPetPlayer, updatePetPlayer,
  deletePetPlayer, getAllPetPlayers, getPetLeaderboard,
  // Gacha
  getGachaStats, updateGachaStats, resetGachaStats,
  // Blackjack
  recordBjLoss, getBjTop,
  // Ban System
  banUser, unbanUser, isUserBanned, getBannedList,
  // Ban lokal per grup
  banUserInGroup, unbanUserInGroup, isUserBannedInGroup, getGroupBannedList,
  // Togel
  getTogelRound, setTogelRound,
  getTogelStats, updateTogelStats,
  getAllTogelStats,
  getTogelHistory, addTogelHistory,
  // Mahjong
  getMahjongStats, updateMahjongStats,
  // Ekonomi Global
  getUserMoney, addMoney, deductMoney, resetMoney, grantPokemonStarter,
  // Bank & Rob
  getBankData, depositBank, withdrawBank, deductBankBalance, calculatePendingInterest, claimBankInterest,
  getRobStats, updateRobStats, getRobTop,
  // Bobol Bank
  getBobolStats, updateBobolStats, getBobolTop,
  // Claim Harian
  getWibDate, getDailyClaim, setDailyClaim,
  // Persistensi
  flushDB: flushNow
};
