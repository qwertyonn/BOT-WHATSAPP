// handlers/game/mahjong/commands.js
// Game Mahjong sederhana (3 suit, 4 set + 1 pair, tanpa chi/pon/kan).
// HANYA dimainkan di grup WhatsApp.
// Mode:
//   - Solo !mahjong <ante> solo : main melawan bot
//   - Multi !mahjong <ante> @t1 @t2 @t3 : room undangan (maks 4 pemain)
// Taruhan: ante pot bersama (100/500/1000/5000). 1 pemenang ambil semua pot.
const {
  getUserMoney, addMoney, deductMoney,
  getMahjongStats, updateMahjongStats,
} = require('../../../data/db');
const ui = require('../../../utils/ui');
const { sameUser, getNumber, resolveMentionedJids } = require('../../../utils/jid');
const { quickReply, listButton, sendMenu } = require('../../../utils/buttons');
const { parsePositiveAmount } = require('../../../utils/amount');
const eng = require('../../../game/mahjongEngine');

const ANTES = [100, 500, 1000, 5000];
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const ROOM_TIMEOUT_MS = 45 * 1000;     // 45 dtk menunggu join room multi
const TURN_TIMEOUT_MS = 90 * 1000;     // 90 dtk per giliran (auto-discard acak)
const RON_TIMEOUT_MS = 45 * 1000;      // 45 dtk jendela ron setelah discard

// State in-memory (pola Blackjack bjSessions) — tidak persist, auto-clear timer.
const sessions = {}; // { chatId: session }

function getSession(chatId) { return sessions[chatId] || null; }
function setSession(chatId, s) { sessions[chatId] = s; }
function clearSession(chatId) {
  const s = sessions[chatId];
  if (s) {
    if (s.timer) clearTimeout(s.timer);
    if (s.ronTimer) clearTimeout(s.ronTimer);
  }
  delete sessions[chatId];
}

function scheduleTurn(sock, chatId) {
  const s = getSession(chatId);
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => autoResolveTurn(sock, chatId), TURN_TIMEOUT_MS);
}

function clearTurn(sock, chatId) {
  const s = getSession(chatId);
  if (s && s.timer) { clearTimeout(s.timer); s.timer = null; }
}

function scheduleRon(sock, chatId) {
  const s = getSession(chatId);
  if (!s) return;
  if (s.ronTimer) clearTimeout(s.ronTimer);
  s.ronTimer = setTimeout(() => proceedAfterRon(sock, chatId), RON_TIMEOUT_MS);
}

function clearRon(sock, chatId) {
  const s = getSession(chatId);
  if (s && s.ronTimer) { clearTimeout(s.ronTimer); s.ronTimer = null; }
}

// ─── ENTRY ───────────────────────────────────────────────
async function handleMahjong(ctx) {
  const { sock, msg, chatId, isGroup, senderJid, senderName, body } = ctx;
  const b = body.toLowerCase();

  // Token aksi giliran (tanpa prefix !mahjong) — dispatch ke sesi aktif.
  if (/^!(draw|dis|discard|menang|ron|tsumo|lanjut)\b/.test(b)) {
    return handleAction(sock, msg, chatId, isGroup, senderJid, b);
  }

  if (!b.startsWith('!mahjong')) return false;

  // Bersihkan sesi yang sudah kehabisan waktu (hanya ada di grup).
  const existing = getSession(chatId);
  if (existing && Date.now() > existing.expiresAt) clearSession(chatId);

  const rest = b.slice('!mahjong'.length).trim();
  const args = rest.split(/\s+/);
  const cmd = (args[0] || '').toLowerCase();

  // Info / kontrol yang boleh jalan di PM (tidak membuat sesi game).
  if (!isGroup) {
    if (cmd === 'help' || cmd === 'bantu' || cmd === 'stat') {
      if (cmd === 'stat') return showStat(sock, msg, chatId, senderJid);
      await sock.sendMessage(chatId, { text: showHelp() }, { quoted: msg });
      return true;
    }
    return sock.sendMessage(chatId, { text: '🀄 Mahjong hanya bisa dimainkan di grup WhatsApp. Buat/ikuti grup lalu coba lagi.' }, { quoted: msg });
  }

  // ── GRUP: sub-perintah setup / kontrol. (Pembuatan sesi baru diblokir
  //    terpisah di bawah agar `batal` selalu bisa jalan saat game berjalan.)
  if (!cmd || cmd === 'help' || cmd === 'bantu') {
    await sock.sendMessage(chatId, { text: showHelp() }, { quoted: msg });
    return true;
  }

  if (cmd === 'batal' || cmd === 'cancel' || cmd === 'stop') {
    return cancelSession(sock, chatId, senderJid);
  }
  if (cmd === 'join') {
    return joinMulti(sock, msg, chatId, senderJid, senderName);
  }
  if (cmd === 'mulai' || cmd === 'start') {
    return startMulti(sock, msg, chatId, senderJid);
  }
  if (cmd === 'solo' || cmd === 'bot') {
    return startSolo(sock, msg, chatId, senderJid, senderName, args[1]);
  }
  if (cmd === 'stat') {
    return showStat(sock, msg, chatId, senderJid);
  }

  // ── Pembuatan sesi baru: tolak bila ada game sedang berjalan.
  const current = getSession(chatId);
  if (current && current.phase === 'playing') {
    return sock.sendMessage(chatId, { text: '⏳ Ada permainan Mahjong sedang berjalan di grup ini. Ketik *!mahjong batal* untuk membatalkan.' }, { quoted: msg });
  }

  // ── Ante + mode: !mahjong <ante> [solo | @tag...]
  const ante = parseAnte(cmd);
  if (!ante) {
    return sock.sendMessage(chatId, { text: `⚠️ Format salah. Gunakan:\n• *!mahjong <ante> solo* — main lawan bot\n• *!mahjong <ante> @pemain...* — undang 1-3 pemain\nAnte: ${ANTES.join(' / ')} money. Ketik *!mahjong help* untuk panduan.` }, { quoted: msg });
  }

  // Ambil mention (tag) dari pesan.
  const mentions = await resolveMentionedJids(msg, body, sock, chatId);
  const tags = mentions.filter(j => !sameUser(j, senderJid)); // buang creator sendiri

  // Mode solo: !mahjong <ante> solo <...>
  const second = (args[1] || '').toLowerCase();
  if (second === 'solo' || second === 'bot') {
    return startSolo(sock, msg, chatId, senderJid, senderName, String(ante));
  }

  // Mode multi: butuh minimal 1 tag (undangan).
  if (tags.length === 0) {
    return sock.sendMessage(chatId, { text: `⚠️ Pilih mode:\n• *!mahjong ${ante} solo* — main lawan bot\n• *!mahjong ${ante} @pemain1* @pemain2 @pemain3 — undang maks ${MAX_PLAYERS - 1} pemain.` }, { quoted: msg });
  }
  if (tags.length > MAX_PLAYERS - 1) {
    return sock.sendMessage(chatId, { text: `❌ Maksimal ${MAX_PLAYERS - 1} undangan (total ${MAX_PLAYERS} pemain).` }, { quoted: msg });
  }

  return setupMulti(sock, msg, chatId, senderJid, senderName, ante, tags);
}

// pars angka ante; return null bila tidak valid.
function parseAnte(raw) {
  if (!raw) return null;
  const n = parsePositiveAmount(raw);
  return n !== null && ANTES.includes(n) ? n : null;
}

// ─── SETUP MULTI (room undangan) ─────────────────────────
// Sesi multi: fase 'menu' menunggu undangan join. Creator + invited (maks 3).
// Room di-resolve otomatis setelah 45 dtk atau saat semua undangan masuk.

async function setupMulti(sock, msg, chatId, senderJid, senderName, ante, invited) {
  // Abaikan room menu lama yang belum dimulai.
  const old = getSession(chatId);
  if (old && old.phase === 'menu') clearSession(chatId);

  const s = {
    mode: 'multi',
    phase: 'menu',
    chatId,
    ante,
    creator: senderJid,
    invited,                                   // JID yang diundang (boleh join)
    joined: [{ jid: senderJid, name: senderName, hand: [] }], // creator otomatis
    players: [],                               // = isi joined saat mulai
    expiresAt: Date.now() + ROOM_TIMEOUT_MS,
    timer: null, ronTimer: null,
  };
  setSession(chatId, s);
  s.timer = setTimeout(() => resolveRoom(sock, chatId), ROOM_TIMEOUT_MS);

  await renderRoom(sock, msg, chatId, s, `Meja dibuat. ${getNumber(senderJid)} dipanggil: ${invited.map(j => '@' + getNumber(j)).join(', ')}. Undangan join dalam 45 detik.`);
  return true;
}

async function renderRoom(sock, msg, chatId, s, note) {
  const lines = [
    ui.kv(`🎌 Mode`, 'Multiplayer (group)'),
    ui.kv(`💰 Ante`, `${ui.money(s.ante)} money / pemain`),
    ui.kv(`⏳ Sisa`, `${Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000))} dtk`),
    ui.divider(),
    `Sudah join (${s.joined.length}/${MAX_PLAYERS}):`,
    ...s.joined.map((p, i) => ui.bullet(`${i + 1}. @${getNumber(p.jid)}${sameUser(p.jid, s.creator) ? ' (creator)' : ''}`)),
    ui.divider(),
    `Diundang (${s.invited.length}): ${s.invited.map(j => '@' + getNumber(j)).join(', ')}`,
    ``,
    `*!mahjong join* untuk ikut (hanya yang diundang).`,
    `Creator: *!mahjong mulai* (butuh ≥ ${MIN_PLAYERS} pemain) atau tunggu auto-start.`,
  ];
  if (note) lines.unshift(note, ui.divider());

  await sendMenu(sock, chatId, {
    text: ui.box('🀄 MAHJONG — Room Undangan', lines),
    footer: `🀄 Mahjong — ${s.joined.length} pemain`,
    quoted: msg,
    mentions: [...s.joined.map(p => p.jid), ...s.invited],
    fallbackText: ui.box('🀄 MAHJONG — Room Undangan', lines),
    buttons: [
      quickReply('!mahjong join', '➕ Join'),
      quickReply('!mahjong mulai', '▶️ Mulai'),
    ],
  });
}

async function joinMulti(sock, msg, chatId, senderJid, senderName) {
  let s = getSession(chatId);
  if (!s || s.phase !== 'menu' || s.mode !== 'multi') {
    return sock.sendMessage(chatId, { text: '❌ Tidak ada room Mahjong yang menunggu. Buat dengan *!mahjong <ante> @pemain*. Ketik *!mahjong* untuk panduan.' }, { quoted: msg });
  }
  if (s.joined.some(p => sameUser(p.jid, senderJid))) {
    return sock.sendMessage(chatId, { text: '✅ Kamu sudah di room ini.' }, { quoted: msg });
  }
  // Hanya yang diundang yang boleh join.
  if (!s.invited.some(j => sameUser(j, senderJid))) {
    return sock.sendMessage(chatId, { text: '⛔ Kamu tidak diundang ke room ini. Minta creator membuat room baru dengan menandamu.' }, { quoted: msg });
  }
  if (s.joined.length >= MAX_PLAYERS) {
    return sock.sendMessage(chatId, { text: `❌ Meja penuh (${MAX_PLAYERS} pemain).` }, { quoted: msg });
  }
  s.joined.push({ jid: senderJid, name: senderName, hand: [] });
  s.expiresAt = Date.now() + ROOM_TIMEOUT_MS; // reset timer tiap join

  await renderRoom(sock, msg, chatId, s, `✅ @${getNumber(senderJid)} bergabung.`);

  // Auto-start: semua undangan sudah masuk.
  const allInvitedIn = s.invited.every(inv => s.joined.some(p => sameUser(p.jid, inv)));
  if (allInvitedIn && s.joined.length >= MIN_PLAYERS) {
    clearRoomTimer(s);
    s.joined.forEach(p => s.players.push(p));
    await beginGame(sock, msg, chatId, s);
  }
  return true;
}

async function startMulti(sock, msg, chatId, senderJid) {
  const s = getSession(chatId);
  if (!s || s.phase !== 'menu' || s.mode !== 'multi') {
    return sock.sendMessage(chatId, { text: '❌ Tidak ada room Mahjong siap dimulai.' }, { quoted: msg });
  }
  if (!sameUser(s.creator, senderJid)) {
    return sock.sendMessage(chatId, { text: '⚠️ Hanya creator room yang bisa memulai.' }, { quoted: msg });
  }
  if (s.joined.length < MIN_PLAYERS) {
    return sock.sendMessage(chatId, { text: `❌ Butuh minimal ${MIN_PLAYERS} pemain (${s.joined.length} sekarang).` }, { quoted: msg });
  }
  clearRoomTimer(s);
  s.joined.forEach(p => s.players.push(p));
  return beginGame(sock, msg, chatId, s);
}

// Auto-resolve saat timer 45 dtk habis.
function resolveRoom(sock, chatId) {
  const s = getSession(chatId);
  if (!s || s.phase !== 'menu' || s.mode !== 'multi') return;
  s.timer = null;
  if (s.joined.length < MIN_PLAYERS) {
    sock.sendMessage(chatId, { text: `⏹️ Room Mahjong dibatalkan. Tidak cukup pemain (${s.joined.length} < ${MIN_PLAYERS}). Sebar ante/uang tidak dipotong.` }).catch(() => {});
    clearSession(chatId);
    return;
  }
  s.joined.forEach(p => s.players.push(p));
  beginGame(sock, null, chatId, s).catch(() => {});
}

function clearRoomTimer(s) {
  if (s && s.timer) { clearTimeout(s.timer); s.timer = null; }
}

// ─── MULAI GAME (solo & multi sama) ──────────────────────
async function startSolo(sock, msg, chatId, senderJid, senderName, anteRaw) {
  // Hanya di grup (guard di handleMahjong sudah blokir PM).
  const active = getSession(chatId);
  if (active && active.phase === 'playing') {
    return sock.sendMessage(chatId, { text: '⏳ Ada permainan Mahjong sedang berjalan. Ketik *!mahjong batal* untuk membatalkan.' }, { quoted: msg });
  }
  // Room menu lama yang belum dimulai → buang, mulai solo baru.
  if (active && active.phase === 'menu') clearSession(chatId);

  const ante = parseAnte(anteRaw) || 100;
  const s = {
    mode: 'solo',
    phase: 'ready',
    chatId,
    ante,
    players: [{ jid: senderJid, name: senderName, hand: [] }],
    creator: senderJid,
    expiresAt: Date.now() + 10 * 60 * 1000,
    timer: null, ronTimer: null,
  };
  setSession(chatId, s);
  return beginGame(sock, msg, chatId, s);
}

// Bagikan kartu, reserve ante semua pemain, mulai giliran.
async function beginGame(sock, msg, chatId, s) {
  // Bot index bila solo.
  const isSolo = s.mode === 'solo';

  // Reserve ante (anti-inflasi).
  const allReserved = [];
  for (const p of s.players) {
    const bal = getUserMoney(p.jid);
    if (bal < s.ante) {
      const names = s.players.map(x => `@${getNumber(x.jid)}`).join(', ');
      clearSession(chatId);
      return sock.sendMessage(chatId, { text: `❌ @${getNumber(p.jid)} saldo tidak cukup (butuh ${ui.money(s.ante)}). Game dibatalkan.`, mentions: s.players.map(x => x.jid) }, { quoted: msg });
    }
  }
  for (const p of s.players) {
    if (deductMoney(p.jid, s.ante)) allReserved.push(p.jid);
  }

  // Bangun wall + bagikan hand manusia.
  // ponytail: privasi hand tidak dijaga ketat — satu board dibroadcast ke semua
  // member grup, jadi hand pemain giliran terlihat. Kirim pesan privat per pemain
  // bila privasi multipemain dibutuhkan.
  const wall = eng.createWall();
  for (const p of s.players) {
    p.hand = eng.dealHand(wall);
  }

  // Tambah bot di solo setelah wall disiapkan (biar wall tetap konsisten).
  if (isSolo) {
    const bot = { jid: 'bot', name: '🤖 Bot', hand: eng.dealHand(wall) };
    s.players.push(bot);
  }

  // Pot = total ante.
  s.pot = s.ante * s.players.length;
  s.wall = wall;
  s.phase = 'playing';
  s.drawnTile = null;
  s.stage = 'await_draw'; // giliran aktif harus draw dulu
  s.lastDiscard = null;
  s.discarder = null;
  s.round = 1;
  s.wins = {};
  s.reserved = allReserved;

  // Dealer acak.
  s.current = Math.floor(Math.random() * s.players.length);
  s.expiresAt = Date.now() + 10 * 60 * 1000;

  if (isSolo && s.players[s.current].jid === 'bot') {
    // Bot mulai duluan.
    await botPlayTurn(sock, chatId);
  } else {
    scheduleTurn(sock, chatId);
    await renderStatus(sock, chatId, `🎌 Game dimulai! Giliran @${getNumber(s.players[s.current].jid)} ketik *!draw*.`);
  }
  return true;
}

// ─── AKSI ────────────────────────────────────────────────
async function handleAction(sock, msg, chatId, isGroup, senderJid, b) {
  const s = getSession(chatId);
  if (!s || s.phase !== 'playing') return false; // bukan sesi aktif → biarkan handler lain

  if (/^!lanjut/.test(b)) {
    if (s.stage === 'ron') {
      clearRon(sock, chatId);
      return proceedAfterRon(sock, chatId);
    }
    return true;
  }

  if (/^!(menang|ron|tsumo)\b/.test(b)) {
    return declareWin(sock, msg, chatId, s, senderJid);
  }

  if (/^!draw\b/.test(b)) {
    return doDraw(sock, msg, chatId, s, senderJid);
  }

  if (/^!(dis|discard)\b/.test(b)) {
    const tile = b.split(/\s+/)[1] || '';
    return doDiscard(sock, msg, chatId, s, senderJid, tile);
  }

  return false;
}

function isTurn(s, jid) {
  const p = s.players[s.current];
  return p && sameUser(p.jid, jid);
}

async function doDraw(sock, msg, chatId, s, senderJid) {
  if (!isTurn(s, senderJid)) {
    return sock.sendMessage(chatId, { text: '⚠️ Bukan giliranmu untuk melakukan draw.' }, { quoted: msg });
  }
  if (s.stage === 'ron') {
    return sock.sendMessage(chatId, { text: '⏳ Sedang ada jendela Ron. Ketik *!lanjut* untuk lanjut.' }, { quoted: msg });
  }
  if (s.stage !== 'await_draw') {
    return sock.sendMessage(chatId, { text: '⚠️ Kamu sudah menarik tile. Buang satu: *!dis <kode>*.' }, { quoted: msg });
  }

  clearTurn(sock, chatId);
  if (eng.isWallEmpty(s.wall)) {
    // Wall habis → draw (tidak ada yang menang). Kembalikan ante.
    return endGame(sock, chatId, s, null, 'Wall habis tanpa pemenang.');
  }

  const { tile } = eng.draw(s.wall);
  s.drawnTile = tile;
  s.stage = 'await_discard';

  const p = s.players[s.current];
  p.hand = [...p.hand, tile];

  if (eng.isWinningHand(p.hand)) {
    // Tsumo! Tampilkan opsi menang.
    scheduleTurn(sock, chatId);
    await renderStatus(sock, chatId, `🀄 Hand kamu sudah lengkap! Ketik *!menang* untuk TSUMO, atau *!dis <kode>* untuk buang.`);
  } else {
    scheduleTurn(sock, chatId);
    await renderStatus(sock, chatId, `Ambil tile *${eng.tileLabel(tile)}*. Buang satu: *!dis <kode>* atau pilih tombol di bawah.`);
  }
  return true;
}

async function doDiscard(sock, msg, chatId, s, senderJid, tileStr) {
  // Saat ron, hanya orang LEWAT boleh lanjut; discard oleh pemain turn saat await_discard.
  if (s.stage === 'ron') {
    return sock.sendMessage(chatId, { text: '⏳ Sedang ada jendela Ron. Ketik *!lanjut* untuk lanjut.' }, { quoted: msg });
  }

  const p = s.players[s.current];
  const isDiscarder = sameUser(p.jid, senderJid);

  // Hanya pemain yang giliran bisa discard (saat await_discard punya drawnTile).
  if (!sameUser(p.jid, senderJid)) {
    return sock.sendMessage(chatId, { text: '⚠️ Bukan giliranmu untuk membuang tile.' }, { quoted: msg });
  }
  if (s.stage !== 'await_discard' || !s.drawnTile) {
    return sock.sendMessage(chatId, { text: '⚠️ Belum ada tile yang bisa dibuang. Ketik *!draw* dulu.' }, { quoted: msg });
  }

  if (!eng.parseTile(tileStr)) {
    return sock.sendMessage(chatId, { text: `⚠️ Kode tile tidak dikenal. Contoh: *!dis m5*, *!dis p1*, *!dis s9*.` }, { quoted: msg });
  }

  const res = eng.discard(p.hand, tileStr);
  if (!res.ok) {
    return sock.sendMessage(chatId, { text: `❌ Kamu tidak punya tile *${eng.tileLabel(tileStr)}* di hand.` }, { quoted: msg });
  }
  p.hand = res.hand;
  s.drawnTile = null;
  s.lastDiscard = tileStr;
  s.discarder = s.current;

  clearTurn(sock, chatId);

  // Cek siapa yang bisa RON dari tile discard.
  const canRon = [];
  for (let i = 0; i < s.players.length; i++) {
    if (i === s.current) continue;
    if (eng.canWinWith(s.players[i].hand, tileStr)) canRon.push(i);
  }

  if (canRon.length > 0) {
    // Jendela ron.
    s.stage = 'ron';
    s.ronCandidates = canRon;
    scheduleRon(sock, chatId);
    const tags = canRon.map(i => `@${getNumber(s.players[i].jid)}`).join(', ');
    await renderStatus(sock, chatId, `@${getNumber(p.jid)} buang *${eng.tileLabel(tileStr)}*. ${tags} bisa RON! Ketik *!menang* atau *!lanjut*.`);
    return true;
  }

  // Tidak ada ron → next player.
  return advanceToNextTurn(sock, chatId, s);
}

async function advanceToNextTurn(sock, chatId, s) {
  s.stage = 'await_draw';
  s.drawnTile = null;
  s.lastDiscard = null;
  s.discarder = null;

  // Maju ke pemain berikutnya (skala by penambahan 1; bot di-skip memakai alur).
  s.current = (s.current + 1) % s.players.length;

  if (s.players[s.current].jid === 'bot') {
    await botPlayTurn(sock, chatId);
    return true;
  }

  scheduleTurn(sock, chatId);
  await renderStatus(sock, chatId, `Giliran @${getNumber(s.players[s.current].jid)} — ketik *!draw*.`);
  return true;
}

// Lanjutkan setelah jendela ron (tanpa ada yang menang).
async function proceedAfterRon(sock, chatId) {
  const s = getSession(chatId);
  if (!s || s.phase !== 'playing') return;
  clearRon(sock, chatId);
  s.stage = 'await_draw';
  s.drawnTile = null;
  s.ronCandidates = [];
  s.lastDiscard = null;
  s.discarder = null;
  return advanceToNextTurn(sock, chatId, s);
}

// ─── MENANG ──────────────────────────────────────────────
async function declareWin(sock, msg, chatId, s, senderJid) {
  let winType = null;
  let winnerIdx = -1;

  // Tsumo: pemain giliran, stage await_discard, hand ada drawnTile dan menang.
  if (isTurn(s, senderJid) && s.stage === 'await_discard' && s.drawnTile && eng.isWinningHand(s.players[s.current].hand)) {
    winType = 'tsumo';
    winnerIdx = s.current;
  }
  // Ron: dalam jendela ron, hand-nya bisa menang dengan lastDiscard.
  else if (s.stage === 'ron' && s.lastDiscard) {
    winnerIdx = s.players.findIndex((p, i) => sameUser(p.jid, senderJid) && i !== s.discarder && eng.canWinWith(p.hand, s.lastDiscard));
    if (winnerIdx >= 0) winType = 'ron';
  }

  if (winType === null) {
    return sock.sendMessage(chatId, { text: '❌ Hand kamu belum lengkap untuk menang.' }, { quoted: msg });
  }

  clearRon(sock, chatId);
  clearTurn(sock, chatId);
  const winner = s.players[winnerIdx];
  const discarder = s.discarder !== null ? s.players[s.discarder] : null;

  const methodText = winType === 'tsumo'
    ? `TSUMO 🀄` + (winner.jid === 'bot' ? ' Bot menang!' : ` — @${getNumber(winner.jid)} menang!`)
    : `RON 🀄` + (winner.jid === 'bot' ? ' Bot menang!' : ` — @${getNumber(winner.jid)} ron dari ${discarder && discarder.jid !== 'bot' ? '@' + getNumber(discarder.jid) : 'Bot'}!`);

  return endGame(sock, chatId, s, winnerIdx, methodText);
}

// ─── END GAME & PAYOUT ───────────────────────────────────
async function endGame(sock, chatId, s, winnerIdx, reason) {
  clearRon(sock, chatId);
  clearTurn(sock, chatId);

  const lines = [reason.split('\n')[0]];
  const pot = s.pot;

  if (winnerIdx !== null && winnerIdx !== undefined) {
    // 1 pemenang ambil semua pot.
    const winner = s.players[winnerIdx];
    if (winner.jid !== 'bot') {
      addMoney(winner.jid, pot);
      const st = getMahjongStats(winner.jid) || {};
      updateMahjongStats(winner.jid, { wins: 1, moneyEarned: pot });
    }
    for (const pl of s.players) {
      if (pl.jid === 'bot' || sameUser(pl.jid, winner.jid)) continue;
      updateMahjongStats(pl.jid, { losses: 1, moneyLost: s.ante });
    }
    lines.push(ui.divider());
    lines.push(`💰 Pot: ${ui.money(pot)} money`);
    const wt = winner.jid === 'bot' ? '🤖 Bot' : `@${getNumber(winner.jid)}`;
    lines.push(`${wt} menerima ${ui.money(pot)} money!`);
    if (winner.jid === 'bot') {
      for (const pl of s.players) {
        if (pl.jid === 'bot') continue;
        updateMahjongStats(pl.jid, { losses: 1, moneyLost: s.ante });
      }
    }
  } else {
    // Draw: kembalikan ante semua pemain non-bot.
    for (const pl of s.players) {
      if (pl.jid === 'bot') continue;
      addMoney(pl.jid, s.ante);
      updateMahjongStats(pl.jid, { draws: 1 });
    }
    lines.push(ui.divider());
    lines.push(`🤝 Hasil seri — ante ${ui.money(s.ante)} dikembalikan ke semua pemain.`);
  }

  await sock.sendMessage(chatId, { text: ui.box('🏁 MAHJONG Selesai', lines) }, { quoted: null });
  clearSession(chatId);
  return true;
}

// ─── AUTO (timeout) ──────────────────────────────────────
async function autoResolveTurn(sock, chatId) {
  const s = getSession(chatId);
  if (!s || s.phase !== 'playing') return;

  // Giliran habis (tidak draw / tidak discard): buang acak / draw lalu buang acak.
  if (s.players[s.current].jid === 'bot') return; // bot tak pernah timeout

  if (s.stage === 'await_discard' && s.drawnTile) {
    // Belum buang → buang acak lalu lanjut seperti doDiscard.
    const disc = eng.bestDiscard(s.players[s.current].hand);
    s.players[s.current].hand = disc.hand;
    s.drawnTile = null;
    s.lastDiscard = disc.tile;
    s.discarder = s.current;
    const canRon = [];
    for (let i = 0; i < s.players.length; i++) {
      if (i === s.current) continue;
      if (eng.canWinWith(s.players[i].hand, disc.tile)) canRon.push(i);
    }
    if (canRon.length > 0) {
      s.stage = 'ron';
      s.ronCandidates = canRon;
      scheduleRon(sock, chatId);
      const tags = canRon.map(i => `@${getNumber(s.players[i].jid)}`).join(', ');
      return renderStatus(sock, chatId, `⏰ @${getNumber(s.players[s.current].jid)} timeout, buang *${eng.tileLabel(disc.tile)}*. ${tags} bisa RON atau *!lanjut*.`);
    }
    return advanceToNextTurn(sock, chatId, s);
  } else {
    // Belum draw → draw otomatis.
    if (eng.isWallEmpty(s.wall)) return endGame(sock, chatId, s, null, 'Wall habis tanpa pemenang.');
    const { tile } = eng.draw(s.wall);
    const p = s.players[s.current];
    p.hand = [...p.hand, tile];
    s.drawnTile = tile;
    s.stage = 'await_discard';
    // Auto discard acak.
    const disc = eng.bestDiscard(p.hand);
    p.hand = disc.hand;
    s.drawnTile = null;
    s.lastDiscard = disc.tile;
    s.discarder = s.current;
    const canRon = [];
    for (let i = 0; i < s.players.length; i++) {
      if (i === s.current) continue;
      if (eng.canWinWith(s.players[i].hand, disc.tile)) canRon.push(i);
    }
    if (canRon.length > 0) {
      s.stage = 'ron';
      s.ronCandidates = canRon;
      scheduleRon(sock, chatId);
      const tags = canRon.map(i => `@${getNumber(s.players[i].jid)}`).join(', ');
      return renderStatus(sock, chatId, `⏰ @${getNumber(s.players[s.current].jid)} timeout, ambil *${eng.tileLabel(tile)}*, buang *${eng.tileLabel(disc.tile)}*. ${tags} bisa RON atau *!lanjut*.`);
    }
    return advanceToNextTurn(sock, chatId, s);
  }
}

// Bot main satu giliran penuh (draw + discard/win) lalu lanjut ke next pemain.
async function botPlayTurn(sock, chatId) {
  const s = getSession(chatId);
  if (!s) return;

  // Ambil 1 tile.
  if (eng.isWallEmpty(s.wall)) return endGame(sock, chatId, s, null, 'Wall habis tanpa pemenang.');
  const { tile } = eng.draw(s.wall);
  const bot = s.players[s.current];
  bot.hand = [...bot.hand, tile];

  if (eng.isWinningHand(bot.hand)) {
    // Bot tsumo.
    return endGame(sock, chatId, s, s.current, '🤖 Bot TSUMO!');
  }

  const disc = eng.bestDiscard(bot.hand);
  bot.hand = disc.hand;
  s.drawnTile = null;
  s.lastDiscard = disc.tile;
  s.discarder = s.current;

  // Cek ron manusia dari tile bot.
  const canRon = [];
  for (let i = 0; i < s.players.length; i++) {
    if (i === s.current) continue;
    if (eng.canWinWith(s.players[i].hand, disc.tile)) canRon.push(i);
  }

  if (canRon.length > 0) {
    s.stage = 'ron';
    s.ronCandidates = canRon;
    scheduleRon(sock, chatId);
    const tags = canRon.map(i => `@${getNumber(s.players[i].jid)}`).join(', ');
    return renderStatus(sock, chatId, `🤖 Bot buang *${eng.tileLabel(disc.tile)}*. ${tags} bisa RON! Ketik *!menang* atau *!lanjut*.`);
  }

  return advanceToNextTurn(sock, chatId, s);
}

// ─── RENDER ──────────────────────────────────────────────
async function renderStatus(sock, chatId, footerText) {
  const s = getSession(chatId);
  if (!s || s.phase !== 'playing') return;

  const current = s.players[s.current];
  const isBot = current.jid === 'bot';
  const curTag = isBot ? '🤖 Bot' : `@${getNumber(current.jid)}`;

  const lines = [
    ui.kv(`🀄 Wall`, `${s.wall.length} tile`),
    ui.kv(`💰 Pot`, `${ui.money(s.pot)} money`),
    ui.kv(`🎌 Mode`, s.mode === 'solo' ? 'Solo vs Bot' : `Multi (${s.players.length})`),
    ui.divider(),
    `Pemain:`,
    ...s.players.map((p, i) => ui.bullet(`${i + 1}. ${p.jid === 'bot' ? '🤖 Bot' : `@${getNumber(p.jid)}`}` + (i === s.current ? ' ▶️' : '')))
  ];

  // Hand pemain aktif (awali dari discarder saat jendela ron).
  {
    const handLabel = eng.formatHand(current.hand);
    lines.push(ui.section(`Hand ${curTag} [${current.hand.length}]`));
    lines.push(handLabel ? handLabel.split(' ').slice(0, 14).join(' ') : '(kosong)');
    if (s.drawnTile) lines.push(`Terakhir ambil: *${eng.tileLabel(s.drawnTile)}*`);
  }

  if (s.lastDiscard) {
    lines.push(ui.divider());
    lines.push(`Buang terakhir: *${eng.tileLabel(s.lastDiscard)}*`);
  }

  const text = ui.box('🀄 MAHJONG', lines, footerText || '');

  const buttons = [];
  const curJid = current.jid;

  // Giliran aktif: sediakan tombol Draw / Buang untuk pemain giliran.
  if (!isBot) {
    if (s.stage === 'await_draw') {
      buttons.push(quickReply('!draw', '🀄 Draw'));
    } else if (s.stage === 'await_discard') {
      const uniqueTiles = [...new Set(current.hand.map(t => t))].sort();
      buttons.push(listButton('🀄 Buang Tile', [{
        title: 'Pilih tile',
        rows: uniqueTiles.slice(0, 10).map(t => ({ title: eng.tileLabel(t), id: `!dis ${t}` })),
      }]));
      if (eng.isWinningHand(current.hand)) buttons.push(quickReply('!menang', '🏆 Tsumo'));
    }
  }

  // Jendela ron: beri tahu pemain yang berhak + tombol lanjut.
  if (s.stage === 'ron') {
    buttons.push(quickReply('!lanjut', '⏩ Lanjut'));
  }

  await sendMenu(sock, chatId, {
    text,
    footer: `🀄 Mahjong — ${curTag}`,
    quoted: null,
    mentions: s.players.filter(p => p.jid !== 'bot').map(p => p.jid),
    fallbackText: text,
    buttons: buttons.slice(0, 4), // WhatsApp batas tombol per pesan
  });
}

// ─── STAT / CANCEL / HELP ────────────────────────────────
async function showStat(sock, msg, chatId, senderJid) {
  const st = getMahjongStats(senderJid);
  if (!st) {
    return sock.sendMessage(chatId, { text: '❌ Belum ada riwayat Mahjong.' }, { quoted: msg });
  }
  const lines = [
    ui.kv(`🏆 Menang`, `${st.wins || 0}`),
    ui.kv(`💀 Kalah`, `${st.losses || 0}`),
    ui.kv(`🤝 Seri`, `${st.draws || 0}`),
    ui.divider(),
    ui.kv(`💰 Total Menang`, `${ui.money(st.moneyEarned || 0)}`),
    ui.kv(`💸 Total Kalah`, `${ui.money(st.moneyLost || 0)}`),
  ];
  return sock.sendMessage(chatId, { text: ui.box('📊 STATISTIK MAHJONG', lines) }, { quoted: msg });
}

async function cancelSession(sock, chatId, senderJid) {
  const s = getSession(chatId);
  if (!s) {
    return sock.sendMessage(chatId, { text: '❌ Tidak ada sesi Mahjong aktif.' }, { quoted: msg });
  }
  if (!sameUser(s.creator, senderJid)) {
    return sock.sendMessage(chatId, { text: '⚠️ Hanya creator yang bisa membatalkan sesi Mahjong.' }, { quoted: msg });
  }
  // Refund ante yang sudah di-reserve (hanya saat phase playing).
  if (s.reserved) {
    for (const jid of s.reserved) addMoney(jid, s.ante);
  }
  clearSession(chatId);
  return sock.sendMessage(chatId, { text: s.phase === 'menu' ? '✅ Room Mahjong dibatalkan. Ante belum dipotong.' : '✅ Sesi Mahjong dibatalkan. Taruhan dikembalikan.' });
}

function showHelp() {
  return ui.box('🀄 *PANDUAN MAHJONG*', [
    `Main sederhana: susun *4 set + 1 pair* (tanpa chi/pon/kan).`,
    `Tile: M (Man), P (Pin), S (Sou) 1-9. Contoh: M5, P1, S9.`,
    `*Hanya bisa dimainkan di grup.*`,
    ``,
    ui.section('Mode Solo (vs Bot)'),
    ui.cmd('!mahjong <ante> solo', 'Main lawan bot. Ante: 100/500/1000/5000'),
    ``,
    ui.section('Mode Multi (Undangan)'),
    ui.cmd('!mahjong <ante> @p1 @p2 @p3', 'Buat room, undang maks 3 pemain'),
    ui.cmd('!mahjong join', 'Ikut room (hanya yang diundang)'),
    ui.cmd('!mahjong mulai', 'Mulai sekarang (creator, butuh ≥ 2 pemain)'),
    ui.cmd('!mahjong batal', 'Batalkan & refund ante'),
    `Room auto-mulai saat semua undangan join, atau setelah 45 detik bila sudah ≥ 2 pemain.`,
    ``,
    ui.section('Info'),
    ui.cmd('!mahjong stat', 'Lihat statistik'),
    ui.cmd('!mahjong', 'Tampilkan panduan ini'),
    ``,
    ui.section('Giliran'),
    ui.cmd('!draw', 'Ambil 1 tile dari wall'),
    ui.cmd('!dis <kode>', `Buang tile (mis. *!dis m5*)`),
    ui.cmd('!menang', 'Deklarasi menang (tsumo/ron)'),
    ui.cmd('!lanjut', 'Skip jendela ron'),
    ``,
    ui.divider(),
    `1 pemenang ambil seluruh pot. Wall habis = seri, ante kembali.`,
  ]);
}

module.exports = { handleMahjong };
