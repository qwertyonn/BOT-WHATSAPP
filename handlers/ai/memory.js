// handlers/ai/memory.js
// Ingatan AI owner: fakta permanen + riwayat chat singkat.
// State JSON sinkron sederhana — state kecil, tanpa debounce/backup.
const fs = require('fs');
const path = require('path');

const memoryFile = process.env.BOT_AI_MEMORY_PATH
  ? path.resolve(process.env.BOT_AI_MEMORY_PATH)
  : path.join(__dirname, '..', '..', 'state', 'ai_memory.json');

const MAX_HISTORY = 100;  // jumlah pesan (user+assistant) maksimum diingat
const MAX_CHARS = 8000;  // batas total karakter history biar hemat token model free

let state = { facts: [], history: [] };

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
    state.facts = Array.isArray(raw.facts) ? raw.facts : [];
    state.history = Array.isArray(raw.history) ? raw.history : [];
  } catch (err) {
    // File belum ada / korup → mulai kosong, ditulis ulang saat save pertama.
    state = { facts: [], history: [] };
  }
}

function save() {
  try {
    // Tulis atomik: file temp dulu lalu rename — anti file setengah jadi bila
    // proses mati di tengah penulisan (sama pola dgn data/db.js).
    const tmp = `${memoryFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, memoryFile);
  } catch (err) {
    console.error('❌ Gagal simpan ai_memory.json:', err.message);
  }
}

load();

function getFacts() { return state.facts.slice(); }

function addFact(fact) {
  const f = (fact || '').trim();
  if (!f || state.facts.includes(f)) return false;
  state.facts.push(f);
  save();
  return true;
}

function removeFact(keyword) {
  const k = (keyword || '').trim().toLowerCase();
  if (!k) return 0;
  const before = state.facts.length;
  state.facts = state.facts.filter(f => !f.toLowerCase().includes(k));
  if (state.facts.length !== before) save();
  return before - state.facts.length;
}

function getHistory() { return state.history.slice(); }

function pushHistory(user, assistant) {
  state.history.push({ role: 'user', content: user });
  if (assistant) state.history.push({ role: 'assistant', content: assistant });
  while (state.history.length > MAX_HISTORY) state.history.shift();
  let total = state.history.reduce((a, m) => a + (m.content || '').length, 0);
  while (total > MAX_CHARS && state.history.length > 1) {
    total -= (state.history[0].content || '').length;
    state.history.shift();
  }
  save();
}

module.exports = { getFacts, addFact, removeFact, getHistory, pushHistory };