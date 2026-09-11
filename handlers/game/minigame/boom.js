// handlers/game/minigame/boom.js
// Game Tebak Boom: 25 kotak (10 bom random), multiplayer taruhan.
const { addMoney, deductMoney, getUserMoney } = require('../../../data/db');
const { sameUser, getNumber } = require('../../../utils/jid');
const { quickReply, listButton, sendMenu } = require('../../../utils/buttons');

const boomGames = new Map();
const TOTAL_BOXES = 25;
const BOMB_COUNT = 10;
const MAX_PLAYERS = 10;
const GAME_TIMEOUT_MS = 10 * 60 * 1000;

function generateBoxes() {
  const boxes = Array(TOTAL_BOXES).fill('safe');
  const bombIdx = new Set();
  while (bombIdx.size < BOMB_COUNT) {
    bombIdx.add(Math.floor(Math.random() * TOTAL_BOXES));
  }
  for (const i of bombIdx) boxes[i] = 'bomb';
  return boxes;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderBoxes(game) {
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const cells = [];
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      if (game.opened[i] === 'bomb') cells.push('💣');
      else if (game.opened[i] === 'safe') cells.push('✅');
      else cells.push(String(i + 1).padStart(2, ' '));
    }
    rows.push(cells.join(' │ '));
  }
  return rows.join('\n');
}

function alivePlayers(game) {
  return game.players.filter(j => !game.dead[j]);
}

// Sections dropdown kotak yang belum terbuka, dikelompokkan per baris 5x5.
function boxSections(game) {
  const sections = [];
  for (let r = 0; r < 5; r++) {
    const rows = [];
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      if (game.opened[i]) continue;
      rows.push({ title: `Kotak ${i + 1}`, id: `!buka ${i + 1}` });
    }
    if (rows.length) sections.push({ title: `Baris ${r + 1}`, rows });
  }
  return sections;
}

function nextTurn(game) {
  for (let step = 0; step < game.players.length; step++) {
    game.turnIndex = (game.turnIndex + 1) % game.players.length;
    if (!game.dead[game.turnOrder[game.turnIndex]]) return true;
  }
  return false;
}

function scheduleTimer(sock, chatId, game) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    if (boomGames.get(chatId) !== game) return;
    refundBets(sock, chatId, game, '⏰ Waktu permainan habis (10 menit). Taruhan dikembalikan ke semua pemain.');
  }, GAME_TIMEOUT_MS);
  if (game.timer.unref) game.timer.unref();
}

async function refundBets(sock, chatId, game, reason) {
  for (const j of game.players) addMoney(j, game.bet);
  boomGames.delete(chatId);
  await sock.sendMessage(chatId, { text: reason });
}

function payWinners(sock, chatId, game, winners) {
  const share = Math.floor(game.pot / winners.length);
  let remainder = game.pot - share * winners.length;
  for (const w of winners) {
    let amt = share;
    if (remainder > 0) { amt += 1; remainder--; }
    addMoney(w, amt);
  }
  boomGames.delete(chatId);
}

const HELP_TEXT = [
  '💣 *GAME TEBAK BOOM* 💣',
  '25 kotak, 10 bom di posisi acak. Buka kotak aman, jangan kena bom!',
  '',
  '• *!tebakboom <jumlah>* — buat room (taruhan sama utk semua)',
  '• *!tebakboom join* — ikut bermain',
  '• *!tebakboom start* — mulai (min 2 pemain)',
  '• *!tebakboom open <n>* / *!buka <n>* — buka kotak (saat giliranmu)',
  '• *!tebakboom cancel* — batal & refund semua taruhan',
  '',
  '🏆 15 kotak aman terbuka → semua yang masih hidup menang, pot dibagi rata.',
  '💥 Semua pemain gugur → taruhan hangus!',
].join('\n');

async function handleBoom(ctx) {
  const { sock, msg, chatId, isGroup, senderJid, senderName, body } = ctx;
  if (!body) return false;
  const tokens = body.trim().split(/\s+/);
  const main = (tokens[0] || '').toLowerCase();
  if (main !== '!tebakboom' && main !== '!boom' && main !== '!buka') return false;

  if (!isGroup) {
    await sock.sendMessage(chatId, { text: '⚠️ Game Tebak Boom hanya bisa dimainkan di dalam grup!' }, { quoted: msg });
    return true;
  }

  const game = boomGames.get(chatId);
  if (game) scheduleTimer(sock, chatId, game);

  let args = tokens.slice(1);
  let subCmd = args[0] ? args[0].toLowerCase() : '';
  let numArg;
  if (main === '!buka') { subCmd = 'open'; numArg = args[0]; }
  else if (subCmd === 'open' || subCmd === 'buka') numArg = args[1];

  if (!subCmd || subCmd === 'help' || subCmd === 'bantuan') {
    await sock.sendMessage(chatId, { text: HELP_TEXT }, { quoted: msg });
    return true;
  }

  // ─── BUAT ROOM: !tebakboom <jumlah> ───────────────
  if (/^\d+$/.test(subCmd)) {
    if (game) {
      await sock.sendMessage(chatId, { text: '⚠️ Sudah ada sesi Tebak Boom di chat ini. Selesaikan atau *!tebakboom cancel* dulu.' }, { quoted: msg });
      return true;
    }
    const bet = Number(subCmd);
    if (!Number.isInteger(bet) || bet <= 0) {
      await sock.sendMessage(chatId, { text: '⚠️ Jumlah taruhan tidak valid! Contoh: *!tebakboom 1000*' }, { quoted: msg });
      return true;
    }
    if (getUserMoney(senderJid) < bet) {
      await sock.sendMessage(chatId, { text: `❌ Saldomu kurang! Butuh *${bet} Money*, saldo kamu ${getUserMoney(senderJid)} Money.` }, { quoted: msg });
      return true;
    }
    deductMoney(senderJid, bet);
    const g = {
      status: 'waiting', bet, creator: senderJid,
      players: [senderJid], playerNames: { [senderJid]: senderName },
      dead: {}, opened: {}, safeOpened: 0, pot: bet,
    };
    boomGames.set(chatId, g);
    scheduleTimer(sock, chatId, g);
    const roomText = `🎮 *Room Tebak Boom Dibuat!*\n\n👑 Host: *@${getNumber(senderJid)}*\n💰 Taruhan: *${bet} Money* (sudah dipotong)\n👥 Player (1/${MAX_PLAYERS}):\n1. *@${getNumber(senderJid)}*\n\n👉 Klik *Join* untuk ikut, atau *Mulai* jika siap bertanding (min 2 pemain).`;
    await sendMenu(sock, chatId, {
      text: roomText,
      footer: '💣 Tebak Boom — aksi room',
      fallbackText: `${roomText}\n\nAtau ketik: *!tebakboom join* / *!tebakboom start*`,
      mentions: [senderJid],
      quoted: msg,
      buttons: [
        quickReply('!tebakboom join', '✅ Join'),
        quickReply('!tebakboom start', '🚀 Mulai'),
      ],
    });
    return true;
  }

  // ─── JOIN: !tebakboom join ────────────────────────
  if (subCmd === 'join') {
    if (!game) {
      await sock.sendMessage(chatId, { text: '❌ Tidak ada room aktif. Buat dulu: *!tebakboom <jumlah>*' }, { quoted: msg });
      return true;
    }
    if (game.status !== 'waiting') {
      await sock.sendMessage(chatId, { text: '❌ Game sudah dimulai, tidak bisa join di tengah jalan.' }, { quoted: msg });
      return true;
    }
    if (game.players.some(j => sameUser(j, senderJid))) {
      await sock.sendMessage(chatId, { text: '⚠️ Kamu sudah terdaftar di room ini!' }, { quoted: msg });
      return true;
    }
    if (game.players.length >= MAX_PLAYERS) {
      await sock.sendMessage(chatId, { text: `🚫 Room penuh! (Maksimal ${MAX_PLAYERS} pemain).` }, { quoted: msg });
      return true;
    }
    if (getUserMoney(senderJid) < game.bet) {
      await sock.sendMessage(chatId, { text: `❌ Saldomu kurang! Butuh *${game.bet} Money*, saldo kamu ${getUserMoney(senderJid)} Money.` }, { quoted: msg });
      return true;
    }
    deductMoney(senderJid, game.bet);
    game.players.push(senderJid);
    game.playerNames[senderJid] = senderName;
    game.pot += game.bet;
    const list = game.players.map((p, i) => `${i + 1}. *@${getNumber(p)}*`).join('\n');
    const joinText = `✅ *@${getNumber(senderJid)}* bergabung! (${game.players.length}/${MAX_PLAYERS})\n\n👥 *Daftar Player:*\n${list}\n\n💰 Pot saat ini: *${game.pot} Money*\n👉 Klik *Join* untuk ikut, atau *Mulai* jika siap bertanding.`;
    await sendMenu(sock, chatId, {
      text: joinText,
      footer: '💣 Tebak Boom — aksi room',
      fallbackText: `${joinText}\n\nAtau ketik: *!tebakboom join* / *!tebakboom start*`,
      mentions: game.players,
      quoted: msg,
      buttons: [
        quickReply('!tebakboom join', '✅ Join'),
        quickReply('!tebakboom start', '🚀 Mulai'),
      ],
    });
    return true;
  }

  // ─── START: !tebakboom start ──────────────────────
  if (subCmd === 'start') {
    if (!game) {
      await sock.sendMessage(chatId, { text: '❌ Tidak ada room yang bisa dimulai. Buat dulu: *!tebakboom <jumlah>*' }, { quoted: msg });
      return true;
    }
    if (game.status === 'playing') {
      await sock.sendMessage(chatId, { text: '⚠️ Game sudah berjalan!' }, { quoted: msg });
      return true;
    }
    if (!sameUser(senderJid, game.creator)) {
      await sock.sendMessage(chatId, { text: `⏳ Hanya host (*@${getNumber(game.creator)}*) yang bisa memulai game.`, mentions: [game.creator] }, { quoted: msg });
      return true;
    }
    if (game.players.length < 2) {
      await sock.sendMessage(chatId, { text: '⚠️ Minimal 2 pemain untuk mulai. Tunggu pemain lain join!' }, { quoted: msg });
      return true;
    }
    game.status = 'playing';
    game.boxes = generateBoxes();
    game.turnOrder = shuffle(game.players);
    game.turnIndex = -1;
    nextTurn(game);
    const giliran = game.turnOrder[game.turnIndex];
    const startText = `🚀 *PERMAINAN TEBAK BOOM DIMULAI!*\n\n${renderBoxes(game)}\n\n💰 Pot: *${game.pot} Money*\n💣 Bom: ${BOMB_COUNT} | ✅ Aman: ${TOTAL_BOXES - BOMB_COUNT}\n\n🎲 Giliran pertama: *@${getNumber(giliran)}*\n👉 Pilih kotak dari daftar di bawah untuk membuka.`;
    await sendMenu(sock, chatId, {
      text: startText,
      footer: '💣 Pilih kotak yang mau dibuka',
      fallbackText: `${startText}\n\nAtau ketik: *!buka <nomor>*`,
      mentions: game.players,
      quoted: msg,
      buttons: [listButton('💣 Pilih Kotak', boxSections(game))],
    });
    return true;
  }

  // ─── BUKA KOTAK: !tebakboom open <n> / !buka <n> ──
  if (subCmd === 'open' || subCmd === 'buka') {
    if (!game || game.status !== 'playing') {
      await sock.sendMessage(chatId, { text: '❌ Tidak ada game Tebak Boom yang sedang berjalan!' }, { quoted: msg });
      return true;
    }
    const giliran = game.turnOrder[game.turnIndex];
    if (!sameUser(senderJid, giliran)) {
      await sock.sendMessage(chatId, { text: `⏳ *Bukan giliranmu!* Sekarang giliran *@${getNumber(giliran)}*`, mentions: [giliran] }, { quoted: msg });
      return true;
    }
    const n = Number(numArg);
    if (!Number.isInteger(n) || n < 1 || n > TOTAL_BOXES) {
      await sock.sendMessage(chatId, { text: `⚠️ Nomor kotak tidak valid! Pilih 1-${TOTAL_BOXES}. Contoh: *!buka 7*` }, { quoted: msg });
      return true;
    }
    const idx = n - 1;
    if (game.opened[idx]) {
      await sock.sendMessage(chatId, { text: `⚠️ Kotak ${n} sudah terbuka. Pilih kotak lain!` }, { quoted: msg });
      return true;
    }

    const isBomb = game.boxes[idx] === 'bomb';
    game.opened[idx] = isBomb ? 'bomb' : 'safe';
    let log;
    if (isBomb) {
      game.dead[senderJid] = true;
      log = `💥 *@${getNumber(senderJid)}* membuka kotak ${n} dan mendapat BOM! Kamu gugur!`;
    } else {
      game.safeOpened++;
      log = `✅ *@${getNumber(senderJid)}* membuka kotak ${n} — AMAN!`;
    }

    const alive = alivePlayers(game);
    let overText = null;

    if (game.safeOpened === TOTAL_BOXES - BOMB_COUNT) {
      payWinners(sock, chatId, game, alive);
      const winList = alive.map(j => `*@${getNumber(j)}*`).join(', ');
      const share = Math.floor(game.pot / alive.length);
      overText = `🏆 *SEMUA KOTAK AMAN TERBUKA! GAME OVER* 🏆\n\n${renderBoxes(game)}\n\n👑 Pemenang: ${winList}\n💰 Hadiah (dibagi rata): *${share} Money* per pemain.`;
      await sock.sendMessage(chatId, { text: `${log}\n\n${overText}`, mentions: game.players.concat(alive) }, { quoted: msg });
      return true;
    }
    if (alive.length === 0) {
      boomGames.delete(chatId);
      overText = `💥 *SEMUA PEMAIN GUGUR!* 💥\n\n${renderBoxes(game)}\n\nTaruhan hangus, tidak ada pemenang. 😵`;
      await sock.sendMessage(chatId, { text: `${log}\n\n${overText}`, mentions: game.players }, { quoted: msg });
      return true;
    }

    nextTurn(game);
    const berikut = game.turnOrder[game.turnIndex];
    const sisaBom = game.boxes.filter((b, i) => b === 'bomb' && !game.opened[i]).length;
    const sisaAman = game.boxes.filter((b, i) => b === 'safe' && !game.opened[i]).length;
    const turnText = `${log}\n\n${renderBoxes(game)}\n\n💣 Bom tersisa: ${sisaBom} | ✅ Aman tersisa: ${sisaAman}\n🎲 Giliran berikutnya: *@${getNumber(berikut)}*\n👉 Pilih kotak dari daftar di bawah untuk membuka.`;
    await sendMenu(sock, chatId, {
      text: turnText,
      footer: '💣 Pilih kotak yang mau dibuka',
      fallbackText: `${turnText}\n\nAtau ketik: *!buka <nomor>*`,
      mentions: [senderJid, berikut],
      quoted: msg,
      buttons: [listButton('💣 Pilih Kotak', boxSections(game))],
    });
    return true;
  }

  // ─── CANCEL: !tebakboom cancel ────────────────────
  if (subCmd === 'cancel' || subCmd === 'stop') {
    if (!game) {
      await sock.sendMessage(chatId, { text: '❌ Tidak ada game Tebak Boom yang aktif.' }, { quoted: msg });
      return true;
    }
    if (!sameUser(senderJid, game.creator)) {
      await sock.sendMessage(chatId, { text: `⏳ Hanya host (*@${getNumber(game.creator)}*) yang bisa membatalkan game.`, mentions: [game.creator] }, { quoted: msg });
      return true;
    }
    await refundBets(sock, chatId, game, '⏹️ Game dibatalkan. Taruhan dikembalikan ke semua pemain.');
    return true;
  }

  await sock.sendMessage(chatId, { text: HELP_TEXT }, { quoted: msg });
  return true;
}

module.exports = { handleBoom, boomGames };