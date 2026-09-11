const {
  getUserMoney, addMoney, deductMoney,
  getRpgPlayer, updateRpgPlayer,
  getFishingPlayer, updateFishingPlayer,
  recordBjLoss, getBjTop,
} = require('../../../data/db');
const { MATERIALS, resolveMaterialId } = require('../../../data/rpgData');
const { fishUnitPrice, formatGold } = require('../../../game/fishingEngine');
const ui = require('../../../utils/ui');
const { sameUser, getNumber } = require('../../../utils/jid');
const { quickReply, sendMenu } = require('../../../utils/buttons');
const { parsePositiveAmount, resolveAmount, isAllAmount } = require('../../../utils/amount');
const fs = require('fs');
const path = require('path');

// ─── BANNER CASINO (bannercasino.png di root, dibaca & cache sekali) ──
const BANNER_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'bannercasino.png');
let _bannerCache;
function casinoBanner() {
  if (_bannerCache === undefined) {
    try {
      _bannerCache = fs.readFileSync(BANNER_PATH);
    } catch {
      _bannerCache = null; // file belum ada → semua kirim fallback teks
    }
  }
  return _bannerCache;
}

// Kirim pesan casino: ada banner → gambar + caption, tidak ada → teks biasa.
async function sendCasinoMsg(sock, chatId, text, quoted, mentions) {
  const img = casinoBanner();
  const content = img ? { image: img, caption: text } : { text };
  if (mentions?.length) content.mentions = mentions;
  return sock.sendMessage(chatId, content, { ...(quoted ? { quoted } : {}) });
}

// Menyimpan sesi aktif blackjack per grup WhatsApp (maks 3 sesi per grup)
const bjSessions = {}; // { chatId: [sesi1, sesi2, sesi3] }

const BJ_TIMEOUT_MS = 5 * 60 * 1000;

function clearBjSession(chatId, session) {
  if (!session) {
    delete bjSessions[chatId];
    return;
  }
  if (session.timer) clearTimeout(session.timer);
  const list = bjSessions[chatId] || [];
  const idx = list.indexOf(session);
  if (idx >= 0) list.splice(idx, 1);
  if (list.length === 0) delete bjSessions[chatId];
}

function scheduleBjTimeout(sock, chatId, session) {
  if (session.timer) clearTimeout(session.timer);
  session.expiresAt = Date.now() + BJ_TIMEOUT_MS;
  session.timer = setTimeout(() => {
    if (!bjSessions[chatId] || !bjSessions[chatId].includes(session)) return;
    expireBj(sock, chatId, session);
  }, BJ_TIMEOUT_MS);
}

async function expireBj(sock, chatId, session) {
  if (!bjSessions[chatId] || !bjSessions[chatId].includes(session)) return;
  if (session.stage === 'waiting') {
    clearBjSession(chatId, session);
    return sock.sendMessage(chatId, { text: '⏰ Tantangan Blackjack kadaluarsa (5 menit). Sesi dibatalkan otomatis.' });
  }
  for (const p of session.players) {
    if (p.accepted) addMoney(p.jid, session.bet);
  }
  clearBjSession(chatId, session);
  return sock.sendMessage(chatId, { text: '⏰ Sesi Blackjack kadaluarsa (5 menit). Taruhan dikembalikan ke masing-masing pemain.' });
}

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const VALUES = [
  { name: '2', val: 2 }, { name: '3', val: 3 }, { name: '4', val: 4 },
  { name: '5', val: 5 }, { name: '6', val: 6 }, { name: '7', val: 7 },
  { name: '8', val: 8 }, { name: '9', val: 9 }, { name: '10', val: 10 },
  { name: 'J', val: 10 }, { name: 'Q', val: 10 }, { name: 'K', val: 10 },
  { name: 'A', val: 11 }
];

function createDeck() {
  let deck = [];
  for (let s of SUITS) {
    for (let v of VALUES) {
      deck.push({ name: v.name, suit: s, val: v.val });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function calculateScore(hand) {
  let score = 0;
  let aces = 0;
  for (let card of hand) {
    score += card.val;
    if (card.name === 'A') aces++;
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}

function formatHand(hand) {
  return hand.map(c => c.name).join(' ');
}

// ─── CASINO HANDLER ──────────────────────────────────────
function rollCasino() {
  const rate = Math.random();
  let multiplier = 0;
  let statusMsg = '';

  if (rate < 0.55) {
    multiplier = 0;
    statusMsg = '❌ Kamu kalah!';
  } else if (rate < 0.85) {
    multiplier = 2;
    statusMsg = '🎉 Menang! Taruhan dikembalikan 2x lipat.';
  } else if (rate < 0.97) {
    multiplier = 3;
    statusMsg = '🔥 Luar biasa! Taruhan dikembalikan 3x lipat.';
  } else {
    multiplier = 5;
    statusMsg = '👑 JACKPOT! Taruhan dikembalikan 5x lipat!';
  }

  return { multiplier, statusMsg };
}

// ─── MENU BANNER CASINO (!casino) — tanpa dropdown, pakai arahan cara main ──
async function showCasinoMenu(sock, msg, chatId) {
  await sendCasinoMsg(sock, chatId, showCasinoHelp(), msg);
}

async function handleCasino(sock, msg, args, senderJid, chatId, senderName) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'help' || sub === 'bantuan') {
    return sendCasinoMsg(sock, chatId, showCasinoHelp(), msg);
  }

  if (sub === 'material' || sub === 'mat') {
    return handleCasinoMaterial(sock, msg, args, senderJid, chatId, senderName);
  }

  if (sub === 'fish' || sub === 'ikan') {
    return handleCasinoFish(sock, msg, args, senderJid, chatId, senderName);
  }

  // ── MENU BANNER: !casino tanpa perintah yang dikenali ──
  const isMoneyBet = ['money', 'uang'].includes(sub)
    || parsePositiveAmount(sub) !== null
    || isAllAmount(sub);
  if (!isMoneyBet) {
    return showCasinoMenu(sock, msg, chatId);
  }

  // ── TARUHAN MONEY (!casino money [jumlah|all]; alias lama !casino [jumlah]) ──
  const currentMoney = getUserMoney(senderJid);
  const amountInput = ['money', 'uang'].includes(sub) ? args[1] : args[0];

  const amount = amountInput ? resolveAmount(amountInput, currentMoney) : 1;

  if (amount === null) {
    return sock.sendMessage(chatId, { text: '⚠️ Jumlah taruhan harus berupa angka positif yang valid.' }, { quoted: msg });
  }

  if (currentMoney < amount) {
    return sock.sendMessage(chatId, { text: `❌ Uang kamu tidak cukup. Sisa uangmu saat ini: ${ui.money(currentMoney)} money.` }, { quoted: msg });
  }

  const { multiplier, statusMsg } = rollCasino();

  if (multiplier === 0) {
    deductMoney(senderJid, amount);
  } else {
    const profit = amount * (multiplier - 1);
    addMoney(senderJid, profit);
  }

  const newBalance = getUserMoney(senderJid);
  const payout = amount * multiplier;

  const responseText = ui.box(
    `🎰 Casino Roll`,
    [
      ui.kv(`👤 Player`, senderName),
      ui.kv(`💰 Taruhan`, `${ui.money(amount)} money`),
      ui.divider(),
      statusMsg,
      ui.divider(),
      ui.kv(`🎁 Total Payout`, `${ui.money(payout)} money`),
      ui.kv(`💳 Sisa Uang`, `${ui.money(newBalance)} money`),
    ]
  );

  await sendCasinoMsg(sock, chatId, responseText, msg);
}

// ─── TARUHAN MATERIAL RPG ────────────────────────────────
async function handleCasinoMaterial(sock, msg, args, senderJid, chatId, senderName) {
  // Nama material bisa multi-kata; jumlah = arg terakhir (angka / all / semua)
  const lastArg  = args[args.length - 1];
  const lastIsQty = lastArg !== undefined && (parsePositiveAmount(lastArg) !== null || isAllAmount(lastArg));
  const qtyRaw   = lastIsQty ? lastArg.toLowerCase() : null;
  const matName  = args.slice(1, lastIsQty ? args.length - 1 : args.length).join(' ');

  const matKey = resolveMaterialId(matName);

  if (!matKey) {
    if (!matName) return listOwnedMaterials(sock, msg, senderJid, chatId);
    return sock.sendMessage(chatId, {
      text: `❌ Material *${matName}* tidak dikenal!\nContoh: *!casino material batu 5* / *!casino material dark matter 3*\nKetik *!casino material* untuk daftar.`
    }, { quoted: msg });
  }

  const mat = MATERIALS[matKey];

  const player = getRpgPlayer(senderJid);
  if (!player) {
    return sock.sendMessage(chatId, { text: '❌ Kamu belum terdaftar di RPG! Gunakan perintah *!rpg* dulu.' }, { quoted: msg });
  }

  const owned = player[matKey] || 0;
  if (owned <= 0) {
    return sock.sendMessage(chatId, { text: `❌ Kamu tidak punya ${mat.emoji} ${mat.name} untuk dijadikan taruhan.` }, { quoted: msg });
  }

  const rawQty = qtyRaw || '';
  const qty = rawQty ? resolveAmount(rawQty, owned) : 1;

  if (qty === null) {
    return sock.sendMessage(chatId, { text: '⚠️ Jumlah taruhan harus berupa angka positif atau "all".' }, { quoted: msg });
  }
  if (qty > owned) {
    return sock.sendMessage(chatId, { text: `❌ Kamu hanya punya *${owned}* ${mat.name}.` }, { quoted: msg });
  }

  const betValue = qty * mat.sellPrice;

  // Lepas taruhan dari inventory
  updateRpgPlayer(senderJid, { [matKey]: owned - qty });

  const { multiplier, statusMsg } = rollCasino();

  const base = [
    ui.kv(`👤 Player`, senderName),
    ui.kv(`🎲 Taruhan`, `${mat.emoji} ${mat.name} x${qty}`),
    ui.kv(`💰 Nilai`, `${ui.money(betValue)} money`),
    ui.divider(),
    statusMsg,
    ui.divider(),
  ];

  if (multiplier === 0) {
    base.push(`💀 Taruhan ${qty} ${mat.name} hangus!`);
  } else {
    const returned = qty * multiplier;
    const fresh    = getRpgPlayer(senderJid) || {};
    updateRpgPlayer(senderJid, { [matKey]: (fresh[matKey] || 0) + returned });
    base.push(`🎁 Kamu dapat *${mat.emoji} ${mat.name} x${returned}* (${multiplier}x)`);
  }

  await sendCasinoMsg(sock, chatId, ui.box('🎰 Casino Material', base), msg);
}

// ─── TARUHAN IKAN FISHIT ─────────────────────────────────
async function handleCasinoFish(sock, msg, args, senderJid, chatId, senderName) {
  if (args.length < 2) {
    return listOwnedFish(sock, msg, senderJid, chatId);
  }

  const player = getFishingPlayer(senderJid);
  if (!player) {
    return sock.sendMessage(chatId, { text: '❌ Kamu belum terdaftar di FishIt! Gunakan perintah *!fishit* dulu.' }, { quoted: msg });
  }

  const inv = player.inventory || {};
  if (!Object.keys(inv).length) {
    return sock.sendMessage(chatId, { text: '❌ Inventory ikan kamu kosong! Mancing dulu: *!fishit mancing [no]*' }, { quoted: msg });
  }

  // Nama ikan bisa multi-kata; jumlah = arg terakhir (angka / all)
  const lastArg  = args[args.length - 1];
  const lastIsQty = parsePositiveAmount(lastArg) !== null || isAllAmount(lastArg);
  const qtyRaw   = lastIsQty ? lastArg.toLowerCase() : null;
  const fishName = args.slice(1, lastIsQty ? args.length - 1 : args.length).join(' ');

  if (!fishName) {
    return sock.sendMessage(chatId, { text: '⚠️ Tentukan nama ikan!\nContoh: *!casino fish Ikan Mas 3*' }, { quoted: msg });
  }

  // Cari key inventory: cocok persis (case-insensitive), fallback substring unik
  const lower = fishName.toLowerCase();
  let matchKey = null;
  const exact = Object.keys(inv).find(k => k.toLowerCase() === lower);
  if (exact) {
    matchKey = exact;
  } else {
    const subs = Object.keys(inv).filter(k => k.toLowerCase().includes(lower));
    if (subs.length === 1) {
      matchKey = subs[0];
    } else if (subs.length > 1) {
      return sock.sendMessage(chatId, { text: `⚠️ Nama ikan ambigu! Lebih spesifik lagi. Cocok: ${subs.join(', ')}` }, { quoted: msg });
    }
  }

  if (!matchKey) {
    return sock.sendMessage(chatId, { text: `❌ Ikan *${fishName}* tidak ditemukan di inventory kamu!\nCek *!fishit inv*` }, { quoted: msg });
  }

  const data      = inv[matchKey];
  const unitPrice = fishUnitPrice(data);

  const qty = qtyRaw ? resolveAmount(qtyRaw, data.count) : 1;

  if (qty === null) {
    return sock.sendMessage(chatId, { text: '⚠️ Jumlah taruhan harus berupa angka positif atau "all".' }, { quoted: msg });
  }
  if (qty > data.count) {
    return sock.sendMessage(chatId, { text: `❌ Kamu hanya punya *${data.count}x ${matchKey}*.` }, { quoted: msg });
  }

  const avgWeight = data.weight / data.count;
  const betValue  = qty * unitPrice;

  // Lepas taruhan dari inventory
  const newInv = { ...inv };
  const remaining = data.count - qty;
  if (remaining <= 0) {
    delete newInv[matchKey];
  } else {
    newInv[matchKey] = { ...data, count: remaining, weight: +(data.weight - avgWeight * qty).toFixed(2) };
  }
  updateFishingPlayer(senderJid, { inventory: newInv });

  const { multiplier, statusMsg } = rollCasino();

  const base = [
    ui.kv(`👤 Player`, senderName),
    ui.kv(`🎲 Taruhan`, `🐟 ${matchKey} x${qty}`),
    ui.kv(`💰 Nilai`, `${formatGold(betValue)}`),
    ui.divider(),
    statusMsg,
    ui.divider(),
  ];

  if (multiplier === 0) {
    base.push(`💀 Taruhan ${qty} ekor ${matchKey} hilang!`);
  } else {
    const returned = qty * multiplier;
    const fresh    = getFishingPlayer(senderJid) || {};
    const freshInv = { ...(fresh.inventory || {}) };
    if (freshInv[matchKey]) {
      freshInv[matchKey] = {
        ...freshInv[matchKey],
        count:  freshInv[matchKey].count + returned,
        weight: +(freshInv[matchKey].weight + avgWeight * returned).toFixed(2),
      };
    } else {
      freshInv[matchKey] = { count: returned, weight: +(avgWeight * returned).toFixed(2), tier: data.tier };
    }
    updateFishingPlayer(senderJid, { inventory: freshInv });
    base.push(`🎁 Kamu dapat *🐟 ${matchKey} x${returned}* (${multiplier}x)`);
  }

  await sendCasinoMsg(sock, chatId, ui.box('🎰 Casino Ikan', base), msg);
}

// ─── DAFTAR & BANTUAN ────────────────────────────────────
async function listOwnedMaterials(sock, msg, senderJid, chatId) {
  const player = getRpgPlayer(senderJid);
  if (!player) {
    return sock.sendMessage(chatId, { text: '❌ Kamu belum terdaftar di RPG! Gunakan perintah *!rpg* dulu.' }, { quoted: msg });
  }

  const owned = Object.entries(MATERIALS).filter(([id]) => (player[id] || 0) > 0);
  if (!owned.length) {
    return sock.sendMessage(chatId, { text: '❌ Kamu tidak punya material RPG untuk dijadikan taruhan.\nKumpulkan lewat *!rpg tebang* / *!rpg tambang*.' }, { quoted: msg });
  }

  const lines = [
    `Material yang kamu punya:`,
    '',
  ];
  for (const [id, mat] of owned) {
    lines.push(ui.bullet(`[${mat.alias}] ${mat.emoji} ${mat.name}: ${player[id]}x →`));
    lines.push(ui.bullet(`   ${ui.money(mat.sellPrice)} money/pcs`));
  }
  lines.push('', 'Cara judi:', ui.bullet('*!casino material [nama/id] [jumlah|all]*'), ui.bullet('Contoh: *!casino material dark matter 3*'));

  return sock.sendMessage(chatId, { text: ui.box('🎰 JUDI MATERIAL', lines) }, { quoted: msg });
}

async function listOwnedFish(sock, msg, senderJid, chatId) {
  const player = getFishingPlayer(senderJid);
  if (!player) {
    return sock.sendMessage(chatId, { text: '❌ Kamu belum terdaftar di FishIt! Gunakan perintah *!fishit* dulu.' }, { quoted: msg });
  }

  const inv = player.inventory || {};
  const entries = Object.entries(inv);
  if (!entries.length) {
    return sock.sendMessage(chatId, { text: '❌ Kamu tidak punya ikan untuk dijadikan taruhan.\nMancing dulu: *!fishit mancing [no]*' }, { quoted: msg });
  }

  const lines = [
    `Ikan yang kamu punya:`,
    '',
  ];
  for (const [name, data] of entries) {
    lines.push(ui.bullet(`🐟 ${name} x${data.count} (~${formatGold(fishUnitPrice(data))}/ekor)`));
  }
  lines.push('', 'Cara judi:', ui.bullet('*!casino fish [nama ikan] [jumlah|all]*'));

  return sock.sendMessage(chatId, { text: ui.box('🎰 JUDI IKAN', lines) }, { quoted: msg });
}

function showCasinoHelp() {
  return ui.box('🎰 *PANDUAN CASINO*', [
    `Tanpa jumlah → taruhan *1* (money / pcs / ekor)`,
    ``,
    `Taruhan *Money*:`,
    ui.cmd('!casino', 'Menu Casino (banner)'),
    ui.cmd('!casino money [jumlah]', 'Taruh Money'),
    ui.cmd('!casino money all', 'Taruh semua Money'),
    ``,
    `Taruhan *Material RPG*:`,
    ui.cmd('!casino material', 'Daftar material'),
    ui.cmd('!casino material [nama] [jumlah|all]'),
    ui.bullet('Contoh: *!casino material berlian 2*'),
    ui.bullet('   *!casino material dark matter 3*'),
    ``,
    `Taruhan *Ikan FishIt*:`,
    ui.cmd('!casino fish', 'Daftar ikan'),
    ui.cmd('!casino fish [nama] [jumlah|all]'),
    ui.bullet('Contoh: *!casino fish Ikan Mas 3*'),
    ``,
    ui.divider(),
    `Menang = taruhan kembali ×2/×3/×5 | Kalah = taruhan hilang`,
  ]);
}

// ─── BLACKJACK HANDLER ───────────────────────────────────
// Cari index pemain berikutnya yang belum "done" (stand/bust). null = semua selesai.
function findNextActivePlayer(session, currentIdx) {
  const n = session.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (currentIdx + step) % n;
    if (!session.players[idx].done) return idx;
  }
  return null;
}

// Fungsi start bersama (dipakai auto-start timer & manual !bj mulai)
async function startGame(sock, chatId, session, senderJid, msg) {
  // Buang player yang belum accept, kembalikan bet mereka
  const notAccepted = session.players.filter(p => !p.accepted);
  for (const p of notAccepted) addMoney(p.jid, session.bet);
  session.players = session.players.filter(p => p.accepted);

  if (session.players.length < 2) {
    clearBjSession(chatId, session);
    return sock.sendMessage(chatId, { text: '❌ Tidak cukup pemain untuk memulai game.' }, { quoted: msg });
  }

  // Bagikan 2 kartu awal ke semua pemain.
  for (const p of session.players) {
    p.hand.push(session.deck.pop());
    p.hand.push(session.deck.pop());
  }

  // Natural blackjack: 21 dari 2 kartu awal → auto-done & diumumkan.
  const blackjacks = session.players.filter(p => calculateScore(p.hand) === 21);
  for (const p of blackjacks) p.done = true;
  const blackjackNote = blackjacks.length
    ? `🎯 BLACKJACK! ${blackjacks.map(p => '@' + getNumber(p.jid)).join(', ')} dapat 21 dari 2 kartu awal & otomatis menang!`
    : '';

  session.stage = 'playing';
  session.turnIndex = Math.floor(Math.random() * session.players.length);

  // Pastikan giliran awal jatuh pada pemain yang masih aktif (bukan blackjack).
  if (session.players[session.turnIndex].done) {
    const nextIdx = findNextActivePlayer(session, session.turnIndex);
    if (nextIdx === null) {
      // Semua pemain dapat natural blackjack → langsung resolve.
      if (session.autoStartTimer) { clearTimeout(session.autoStartTimer); session.autoStartTimer = null; }
      if (session.timer) { clearTimeout(session.timer); session.timer = null; }
      return resolveBlackjack(sock, chatId, session);
    }
    session.turnIndex = nextIdx;
  }

  if (session.autoStartTimer) { clearTimeout(session.autoStartTimer); session.autoStartTimer = null; }

  scheduleBjTimeout(sock, chatId, session);

  const allMentions = session.players.map(p => p.jid);
  const intro = `🎮 Game dimulai! Giliran @${getNumber(session.players[session.turnIndex].jid)} terlebih dahulu.\nKetik !hit untuk menambah kartu atau !stand untuk bertahan.`;
  return showStatus(sock, chatId, session, blackjackNote ? `${blackjackNote}\n\n${intro}` : intro, allMentions);
}

async function handleBlackjack(sock, msg, args, senderJid, chatId, mentionedJids, body, senderName) {
  const allSessions = bjSessions[chatId] || [];
  for (const s of allSessions) {
    if (Date.now() > s.expiresAt) await expireBj(sock, chatId, s);
  }

  const cmd = args[0]?.toLowerCase();

  // 1. Hit / Stand
  if (body.toLowerCase() === '!hit' || body.toLowerCase() === '!stand') {
    const session = (bjSessions[chatId] || []).find(s => s.players.some(p => sameUser(p.jid, senderJid)));
    if (!session || session.stage === 'waiting') return;

    const pIdx = session.players.findIndex(p => sameUser(p.jid, senderJid));
    if (pIdx < 0 || session.players[pIdx].done) return;

    if (pIdx !== session.turnIndex) {
      return sock.sendMessage(chatId, { text: '⚠️ Sekarang bukan giliran kamu untuk mengambil keputusan!' }, { quoted: msg });
    }

    const player = session.players[pIdx];

    if (body.toLowerCase() === '!hit') {
      const card = session.deck.pop();
      player.hand.push(card);
      const score = calculateScore(player.hand);

      if (score > 21) {
        player.done = true;
        await sock.sendMessage(chatId, {
          text: `💥 @${getNumber(player.jid)} mengambil kartu ${card.name} dan BUST (Lebih dari 21)! Skor akhir: ${score}`,
          mentions: [player.jid]
        }, { quoted: msg });

        const nextIdx = findNextActivePlayer(session, pIdx);
        if (nextIdx === null) {
          return resolveBlackjack(sock, chatId, session);
        }
        session.turnIndex = nextIdx;
        return showStatus(sock, chatId, session, `Giliran @${getNumber(session.players[nextIdx].jid)} untuk bermain! Ketik !hit atau !stand`);
      } else {
        if (score === 21) {
          player.done = true;
          const nextIdx = findNextActivePlayer(session, pIdx);
          if (nextIdx === null) {
            return resolveBlackjack(sock, chatId, session);
          }
          session.turnIndex = nextIdx;
          return showStatus(sock, chatId, session, `🎯 @${getNumber(player.jid)} mencapai BLACKJACK (21)! Giliran @${getNumber(session.players[nextIdx].jid)}!`);
        }
        return showStatus(sock, chatId, session, `@${getNumber(player.jid)} mengambil kartu. Ketik !hit atau !stand untuk melanjutkan.`);
      }
    }

    if (body.toLowerCase() === '!stand') {
      player.done = true;
      const nextIdx = findNextActivePlayer(session, pIdx);
      if (nextIdx === null) {
        return resolveBlackjack(sock, chatId, session);
      }
      session.turnIndex = nextIdx;
      return showStatus(sock, chatId, session, `🛡️ @${getNumber(player.jid)} memilih STAND. Sekarang giliran @${getNumber(session.players[nextIdx].jid)}! Ketik !hit atau !stand`);
    }
    return;
  }

  // 2. Terima Tantangan
  if (cmd === 'terima' || cmd === 'accept') {
    const session = (bjSessions[chatId] || []).find(s =>
      s.stage === 'waiting' && s.players.some(p => sameUser(p.jid, senderJid))
    );
    if (!session) {
      return sock.sendMessage(chatId, { text: '❌ Tidak ada tantangan Blackjack yang tertunda untukmu di grup ini.' }, { quoted: msg });
    }

    const pi = session.players.findIndex(p => sameUser(p.jid, senderJid));
    if (pi < 0) return;

    if (session.players[pi].accepted) {
      return sock.sendMessage(chatId, { text: '✅ Kamu sudah menerima tantangan ini!' }, { quoted: msg });
    }

    const money = getUserMoney(senderJid);
    if (money < session.bet) {
      return sock.sendMessage(chatId, { text: `❌ Saldo kamu tidak cukup untuk menyamai taruhan ini. Saldo: ${ui.money(money)} money.` }, { quoted: msg });
    }

    if (!deductMoney(senderJid, session.bet)) {
      return sock.sendMessage(chatId, { text: '❌ Gagal memotong taruhan.' }, { quoted: msg });
    }

    session.players[pi].accepted = true;

    const acceptedCount = session.players.filter(p => p.accepted).length;
    const totalPlayers = session.players.length;
    const allMentions = session.players.map(p => p.jid);
    const acceptedPlayers = session.players.filter(p => p.accepted);
    const notAccepted = session.players.filter(p => !p.accepted);
    const acceptedTags = acceptedPlayers.map(p => `@${getNumber(p.jid)}`).join(' ');

    // Semua accept → langsung mulai
    if (acceptedCount === totalPlayers) {
      return startGame(sock, chatId, session, session.creator, msg);
    }

    // Belum semua accept, tapi sudah >= 2 siap → reset timer 45s
    if (acceptedCount >= 2) {
      if (session.autoStartTimer) clearTimeout(session.autoStartTimer);
      session.autoStartAt = Date.now() + 45000;
      session.autoStartTimer = setTimeout(async () => {
        if (!bjSessions[chatId] || !bjSessions[chatId].includes(session)) return;
        if (session.stage !== 'waiting') return;
        await startGame(sock, chatId, session, senderJid, msg);
      }, 45000);

      const remaining = notAccepted.map(p => `@${getNumber(p.jid)}`);
      const countdown = new Date(session.autoStartAt - Date.now()).toUTCString();
      return sock.sendMessage(chatId, {
        text: `✅ @${getNumber(senderJid)} menerima tantangan! (${acceptedCount}/${totalPlayers})\nPemain siap: ${acceptedTags}\n⏳ Menunggu: ${remaining.join(', ')}\n\nGame mulai otomatis dalam *45 detik* jika belum semua menerima. Ketik *!bj mulai* untuk langsung memulai.`,
        mentions: allMentions
      }, { quoted: msg });
    }

    // Masih < 2 siap
    const remaining = notAccepted.map(p => `@${getNumber(p.jid)}`);
    return sock.sendMessage(chatId, {
      text: `✅ @${getNumber(senderJid)} menerima tantangan! (${acceptedCount}/${totalPlayers})\nMenunggu: ${remaining.join(', ')}`,
      mentions: allMentions
    }, { quoted: msg });
  }

  // 3. Tolak / Cancel
  if (cmd === 'tolak' || cmd === 'decline' || cmd === 'cancel') {
    const session = (bjSessions[chatId] || []).find(s =>
      s.stage === 'waiting' && s.players.some(p => sameUser(p.jid, senderJid))
    );
    if (!session) {
      return sock.sendMessage(chatId, { text: '❌ Tidak ada tantangan Blackjack yang bisa dibatalkan.' }, { quoted: msg });
    }

    if (sameUser(senderJid, session.creator)) {
      if (session.autoStartTimer) { clearTimeout(session.autoStartTimer); session.autoStartTimer = null; }
      for (const p of session.players) {
        if (p.accepted) addMoney(p.jid, session.bet);
      }
      clearBjSession(chatId, session);
      return sock.sendMessage(chatId, { text: '✅ Tantangan Blackjack dibatalkan oleh creator.' }, { quoted: msg });
    }

    const pi = session.players.findIndex(p => sameUser(p.jid, senderJid));
    if (pi >= 0) {
      if (session.players[pi].accepted) addMoney(senderJid, session.bet);
      session.players.splice(pi, 1);
    }

    if (session.players.length < 2) {
      if (session.autoStartTimer) { clearTimeout(session.autoStartTimer); session.autoStartTimer = null; }
      for (const p of session.players) {
        if (p.accepted) addMoney(p.jid, session.bet);
      }
      clearBjSession(chatId, session);
      return sock.sendMessage(chatId, { text: '❌ Tantangan dibatalkan karena kurang dari 2 pemain.' }, { quoted: msg });
    }

    const remaining = session.players.map(p => `@${getNumber(p.jid)}`);
    return sock.sendMessage(chatId, {
      text: `❌ @${getNumber(senderJid)} menolak tantangan. Sisa pemain: ${remaining.join(', ')}`,
      mentions: session.players.map(p => p.jid)
    }, { quoted: msg });
  }

  // 4. Manual start (creator)
  if (cmd === 'mulai' || cmd === 'start') {
    const session = (bjSessions[chatId] || []).find(s =>
      s.stage === 'waiting' && sameUser(s.creator, senderJid)
    );
    if (!session) {
      return sock.sendMessage(chatId, { text: '❌ Tidak ada sesi Blackjack yang bisa kamu mulai.' }, { quoted: msg });
    }

    const acceptedCount = session.players.filter(p => p.accepted).length;
    if (acceptedCount < 1) {
      return sock.sendMessage(chatId, { text: '❌ Minimal 1 pemain harus menerima dulu.' }, { quoted: msg });
    }

    return startGame(sock, chatId, session, senderJid, msg);
  }

  // 5. Buat Sesi Baru (invite via mention, 2-4 pemain)
  const list = bjSessions[chatId] || [];
  if (list.some(s => s.players.some(p => sameUser(p.jid, senderJid)))) {
    return sock.sendMessage(chatId, { text: '❌ Kamu sudah terlibat dalam sesi Blackjack di grup ini. Selesaikan dulu!' }, { quoted: msg });
  }
  if (list.length >= 3) {
    return sock.sendMessage(chatId, { text: '❌ Maksimal 3 sesi Blackjack dalam satu grup. Selesaikan dulu sesi yang ada!' }, { quoted: msg });
  }

  const invites = mentionedJids || [];
  if (!invites.length) {
    return sock.sendMessage(chatId, { text: '⚠️ Tag lawan yang ingin kamu tantang!\nContoh: *!bj @p1 @p2 100*\nMinimal 1 tag, maksimal 3 tag (total 2-4 pemain).' }, { quoted: msg });
  }

  if (invites.length > 3) {
    return sock.sendMessage(chatId, { text: '❌ Maksimal 3 pemain yang ditag! (Total maks 4 pemain)' }, { quoted: msg });
  }

  if (invites.some(jid => sameUser(jid, senderJid))) {
    return sock.sendMessage(chatId, { text: '❌ Kamu tidak bisa menantang diri sendiri!' }, { quoted: msg });
  }

  for (const invJid of invites) {
    if (sameUser(invJid, senderJid)) {
      return sock.sendMessage(chatId, { text: '❌ Kamu tidak bisa menantang diri sendiri!' }, { quoted: msg });
    }
    if (list.some(s => s.players.some(p => sameUser(p.jid, invJid)))) {
      return sock.sendMessage(chatId, { text: `❌ @${getNumber(invJid)} sudah terlibat dalam sesi Blackjack lain!`, mentions: [invJid] }, { quoted: msg });
    }
  }

  const amountInput = args.find(a => parsePositiveAmount(a) !== null || isAllAmount(a));
  if (!amountInput) {
    return sock.sendMessage(chatId, { text: '⚠️ Masukkan nominal taruhan money!\nContoh: *!bj @p1 @p2 100*' }, { quoted: msg });
  }

  const bet = resolveAmount(amountInput, getUserMoney(senderJid));
  if (bet === null) {
    return sock.sendMessage(chatId, { text: '⚠️ Nominal taruhan yang kamu masukkan salah.' }, { quoted: msg });
  }

  const p1Money = getUserMoney(senderJid);
  if (p1Money < bet) {
    return sock.sendMessage(chatId, { text: `❌ Sisa saldo kamu tidak cukup. Saldo saat ini: ${ui.money(p1Money)} money.` }, { quoted: msg });
  }

  for (const invJid of invites) {
    const invMoney = getUserMoney(invJid);
    if (invMoney < bet) {
      return sock.sendMessage(chatId, { text: `❌ Saldo @${getNumber(invJid)} tidak cukup. Saldo: ${ui.money(invMoney)} money.`, mentions: [invJid] }, { quoted: msg });
    }
  }

  const players = [
    { jid: senderJid, hand: [], done: false, accepted: true },
    ...invites.map(jid => ({ jid, hand: [], done: false, accepted: false }))
  ];

  const session = {
    creator: senderJid,
    bet,
    stage: 'waiting',
    deck: createDeck(),
    players,
    turnIndex: 0,
    timer: null,
    expiresAt: 0,
    autoStartAt: 0,
    autoStartTimer: null
  };
  list.push(session);
  bjSessions[chatId] = list;

  scheduleBjTimeout(sock, chatId, session);

  const invTags = invites.map(jid => `@${getNumber(jid)}`).join(' ');
  const textInvite = ui.box(
    `🃏 Tantangan Blackjack`,
    [
      ui.kv(`👤 Challenger`, `@${getNumber(senderJid)}`),
      ui.kv(`👥 Pemain Diundang`, invTags),
      ui.kv(`💰 Taruhan`, `${ui.money(bet)} money`),
      ui.kv(`🎯 Total Pemain`, `${invites.length + 1} pemain`),
      ui.divider(),
      `Silakan @${invites.map(j => getNumber(j)).join(', @')} ketik *!bj terima* atau *!bj tolak*`,
      ``,
      `Semua pemain harus terima → Game otomatis mulai!`,
      `👉 Atau ketuk tombol di bawah!`,
    ]
  );

  const allMentions = [senderJid, ...invites];
  return sendMenu(sock, chatId, {
    text: textInvite,
    footer: `🃏 Tantangan Blackjack`,
    quoted: msg,
    mentions: allMentions,
    fallbackText: textInvite,
    buttons: [
      quickReply('!bj terima', '✅ Terima'),
      quickReply('!bj tolak', '❌ Tolak'),
    ],
  });
}

async function showStatus(sock, chatId, session, footerText, allMentions) {
  const lines = [ui.kv(`💰 Taruhan Set`, `${ui.money(session.bet)} money / pemain`)];

  session.players.forEach((p, i) => {
    const s = calculateScore(p.hand);
    const turnMark = (session.stage === 'playing' && i === session.turnIndex && !p.done) ? ' 👉 GILIRAN' : '';
    let line = ui.section(`${p.accepted ? '🕺' : '💤'} @${getNumber(p.jid)}` + turnMark);
    lines.push(line);
    lines.push(`Kartu: ${formatHand(p.hand)}`);
    lines.push(`Skor: *${s}*${p.done ? ' (DONE)' : ''}`);
  });

  lines.push(ui.divider());
  lines.push(footerText);
  lines.push('');
  lines.push('👉 Ketuk tombol di bawah untuk aksi!');

  const text = ui.box('🃏 Board Status Blackjack', lines);
  const mentions = allMentions || session.players.map(p => p.jid);

  await sendMenu(sock, chatId, {
    text,
    footer: `🃏 Blackjack — ${session.players[session.turnIndex] ? '@' + getNumber(session.players[session.turnIndex].jid) : ''}`,
    quoted: null,
    mentions,
    fallbackText: text,
    buttons: [
      quickReply('!hit', '🃏 Hit'),
      quickReply('!stand', '✋ Stand'),
    ],
  });
}

async function resolveBlackjack(sock, chatId, session) {
  // Hitung skor semua pemain
  const scored = session.players.map((p, i) => ({
    jid: p.jid,
    hand: p.hand,
    score: calculateScore(p.hand),
    bust: calculateScore(p.hand) > 21,
    idx: i,
  }));

  const nonBust = scored.filter(p => !p.bust);
  const totalPot = session.bet * session.players.length;

  let resultText = '';
  let payout = null;

  if (nonBust.length === 0) {
    // Semua bust → taruhan hangus semua
    resultText = '💀 Semua pemain BUST! Semua taruhan hangus (lenyap).';
    payout = { type: 'all-bust' };
  } else if (nonBust.length === 1) {
    // Satu pemenang ambil seluruh pot
    const winner = nonBust[0];
    resultText = `🏆 @${getNumber(winner.jid)} MENANG dengan skor ${winner.score}!`;
    payout = { type: 'winner', winnerJid: winner.jid, amount: totalPot };
  } else {
    // Cari skor tertinggi non-bust
    const maxScore = Math.max(...nonBust.map(p => p.score));
    const top = nonBust.filter(p => p.score === maxScore);

    if (top.length === 1) {
      const winner = top[0];
      resultText = `🏆 @${getNumber(winner.jid)} MENANG dengan skor ${winner.score}!`;
      payout = { type: 'winner', winnerJid: winner.jid, amount: totalPot };
    } else {
      // Seri → bagi rata di antara pemain seri
      const share = Math.floor(totalPot / top.length);
      resultText = `🤝 ${top.map(p => `@${getNumber(p.jid)}`).join(' & ')} seri dengan skor ${maxScore}! Pot dibagi rata.`;
      payout = { type: 'split', winnerJids: top.map(p => p.jid), share };
    }
  }

  // Eksekusi pembayaran
  if (payout) {
    if (payout.type === 'winner') {
      addMoney(payout.winnerJid, payout.amount);
    } else if (payout.type === 'split') {
      for (const jid of payout.winnerJids) addMoney(jid, payout.share);
    }
    // all-bust: tidak ada pembayaran, taruhan lenyap
  }

  // Catat kerugian untuk semua yang tidak menang
  const winnerSet = new Set(payout && payout.type === 'winner'
    ? [payout.winnerJid]
    : payout && payout.type === 'split' ? payout.winnerJids : []);
  for (const p of scored) {
    if (!winnerSet.has(p.jid)) recordBjLoss(chatId, p.jid, session.bet);
  }

  const resultLines = [
    ...scored.map(p =>
      ` ${p.bust ? '💥' : '🕺'} @${getNumber(p.jid)}: ${formatHand(p.hand)} (Skor: ${p.score}${p.bust ? ' 💥BUST' : ''})`
    ),
    ui.divider(),
    resultText,
  ];

  if (payout && payout.type === 'winner') {
    resultLines.push(`💰 Pemenang menerima ${ui.money(payout.amount)} money (pot ${session.players.length} pemain)!`);
  } else if (payout && payout.type === 'split') {
    resultLines.push(`💰 Masing-masing menerima ${ui.money(payout.share)} money.`);
  } else if (payout && payout.type === 'all-bust') {
    resultLines.push(`💰 Pot senilai ${ui.money(totalPot)} money hangus.`);
  }

  const finalMessage = ui.box('🏁 Game Blackjack Selesai', resultLines);

  await sendCasinoMsg(sock, chatId, finalMessage, null, session.players.map(p => p.jid));
  clearBjSession(chatId, session);
}

// ─── TOP BUST ─────────────────────────────────────────────
// Peringkat 5 pemain dengan total kerugian Blackjack terbesar di grup ini.
async function handleTopBust(ctx) {
  const { sock, msg, chatId, groupId } = ctx;
  const tops = getBjTop(null, 5);
  if (!tops.length) {
    return sock.sendMessage(chatId, { text: '❌ Belum ada kerugian Blackjack!' }, { quoted: msg });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = tops.map((p, i) => `${medals[i] || `*${i + 1}.*`} @${getNumber(p.jid)}\n   └ 💸 Rugi: Rp ${ui.money(p.loss)}`);

  return sock.sendMessage(chatId, {
    text: ui.box('🏆 *TOP BUST GLOBAL*', lines, 'Pemain dengan kerugian terbesar'),
    mentions: tops.map(p => p.jid)
  }, { quoted: msg });
}

module.exports = {
  handleCasino,
  handleBlackjack,
  handleTopBust,
  sendCasinoMsg,
  bjSessions
};