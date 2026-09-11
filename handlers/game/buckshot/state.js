// handlers/game/buckshot/state.js
// State in-memory & generator peluru/item untuk Buckshot Roulette.
const { addMoney } = require('../../../data/db');

// Map game aktif: key = chatId, value = GameSession
const buckshotGames = new Map();

const DEFAULT_HP = 3;
const MAX_ITEMS = 6;
const ACTION_TIMEOUT_MS = 2 * 60 * 1000; // 2 menit batas giliran / respon invite
const ALL_ITEMS = ['kaca', 'rokok', 'gergaji', 'borgol', 'bir'];

/**
 * Acak array (Fisher-Yates)
 */
function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Buat peluru acak (2 - 8 shell)
 * Minimal 1 peluru tajam (live) dan 1 kosong (blank)
 */
function generateShells() {
  const total = Math.floor(Math.random() * 5) + 3; // 3 sampai 7 shell
  const liveCount = Math.max(1, Math.floor(Math.random() * (total - 1)) + 1);
  const blankCount = total - liveCount;

  const shells = [];
  for (let i = 0; i < liveCount; i++) shells.push('live');
  for (let i = 0; i < blankCount; i++) shells.push('blank');

  return {
    shells: shuffle(shells),
    totalLive: liveCount,
    totalBlank: blankCount,
  };
}

/**
 * Beri item acak ke setiap pemain yang masih hidup
 */
function giveItemsToAlivePlayers(game, count = 2) {
  const given = {};
  for (const jid of game.players) {
    if (game.hp[jid] <= 0) continue;
    if (!game.items[jid]) game.items[jid] = [];
    const added = [];
    for (let i = 0; i < count; i++) {
      if (game.items[jid].length >= MAX_ITEMS) break;
      const item = ALL_ITEMS[Math.floor(Math.random() * ALL_ITEMS.length)];
      game.items[jid].push(item);
      added.push(item);
    }
    given[jid] = added;
  }
  return given;
}

/**
 * Ambil daftar pemain yang masih hidup
 */
function getAlivePlayers(game) {
  return game.players.filter(j => game.hp[j] > 0);
}

/**
 * Pindah giliran ke pemain hidup berikutnya
 */
function advanceTurn(game) {
  const alive = getAlivePlayers(game);
  if (alive.length <= 1) return null;

  let currIdx = game.players.indexOf(game.turn);
  if (currIdx === -1) currIdx = 0;

  for (let step = 1; step <= game.players.length; step++) {
    const nextIdx = (currIdx + step) % game.players.length;
    const candidate = game.players[nextIdx];

    // Lewati jika sudah mati
    if (game.hp[candidate] <= 0) continue;

    // Cek apakah pemain ini diborgol
    if (game.handcuffed === candidate) {
      // Bebaskan borgol tapi lewati gilirannya kali ini
      game.handcuffed = null;
      game.handcuffedLastRound = candidate;
      continue;
    }

    game.turn = candidate;
    return candidate;
  }

  // Fallback ke pemain hidup pertama
  game.turn = alive[0];
  return alive[0];
}

/**
 * Jadwalkan timeout giliran atau timeout tantangan
 */
function scheduleGameTimer(sock, chatId, onTimeout) {
  const game = buckshotGames.get(chatId);
  if (!game) return;

  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }

  game.timer = setTimeout(async () => {
    const currentGame = buckshotGames.get(chatId);
    if (currentGame === game) {
      await onTimeout(game);
    }
  }, ACTION_TIMEOUT_MS);

  if (game.timer.unref) game.timer.unref();
}

/**
 * Hentikan timer dan bersihkan
 */
function clearGameTimer(game) {
  if (game && game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

/**
 * Kembalikan taruhan ke pemain yang sudah dipotong saldonya
 */
function refundAllBets(game) {
  if (!game || !game.bet || game.bet <= 0) return;
  for (const jid of game.paidPlayers || []) {
    // Jangan refund ke bot
    if (jid === 'DEALER_BOT') continue;
    addMoney(jid, game.bet);
  }
  game.paidPlayers = [];
}

/**
 * Hapus sesi game
 */
function deleteGame(chatId) {
  const game = buckshotGames.get(chatId);
  if (game) {
    clearGameTimer(game);
    buckshotGames.delete(chatId);
  }
}

module.exports = {
  buckshotGames,
  DEFAULT_HP,
  MAX_ITEMS,
  ACTION_TIMEOUT_MS,
  ALL_ITEMS,
  shuffle,
  generateShells,
  giveItemsToAlivePlayers,
  getAlivePlayers,
  advanceTurn,
  scheduleGameTimer,
  clearGameTimer,
  refundAllBets,
  deleteGame,
};
