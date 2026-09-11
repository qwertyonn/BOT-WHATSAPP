// handlers/game/buckshot/bot.js
// Logika AI cerdas untuk Dealer Bot di Buckshot Roulette.
const { getAlivePlayers } = require('./state');

/**
 * Tentukan langkah giliran untuk Dealer Bot.
 * Mengembalikan array instruksi aksi yang akan dieksekusi:
 * Contoh: [{ type: 'item', item: 'kaca' }, { type: 'item', item: 'gergaji' }, { type: 'shoot', target: 'opponent' }]
 */
function decideBotTurn(game) {
  const botJid = 'DEALER_BOT';
  const myItems = [...(game.items[botJid] || [])];
  const myHp = game.hp[botJid];
  const maxHp = game.maxHp || 3;
  const aliveOpponents = getAlivePlayers(game).filter(j => j !== botJid);

  if (aliveOpponents.length === 0) return [];

  // Target lawan: utamakan yang HP terendah agar cepat gugur
  aliveOpponents.sort((a, b) => game.hp[a] - game.hp[b]);
  const primaryOpponent = aliveOpponents[0];

  const actions = [];
  let knownTopShell = game.knownShells?.[botJid] || null; // jika sudah tahu dari intip kaca
  let isDoubleDamage = game.doubleNext;

  // 1. Cek rokok jika HP kurang dari max
  if (myHp < maxHp && myItems.includes('rokok')) {
    actions.push({ type: 'item', item: 'rokok' });
    const idx = myItems.indexOf('rokok');
    if (idx !== -1) myItems.splice(idx, 1);
  }

  // 2. Cek kaca jika belum tahu peluru teratas dan ada lebih dari 1 peluru
  if (!knownTopShell && myItems.includes('kaca') && game.shells.length > 1) {
    actions.push({ type: 'item', item: 'kaca' });
    const idx = myItems.indexOf('kaca');
    if (idx !== -1) myItems.splice(idx, 1);
    // Asumsikan bot langsung tahu isi peluru teratas (akan disimulasikan di handler)
    knownTopShell = game.shells[0];
  }

  // 3. Cek borgol jika belum ada yang diborgol dan lawan bukan yang diborgol round lalu
  if (
    !game.handcuffed &&
    game.handcuffedLastRound !== primaryOpponent &&
    myItems.includes('borgol')
  ) {
    actions.push({ type: 'item', item: 'borgol', target: primaryOpponent });
    const idx = myItems.indexOf('borgol');
    if (idx !== -1) myItems.splice(idx, 1);
  }

  // 4. Cek bir jika peluru teratas tidak diketahui tapi peluru tajam sedikit dan tidak mau ambil risiko
  const liveCount = game.shells.filter(s => s === 'live').length;
  const blankCount = game.shells.filter(s => s === 'blank').length;
  const totalShells = game.shells.length;

  if (
    !knownTopShell &&
    myItems.includes('bir') &&
    liveCount > 0 &&
    blankCount > 0 &&
    totalShells >= 3 &&
    Math.random() < 0.4
  ) {
    actions.push({ type: 'item', item: 'bir' });
    const idx = myItems.indexOf('bir');
    if (idx !== -1) myItems.splice(idx, 1);
  }

  // 5. Cek gergaji jika tahu peluru teratas tajam atau probabilitas tajam sangat tinggi
  const probLive = liveCount / Math.max(1, totalShells);
  if (!isDoubleDamage && myItems.includes('gergaji')) {
    if (knownTopShell === 'live' || (!knownTopShell && probLive >= 0.7)) {
      actions.push({ type: 'item', item: 'gergaji' });
      const idx = myItems.indexOf('gergaji');
      if (idx !== -1) myItems.splice(idx, 1);
      isDoubleDamage = true;
    }
  }

  // 6. Keputusan Menembak: Diri sendiri vs Lawan
  if (knownTopShell === 'blank') {
    // Pasti kosong -> tembak diri sendiri agar dapat bonus giliran!
    actions.push({ type: 'shoot', target: 'self' });
  } else if (knownTopShell === 'live') {
    // Pasti tajam -> tembak lawan!
    actions.push({ type: 'shoot', target: primaryOpponent });
  } else {
    // Tidak tahu pasti, hitung probabilitas
    if (probLive > 0.5) {
      // Lebih banyak tajam -> tembak lawan
      actions.push({ type: 'shoot', target: primaryOpponent });
    } else {
      // Lebih banyak kosong -> ambil risiko tembak diri sendiri untuk bonus turn
      actions.push({ type: 'shoot', target: 'self' });
    }
  }

  return actions;
}

module.exports = {
  decideBotTurn,
};
