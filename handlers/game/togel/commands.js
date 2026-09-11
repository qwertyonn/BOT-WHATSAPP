// handlers/game/togel/commands.js
// Game Togel: tebak 2-4 digit, cocok dari belakang nomor keluar.
// Pot = akumulasi semua taruhan; hadiah per taruhan yang cocok = pot × pengali.
// Tanpa pemenang → pot lanjut ke round berikutnya (jackpot).
// Draw: otomatis 1 menit setelah taruhan terakhir, atau owner !togel buka.
// EV sangat tinggi — game ini memberi keuntungan besar ke pemain.
const ui = require('../../../utils/ui');
const { TOGEL_CONFIG } = require('../../../data/togelData');
const { validateBet, rollWinningNumber, summarizeRound } = require('../../../game/togelEngine');
const { sameUser, getNumber } = require('../../../utils/jid');
const { parsePositiveAmount } = require('../../../utils/amount');
const { sendCasinoMsg } = require('../casino/commands');
const {
  getUserMoney, addMoney, deductMoney,
  getTogelRound, setTogelRound,
  getTogelStats, updateTogelStats, getAllTogelStats,
  getTogelHistory, addTogelHistory,
} = require('../../../data/db');

function fmt(n) {
  return ui.money(n);
}

function digitLabel(numbers) {
  return `${String(numbers).length}D`;
}

// ─── AUTO DRAW TIMER ─────────────────────────────────────────
// Taruhan memicu hitung mundur; timer di-reset setiap taruhan baru.
// autoDrawAt di-persist ke round supaya kebal restart (arming ulang
// saat ada pesan !togel berikutnya via checkPendingAutoDraw).
const AUTO_DRAW_MS = 1 * 60 * 1000; // 1 menit
const togelTimers  = new Map();     // chatId -> handle setTimeout

function clearTogelTimer(chatId) {
  const t = togelTimers.get(chatId);
  if (t) {
    clearTimeout(t);
    togelTimers.delete(chatId);
  }
}

function scheduleAutoDraw(sock, chatId, msRemaining) {
  clearTogelTimer(chatId);
  const ms = Math.max(0, msRemaining);
  const handle = setTimeout(() => {
    togelTimers.delete(chatId);
    executeDraw(sock, chatId).catch(err => console.error('❌ Error auto-draw togel:', err));
  }, ms);
  if (handle.unref) handle.unref();
  togelTimers.set(chatId, handle);
}

// Cek & lanjutkan timer yang tersimpan (dipakai setelah restart).
function checkPendingAutoDraw(sock, chatId) {
  const round = getTogelRound(chatId);
  if (!round || round.winningNumber || !round.autoDrawAt) return;
  if (!Object.keys(round.bets || {}).length) return;

  const remain = round.autoDrawAt - Date.now();
  if (remain <= 0) {
    executeDraw(sock, chatId).catch(err => console.error('❌ Error auto-draw togel:', err));
  } else {
    scheduleAutoDraw(sock, chatId, remain);
  }
}

function getOrCreateRound(chatId) {
  let round = getTogelRound(chatId);
  if (!round) {
    round = { round: 1, createdAt: Date.now(), bets: {}, pot: 0, winningNumber: null, drawnAt: null, autoDrawAt: null, noWinStreak: 0 };
    setTogelRound(chatId, round);
  }
  // Amankan field pot untuk round lama yang belum punya
  if (typeof round.pot !== 'number') round.pot = 0;
  return round;
}

// ─── MENU / INFO ────────────────────────────────────────────
function showMenu() {
  return ui.box('🎰 *TOGEL TEBAK ANGKA*', [
    `Tebak 2-4 digit, cocok dari belakang!`,
    ``,
    `*Hadiah = Pot × pengali*`,
    ui.bullet('4D (4 digit cocok)', `→ pot × ${fmt(TOGEL_CONFIG.prize[4])}`),
    ui.bullet('3D (3 digit cocok)', `→ pot × ${fmt(TOGEL_CONFIG.prize[3])}`),
    ui.bullet('2D (2 digit cocok)', `→ pot × ${fmt(TOGEL_CONFIG.prize[2])}`),
    ``,
    `💡 *Pot* = semua taruhan terkumpul di round ini (termasuk yang kalah).`,
    `Besar taruhan tidak memengaruhi hadiah — yang penting tebakanmu cocok.`,
    `Hanya *1 digit* cocok → tidak menang.`,
    `💣 Tanpa pemenang, *pot lanjut* ke round berikutnya (jackpot makin besar).`,
    `🚨 Pot *dihapus otomatis* setelah *5 ronde* tanpa pemenang.`,
    ``,
    `Nomor keluar *4829*:`,
    ui.bullet('Tebak `4829`', 'cocok 4 → menang 4D'),
    ui.bullet('Tebak `829`', 'cocok 3 → menang 3D'),
    ui.bullet('Tebak `29`', 'cocok 2 → menang 2D'),
    ui.bullet('Tebak `5829`', 'cocok 3 (829) → menang 3D'),
    ``,
    `Minimal taruhan *${fmt(TOGEL_CONFIG.minBet)}* money.`,
    `⏰ Buka otomatis *1 menit* setelah taruhan terakhir.`,
    ``,
    ui.section('💻 *PERINTAH*'),
    ui.cmd('!togel 1234 500', 'Tebak 4 digit + pasang 500'),
    ui.cmd('!togel 456 500', 'Tebak 3 digit + pasang 500'),
    ui.cmd('!togel 56 500', 'Tebak 2 digit + pasang 500'),
    ui.cmd('!togel list', 'Taruhan aktif kamu'),
    ui.cmd('!togel riwayat', 'Nomor keluar terakhir'),
    ui.cmd('!togel top', 'Leaderboard pemenang'),
    ui.cmd('!togel buka', '(Admin) Buka hasil togel'),
  ]);
}

// ─── PARSER TARUHAN ─────────────────────────────────────────
// Input: ['1234','500'] → { numbers:'1234', amount:500 }
function parseBet(args) {
  const rest = [...args];

  let amount = null;
  const lastArg = rest[rest.length - 1];
  if (lastArg !== undefined && lastArg !== '') {
    amount = parsePositiveAmount(lastArg);
    if (amount !== null) rest.pop();
  }
  const numbers = rest.join('').trim();

  return { numbers, amount };
}

// ─── EKSEKUSI TARUHAN ───────────────────────────────────────
function placeBet(sock, msg, chatId, senderJid, senderName, parsed) {
  const v = validateBet(parsed.numbers);
  if (!v.ok) {
    return sock.sendMessage(chatId, {
      text: `❌ ${v.reason}\nContoh: *!togel 1234 500* / *!togel 456 500*`,
    }, { quoted: msg });
  }
  if (!parsed.amount || parsed.amount < TOGEL_CONFIG.minBet) {
    return sock.sendMessage(chatId, {
      text: `❌ Minimal taruhan *${fmt(TOGEL_CONFIG.minBet)}* money.`,
    }, { quoted: msg });
  }
  if (!Number.isInteger(parsed.amount)) {
    return sock.sendMessage(chatId, {
      text: `❌ Jumlah taruhan harus bilangan bulat.`,
    }, { quoted: msg });
  }

  const balance = getUserMoney(senderJid);
  if (balance < parsed.amount) {
    return sock.sendMessage(chatId, {
      text: `❌ Saldo kamu tidak cukup. Sisa: ${fmt(balance)} money.`,
    }, { quoted: msg });
  }

  const round = getOrCreateRound(chatId);
  if (round.winningNumber) {
    return sock.sendMessage(chatId, {
      text: `⏳ Round ${round.round} sudah ditutup. Tunggu owner membuka round berikutnya.`,
    }, { quoted: msg });
  }

  if (!deductMoney(senderJid, parsed.amount)) {
    return sock.sendMessage(chatId, {
      text: `❌ Gagal memotong saldo. Coba lagi.`,
    }, { quoted: msg });
  }

  round.bets[senderJid] = round.bets[senderJid] || [];
  round.bets[senderJid].push({
    numbers: v.numbers,
    amount: parsed.amount, placedAt: Date.now(),
  });

  // Akumulasi ke pot (jackpot round ini)
  round.pot = (round.pot || 0) + parsed.amount;

  // Set timer auto-draw (di-reset setiap taruhan baru) & persist batas waktu
  round.autoDrawAt = Date.now() + AUTO_DRAW_MS;
  setTogelRound(chatId, round);
  scheduleAutoDraw(sock, chatId, AUTO_DRAW_MS);

  // Simpan nama untuk leaderboard
  const st = getTogelStats(senderJid);
  if (!st || !st.name) updateTogelStats(senderJid, { name: senderName });

  return sock.sendMessage(chatId, {
    text: ui.box('🎟️ TARUHAN MASUK', [
      ui.kv('👤 Pemain', senderName),
      ui.kv('🔢 Tebakan', v.numbers),
      ui.kv('💰 Pasang', `${fmt(parsed.amount)} money`),
      ui.kv('🎯 Pot', `${fmt(round.pot)} money`),
      ui.divider(),
      `Round ke-*${round.round}*.`,
      `Hadiah = pot × pengali (besar bet tidak berpengaruh).`,
      `⏰ Togel dibuka otomatis dalam *1 menit*.`,
      `   (Timer di-reset tiap taruhan baru.)`,
    ]),
  }, { quoted: msg });
}

// ─── LIST TARUHAN AKTIF ─────────────────────────────────────
function listBets(sock, msg, chatId, senderJid) {
  const round = getOrCreateRound(chatId);
  const mine  = round.bets[senderJid] || [];

  if (!mine.length) {
    return sock.sendMessage(chatId, {
      text: `❌ Kamu belum memasang taruhan di round ke-*${round.round}*.\nContoh: *!togel 1234 500*`,
    }, { quoted: msg });
  }

  const lines = mine.map((b, i) => {
    return ui.bullet(`${i + 1}. [${digitLabel(b.numbers)}] \`${b.numbers}\` → ${fmt(b.amount)} money`);
  });
  lines.push('', ui.kv('💰 Total', `${fmt(mine.reduce((s, b) => s + b.amount, 0))} money`));

  return sock.sendMessage(chatId, {
    text: ui.box(`🎟️ TARUHAN KAMU (Round ${round.round})`, lines),
  }, { quoted: msg });
}

// ─── RIWAYAT ────────────────────────────────────────────────
function showHistory(sock, msg, chatId) {
  const history = getTogelHistory();
  if (!history.length) {
    return sock.sendMessage(chatId, {
      text: `📭 Belum ada riwayat togel. Ketik *!togel menu* untuk cara main.`,
    }, { quoted: msg });
  }

  const lines = history.map(h => {
    const time = h.drawnAt
      ? new Date(h.drawnAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      : '-';
    return ui.bullet(`Round ${h.round}: \`${h.number}\` (${time})`);
  });

  return sock.sendMessage(chatId, {
    text: ui.box('📜 RIWAYAT TOGEL', lines),
  }, { quoted: msg });
}

// ─── LEADERBOARD ────────────────────────────────────────────
function showTop(sock, msg, chatId) {
  const stats = getAllTogelStats();
  const rows = Object.entries(stats)
    .filter(([, s]) => (s.totalWon || 0) > 0 || (s.wins || 0) > 0)
    .sort((a, b) => (b[1].totalWon - a[1].totalWon) || (b[1].wins - a[1].wins))
    .slice(0, 10);

  if (!rows.length) {
    return sock.sendMessage(chatId, {
      text: `📭 Belum ada pemenang togel.`,
    }, { quoted: msg });
  }

  const lines = rows.map(([jid, s], i) => {
    const num = jid.split('@')[0];
    return ui.bullet(`${i + 1}. ${s.name || num} — ${fmt(s.totalWon)} money (${s.wins} menang)`);
  });

  return sock.sendMessage(chatId, {
    text: ui.box('🏆 TOP PEMENANG TOGEL', lines),
  }, { quoted: msg });
}

// ─── BUKA HASIL (LOGIKA INTI) ───────────────────────────────
async function executeDraw(sock, chatId, quotedMsg) {
  const round = getOrCreateRound(chatId);
  if (round.winningNumber) return false;

  const winning = rollWinningNumber();
  round.winningNumber = winning;
  round.drawnAt = Date.now();
  setTogelRound(chatId, round);

  // Kumpulkan semua taruhan
  const allBets = [];
  const spentByJid = {};
  for (const [jid, bets] of Object.entries(round.bets || {})) {
    spentByJid[jid] = bets.reduce((s, b) => s + b.amount, 0);
    for (const b of bets) allBets.push({ ...b, jid });
  }

  const { totalWin, winners, hasWinner } = summarizeRound(allBets, winning, round.pot || 0);

  // Bayar pemenang & catat statistik
  const wonByJid = {};
  for (const w of winners) {
    addMoney(w.jid, w.prize);
    wonByJid[w.jid] = (wonByJid[w.jid] || 0) + w.prize;

    const prev = getTogelStats(w.jid) || { wins: 0, losses: 0, totalBet: 0, totalWon: 0 };
    updateTogelStats(w.jid, {
      wins: (prev.wins || 0) + 1,
      totalWon: (prev.totalWon || 0) + w.prize,
      totalBet: (prev.totalBet || 0) + (spentByJid[w.jid] || 0),
    });
  }

  // Catat kekalahan & total taruhan untuk yang tidak menang
  for (const [jid, spent] of Object.entries(spentByJid)) {
    if (wonByJid[jid]) continue;
    const prev = getTogelStats(jid) || { wins: 0, losses: 0, totalBet: 0, totalWon: 0 };
    updateTogelStats(jid, {
      losses: (prev.losses || 0) + 1,
      totalBet: (prev.totalBet || 0) + spent,
    });
  }

  // Riwayat
  const pot = round.pot || 0;
  addTogelHistory({
    round: round.round, number: winning, drawnAt: round.drawnAt,
    totalPool: pot, winnerCount: winners.length,
  }, TOGEL_CONFIG.historyLimit);

  // Reset untuk round berikutnya.
  // Ada pemenang → pot reset 0 & streak kosong reset.
  // Tidak ada → pot lanjut (jackpot), tapi dihapus setelah 5 ronde tanpa pemenang.
  const noWinStreak = hasWinner ? 0 : (round.noWinStreak || 0) + 1;
  const potCleared = !hasWinner && noWinStreak >= 5;
  setTogelRound(chatId, {
    round: round.round + 1, createdAt: Date.now(), bets: {},
    pot: (hasWinner || potCleared) ? 0 : pot,
    winningNumber: null, drawnAt: null, autoDrawAt: null, noWinStreak,
  });

  // Pesan hasil
  const lines = [
    ui.kv('🎰 Nomor Keluar', `\`${winning}\``),
    ui.kv('🔁 Round', round.round),
    ui.kv('🎯 Pot', `${fmt(pot)} money`),
    ui.divider(),
  ];

  if (winners.length) {
    for (const w of winners) {
      lines.push(ui.bullet(
        `@${getNumber(w.jid)}`,
        `[${digitLabel(w.numbers)}] \`${w.numbers}\` → +${fmt(w.prize)} money`
      ));
    }
    lines.push('', ui.kv('💰 Total Hadiah', `${fmt(totalWin)} money`));
  } else {
    lines.push('_Tidak ada yang menang pada round ini._');
    if (potCleared) {
      lines.push(ui.bullet(`Pot ${fmt(pot)} money *dihapus* — 5 ronde tanpa pemenang! 💥`));
    } else {
      lines.push(ui.bullet(`Pot ${fmt(pot)} money *lanjut* ke round berikutnya! 💣`));
    }
  }
  lines.push('', ui.bullet('Round baru terbuka! Pasang: *!togel 1234 500*'));

  const mentions = [...new Set(winners.map(w => w.jid))];
  await sendCasinoMsg(sock, chatId, ui.box('🎊 HASIL TOGEL', lines), quotedMsg, mentions.length ? mentions : undefined);
  return true;
}

// ─── BUKA HASIL (ADMIN ONLY) ────────────────────────────────
async function drawResult(sock, msg, chatId, senderJid, OWNER_JID) {
  if (!sameUser(senderJid, OWNER_JID)) {
    return sock.sendMessage(chatId, {
      text: `⛔ Hanya *Admin* yang bisa membuka hasil togel.`,
    }, { quoted: msg });
  }

  const round = getOrCreateRound(chatId);
  if (round.winningNumber) {
    return sock.sendMessage(chatId, {
      text: `⏳ Hasil round ke-*${round.round}* sudah dibuka.`,
    }, { quoted: msg });
  }

  // Buka manual → batalkan timer auto-draw yang mungkin berjalan
  clearTogelTimer(chatId);
  await executeDraw(sock, chatId, msg);
  return true;
}

// ─── ROUTER ─────────────────────────────────────────────────
async function handleTogel(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body, OWNER_JID } = ctx;

  if (!body.toLowerCase().startsWith('!togel')) return false;

  // Pulihkan timer auto-draw (kasus bot restart di tengah hitung mundur)
  checkPendingAutoDraw(sock, chatId);

  const rest  = body.slice(7).trim();
  const args  = rest.split(/\s+/);
  const cmd   = (args[0] || '').toLowerCase();

  // Tidak ada argumen → menu
  if (!rest) {
    await sock.sendMessage(chatId, { text: showMenu() }, { quoted: msg });
    return true;
  }

  switch (cmd) {
    case 'menu':
    case 'info':
    case 'help':
    case 'bantuan':
      await sock.sendMessage(chatId, { text: showMenu() }, { quoted: msg });
      break;

    case 'list':
      listBets(sock, msg, chatId, senderJid);
      break;

    case 'riwayat':
    case 'history':
    case 'hist':
      showHistory(sock, msg, chatId);
      break;

    case 'top':
    case 'rank':
    case 'leaderboard':
      showTop(sock, msg, chatId);
      break;

    case 'buka':
    case 'draw':
      await drawResult(sock, msg, chatId, senderJid, OWNER_JID);
      break;

    case 'pasang':
    case 'psg':
    case 'bet':
      // !togel pasang 1234 500 → buang kata kunci, sisanya taruhan
      placeBet(sock, msg, chatId, senderJid, senderName, parseBet(args.slice(1)));
      break;

    default:
      // Langsung "!togel 1234 500" tanpa kata kunci
      placeBet(sock, msg, chatId, senderJid, senderName, parseBet(args));
      break;
  }
  return true;
}

module.exports = { handleTogel };
