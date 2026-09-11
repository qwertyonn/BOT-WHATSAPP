// ============================================================
// HANDLER ACHIEVEMENT FISHIT
// - evaluateAchievements(p): cek semua achievement, unlock yang baru
//   tercapai, auto-credit reward, simpan timestamp di p.achievements.
// - renderAchievements(p): list lengkap untuk perintah !fishit achievement.
// ============================================================
const { FISHIT_ACHIEVEMENTS } = require('../../../data/fishitAchievements');
const { updateFishingPlayer, addMoney } = require('../../../data/db');
const { formatGold } = require('../../../game/fishingEngine');
const ui = require('../../../utils/ui');

// Cek & unlock achievement yang baru tercapai. Mengembalikan array
// achievement bertanda { id, name, emoji, reward } (baru di-unlock).
// Dipanggil setelah tangkapan sukses / zonk di cmdMancing.
function evaluateAchievements(p) {
  if (!p) return [];
  p.achievements = p.achievements || {};
  const newly = [];
  for (const a of FISHIT_ACHIEVEMENTS) {
    if (p.achievements[a.id]) continue;
    if (!a.check(p)) continue;
    p.achievements[a.id] = Date.now();
    addMoney(p.jid, a.reward);
    newly.push(a);
  }
  if (newly.length) updateFishingPlayer(p.jid, { achievements: p.achievements });
  return newly;
}

// Baris notifikasi singkat untuk sisipan di box hasil mancing
function renderUnlocked(newly) {
  if (!newly.length) return '';
  return [
    '',
    '🏆 *ACHIEVEMENT UNLOCKED!*',
    ...newly.map(a => `  ${a.emoji} ${a.name} — 💰 +${formatGold(a.reward)}`),
  ].join('\n');
}

// List semua achievement (untuk !fishit achievement)
function renderAchievements(p) {
  if (!p) return `❌ Kamu belum terdaftar di FishIt.`;
  p.achievements = p.achievements || {};
  const done = [];
  const todo = [];
  for (const a of FISHIT_ACHIEVEMENTS) {
    const line = `${a.emoji} *${a.name}* — 💰 ${formatGold(a.reward)}\n   ${a.desc}`;
    if (p.achievements[a.id]) {
      const tgl = new Date(p.achievements[a.id]);
      done.push(`✅ ${line}\n   _Selesai ${tgl.getDate()}/${tgl.getMonth() + 1}/${tgl.getFullYear()}_`);
    } else {
      const prog = a.progress ? `\n   📈 ${a.progress(p)}` : '';
      todo.push(`⭕ ${line}${prog}`);
    }
  }
  return ui.box('🏆 ACHIEVEMENT', [
    `Selesaikan untuk dapat Money! Reward otomatis saat tercapai.\n`,
    ``,
    ...done,
    ...(done.length && todo.length ? ['', '───'] : []),
    ...todo,
    ``,
    ui.bullet('Semua reward diklaim otomatis saat syarat terpenuhi.'),
  ], `Progress: ${done.length}/${FISHIT_ACHIEVEMENTS.length}`);
}

module.exports = { evaluateAchievements, renderUnlocked, renderAchievements };