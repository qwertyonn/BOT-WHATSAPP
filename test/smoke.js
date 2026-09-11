// test/smoke.js
// Smoke test pasca-rombak: semua handler ter-register, route() tidak throw
// untuk pesan acak, dan perintah kunci tiap kategori tetap berjalan.
// WAJIB menjalankan dengan DB/state temp — tidak menyentuh data asli.
const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── SANDBOX: arahkan semua state ke folder temp ───────────
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-smoke-'));
process.env.BOT_DB_PATH = path.join(sandbox, 'database.json');
process.env.BOT_BACKUP_DIR = path.join(sandbox, 'backups');
process.env.BOT_AFK_STATE_PATH = path.join(sandbox, 'afk_state.json');
process.env.BOT_FAMILY_STATE_PATH = path.join(sandbox, 'family100_state.json');
process.env.BOT_AI_MEMORY_PATH = path.join(sandbox, 'ai_memory.json');
process.env.BOT_PM_MODE_PATH = path.join(sandbox, 'pm_mode.json');

const { route } = require('../handlers/router');
const {
  autoRegisterUser, getFishingPlayer, addMoney, deductMoney, getUserMoney, resetMoney,
  getGachaStats, isUserBanned, isUserBannedInGroup, unbanUserInGroup, recordBjLoss,
  getBankData, depositBank, withdrawBank, calculatePendingInterest, claimBankInterest,
  updateRobStats, updateBobolStats,
  banUser, unbanUser, banUserInGroup,
} = require('../data/db');
const { activeFishing } = require('../handlers/game/fishit/commands');
const { getFishingDelay } = require('../game/fishingEngine');
const { parseIntent, parseDurasi } = require('../handlers/ai/commands');
const memory = require('../handlers/ai/memory');
const { boomGames } = require('../handlers/game/minigame/boom');
const { bjSessions } = require('../handlers/game/casino/commands');
const { parsePositiveAmount, isAllAmount, resolveAmount } = require('../utils/amount');
const { parseDuration } = require('../utils/duration');
const { getPmMode, setPmMode } = require('../utils/pmMode');
const { registerJidAlias } = require('../utils/jid');
const {
  renderInviteMessage, isAccepted,
} = require('../handlers/game/buckshot/render');
const { resolveTargetInGame } = require('../handlers/game/buckshot/router');

// ─── MOCK SOCKET ───────────────────────────────────────────
let sentTexts = [];
let lastSendOpts = null;
let lastSendContent = null;
let sentTo = [];
let sentOpts = [];
let relayedMessages = [];
let statusMessages = [];
// Peserta grup palsu (diatur per-test utk uji izin admin grup)
let mockGroupMembers = [];
const sock = {
  sendMessage: async (chatId, content, opts) => {
    sentTexts.push(content?.text || '');
    sentTo.push(chatId);
    sentOpts.push({ chatId, opts: opts || null });
    lastSendOpts = opts || null;
    lastSendContent = content || null;
    return { key: { id: 'mock-id' } };
  },
  groupMetadata: async () => ({ participants: mockGroupMembers }),
  profilePictureUrl: async () => { throw new Error('no-pp'); },
  updateMediaMessage: async () => {},
  waUploadToServer: async () => ({ mediaUrl: 'https://x', directPath: '/p' }),
  sendGroupStatusMessage: async (jid, data) => { statusMessages.push({ jid, data }); return { key: { id: 'mock-status' } }; },
  user: { id: '6289999999@s.whatsapp.net' },
};

// ctx dibangun ulang per pesan (body bisa beda)
function makeCtx(body, sender = '6281234567890@s.whatsapp.net') {
  return {
    sock,
    msg: {
      key: { remoteJid: '120363000000000000@g.us', participant: sender, fromMe: false },
      message: { conversation: body },
      pushName: 'Player Test',
    },
    chatId: '120363000000000000@g.us',
    isGroup: true,
    groupId: '120363000000000000@g.us',
    senderJid: sender,
    senderName: 'Player Test',
    body,
    OWNER_JID: '6281234567890@s.whatsapp.net',
    BOT_JID: '6289999999999@s.whatsapp.net',
  };
}

let failures = 0;
let passed = 0;

function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failures++; console.log(`❌ ${label}${detail ? ' — ' + detail : ''}`); }
}

function testAmountParser() {
  check('Parser jumlah menerima 12', parsePositiveAmount('12') === 12);
  check('Parser jumlah menolak 0', parsePositiveAmount('0') === null);
  check('Parser jumlah menolak negatif', parsePositiveAmount('-5') === null);
  check('Parser jumlah menolak pecahan', parsePositiveAmount('1.5') === null);
  check('Parser jumlah menolak hex', parsePositiveAmount('0x10') === null);
  check('Parser jumlah menolak Infinity', parsePositiveAmount('Infinity') === null);
  check('Parser jumlah mengenali semua', isAllAmount(' semua '));
  check('Parser jumlah all butuh maximum positif', resolveAmount('all', 0) === null);
  check('Parser jumlah terima 10.000', parsePositiveAmount('10.000') === 10000);
  check('Parser jumlah terima 1.000.000', parsePositiveAmount('1.000.000') === 1000000);
  check('Parser jumlah terima 10,000', parsePositiveAmount('10,000') === 10000);
  check('Parser jumlah terima 1.000.000.000', parsePositiveAmount('1.000.000.000') === 1000000000);
  check('Parser jumlah tolak 10.00', parsePositiveAmount('10.00') === null);
  check('Parser jumlah tolak 1.500.0', parsePositiveAmount('1.500.0') === null);
  check('Parser jumlah terima 50.000', parsePositiveAmount('50.000') === 50000);
  check('Parser jumlah terima 100,000', parsePositiveAmount('100,000') === 100000);
  check('Parser jumlah tolak 10.0000', parsePositiveAmount('10.0000') === null);
  check('Parser jumlah trim spasi', parsePositiveAmount(' 42 ') === 42);
  check('Parser jumlah terima 99.999', parsePositiveAmount('99.999') === 99999);
}

function testMoneyGuards() {
  const sender = '6289000000001@s.whatsapp.net';
  addMoney(sender, 100);
  const before = getUserMoney(sender);
  const invalid = addMoney(sender, -10) === false
    && addMoney(sender, 1.5) === false
    && deductMoney(sender, 0) === false
    && getUserMoney(sender) === before;
  check('Mutasi money menolak jumlah tidak aman tanpa ubah saldo', invalid, `saldo=${getUserMoney(sender)}`);
}

function testResetMoneyOversize() {
  const sender = '6289000000004@s.whatsapp.net';
  addMoney(sender, 100);
  resetMoney(sender);
  const ok = getUserMoney(sender) === 0;
  check('!reset money nol-kan saldo', ok, `saldo=${getUserMoney(sender)}`);
}

async function testTransferInvalidAmount() {
  const sender = '6289000000002@s.whatsapp.net';
  const target = '6289000000003@s.whatsapp.net';
  addMoney(sender, 100);

  for (const amount of ['0x10', '1.5', '-5']) {
    const senderBefore = getUserMoney(sender);
    const targetBefore = getUserMoney(target);
    sentTexts = [];
    const returned = await route(makeCtx(`!tf @${target.split('@')[0]} ${amount}`, sender));
    const ok = returned === true && sentTexts.length > 0
      && getUserMoney(sender) === senderBefore && getUserMoney(target) === targetBefore;
    check(`!tf ${amount} ditolak tanpa ubah saldo`, ok, `return=${returned} sent=${JSON.stringify(sentTexts)}`);
  }
}

// ─── TEST 1: pesan acak tidak boleh throw (semua handler selamat) ─
async function testRandomMessages() {
  const samples = [
    'halo', 'p', '!', '!x', 'test', 'abc 123', '!fishit', '!p', '!rpg',
    '!togel', '!casino', '!bj', '!tt', '!play', '!smeme', '!change', '!s',
  ];
  let threw = 0;
  for (const body of samples) {
    sentTexts = [];
    try {
      await route(makeCtx(body));
    } catch (e) {
      threw++;
      console.log(`   └─ THROW "${body}": ${e.message}`);
    }
  }
  check('Pesan acak tidak melempar error', threw === 0, `${threw} throw`);
}

// ─── TEST 2: perintah kunci tiap kategori merespons (true / ada kirim) ─
async function testKeyCommands() {
  const cases = [
    ['!menu', 'menu utama'],
    ['!game', 'pemilih game'],
    ['!fishit help', 'fishit'],
    ['!fishit menu', 'fishit menu'],
    ['!p help', 'pokemon'],
    ['!p menu', 'pokemon menu'],
    ['!rpg menu', 'rpg menu'],
    ['!rpg kelas', 'rpg kelas'],
    ['!rpg skill', 'rpg skill'],
    ['!rpg raid', 'rpg raid'],
    ['!rpg raid help', 'rpg raid help'],
    ['!casino help', 'casino'],
    ['!togel menu', 'togel'],
    ['!me', 'profil'],
    ['!claim', 'claim'],
    ['!family100', 'family100'],
    ['!snakes', 'ular tangga'],
    ['!tebakboom', 'tebak boom'],
    ['!pet', 'pet'],
    ['!pet adopt', 'pet adopt'],
    ['!pet top', 'pet top'],
    ['!top money', 'top money'],
    ['!gacha', 'gacha menu'],
    ['!gacha info', 'gacha info'],
  ];

  for (const [body, label] of cases) {
    sentTexts = [];
    let ok = false;
    let err = null;
    try {
      const returned = await route(makeCtx(body));
      ok = returned === true && sentTexts.length > 0;
    } catch (e) { err = e; }
    if (!ok && err) console.log(`   └─ ${body}: ${err.message}`);
    check(`!${label} merespons (${body})`, ok, err?.message || `return=${ok}`);
  }
}

// ─── TEST 3: alur kelas & skill RPG tidak error ─────────
async function testRpgClassSkill() {
  const steps = [
    ['!rpg kelas petarung', 'pilih kelas'],
    ['!rpg skill tebasan', 'pilih skill'],
    ['!rpg kelas', 'menu kelas'],
    ['!rpg kelas miner', 'ganti kelas failed (belum ada kontrak)'],
  ];
  for (const [body, label] of steps) {
    sentTexts = [];
    let ok = false;
    let err = null;
    try {
      const returned = await route(makeCtx(body));
      ok = returned === true && sentTexts.length > 0;
    } catch (e) { err = e; }
    if (!ok && err) console.log(`   └─ ${body}: ${err.message}`);
    check(`RPG kelas/skill ${label} (${body})`, ok, err?.message || `return=${ok}`);
  }
}

// ─── TEST 4: alur mancing FishIt (pesan dulu → 5 detik → hasil) ──
async function testFishItFishing() {
  const sender = '6289998887776@s.whatsapp.net';
  autoRegisterUser(sender, 'Mancing Test');
  // Lokasi 1 (zonk 0) → hasil bukan zonk. Set umpan cukup + flag econV2.
  const p = getFishingPlayer(sender);
  if (p) {
    require('../data/db').updateFishingPlayer(sender, { bait: { bait_1: 10 }, econV2: true, fishingCooldown: 0 });
  }

  let ok = false;
  let err = null;
  try {
    sentTexts = [];
    const r1 = await route(makeCtx('!fishit mancing 1', sender));
    const started = r1 === true && sentTexts.length > 0 && activeFishing.has(sender);
    if (!started) throw new Error('mancing tidak mulai: ' + JSON.stringify(sentTexts.slice(-1)));

    // Tunggu jeda mancing + buffer
    await new Promise(r => setTimeout(r, getFishingDelay() + 1000));

    const invCount = Object.values(getFishingPlayer(sender)?.inventory || {}).reduce((a, v) => a + v.count, 0);
    const leftoverBait = getFishingPlayer(sender)?.bait?.bait_1 || 0;
    if (activeFishing.has(sender)) throw new Error('state mancing masih aktif');
    if (invCount < 1 && leftoverBait >= 10) throw new Error('tidak ada hasil & umpan tak berkurang');
    ok = true;
  } catch (e) { err = e; }
  check('FishIt mancing → tunggu → hasil masuk', ok, err?.message || `activeFishing=${activeFishing.size}`);
}

// ─── TEST 5: !hidetag reply → bot meng-quote pesan X (bukan perintah) ─
async function testHidetagQuote() {
  const admin = '6281234567890@s.whatsapp.net';
  const quotedText = 'pesan asli yang direply admin';
  const ctx = {
    sock,
    msg: {
      key: { remoteJid: '120363000000000000@g.us', participant: admin, fromMe: false },
      message: {
        extendedTextMessage: {
          text: '!hidetag',
          contextInfo: {
            stanzaId: 'STANZA-ABC-123',
            participant: '628111222333@s.whatsapp.net',
            quotedMessage: { conversation: quotedText },
          },
        },
      },
      pushName: 'Player Test',
    },
    chatId: '120363000000000000@g.us',
    isGroup: true,
    groupId: '120363000000000000@g.us',
    senderJid: admin,
    senderName: 'Player Test',
    body: '!hidetag',
    OWNER_JID: admin,
    BOT_JID: '6289999999999@s.whatsapp.net',
  };

  let ok = false;
  let err = null;
  try {
    sentTexts = [];
    lastSendOpts = null;
    const returned = await route(ctx);
    const q = lastSendOpts?.quoted;
    const correctId = q?.key?.id === 'STANZA-ABC-123';
    const correctMsg = q?.message?.conversation === quotedText;
    const notCommand = q?.message?.extendedTextMessage?.text !== '!hidetag';
    ok = returned === true && correctId && correctMsg && notCommand;
    if (!ok) err = `quoted=${JSON.stringify(q)}`;
  } catch (e) { err = e.message; }
  check('!hidetag reply → quote pesan X (bukan perintah)', ok, err);
}

// ─── TEST 5b: reply + titik → prompt dari isi pesan & quote pesan tsb ─
async function testBotReplyQuote() {
  const owner = '6281234567890@s.whatsapp.net';
  const quotedText = 'pesan uji AI';
  const ctx = {
    sock,
    msg: {
      key: { remoteJid: '120363000000000000@g.us', participant: owner, fromMe: false },
      message: {
        extendedTextMessage: {
          text: '.',
          contextInfo: {
            stanzaId: 'STANZA-REPLY-999',
            participant: '628111222333@s.whatsapp.net',
            quotedMessage: { conversation: quotedText },
          },
        },
      },
      pushName: 'Player Test',
    },
    chatId: '120363000000000000@g.us',
    isGroup: true,
    groupId: '120363000000000000@g.us',
    senderJid: owner,
    senderName: 'Player Test',
    body: '.',
    OWNER_JID: owner,
    BOT_JID: '6289999999999@s.whatsapp.net',
  };

  let ok = false;
  let err = null;
  try {
    sentTexts = [];
    lastSendOpts = null;
    const returned = await route(ctx);
    const q = lastSendOpts?.quoted;
    const correctId = q?.key?.id === 'STANZA-REPLY-999';
    const correctMsg = q?.message?.conversation === quotedText;
    const notCommand = q?.message?.extendedTextMessage?.text !== '.';
    ok = returned === true && correctId && correctMsg && notCommand;
    if (!ok) err = `quoted=${JSON.stringify(q)} sent=${JSON.stringify(sentTexts)}`;
  } catch (e) { err = e.message; }
  check('reply + titik → quote pesan X (bukan perintah) & prompt=isi pesan', ok, err);
}

// ─── TEST 5c: PM owner free-text berakhiran titik → AI langsung ─
async function testBotOwnerPm() {
  const owner = '6281234567890@s.whatsapp.net';
  const ctx = {
    sock,
    msg: {
      key: { remoteJid: owner, fromMe: false },
      message: { conversation: 'lagi apa.' },
      pushName: 'Owner Test',
    },
    chatId: owner,
    isGroup: false,
    groupId: null,
    senderJid: owner,
    senderName: 'Owner Test',
    body: 'lagi apa.',
    OWNER_JID: owner,
    BOT_JID: '6289999999999@s.whatsapp.net',
  };

  let ok = false;
  let err = null;
  try {
    sentTexts = [];
    const returned = await route(ctx);
    ok = returned === true && sentTexts.length > 0;
    if (!ok) err = `return=${returned} sent=${JSON.stringify(sentTexts)}`;
  } catch (e) { err = e.message; }
  check('PM owner free-text berakhiran titik → AI langsung', ok, err);

  // PM owner + perintah tak dikenal → info sewa (respon seperti orang asing)
  let ok2 = false;
  let err2 = null;
  try {
    sentTexts = [];
    const ctx2 = { ...ctx, body: '!tes' };
    ctx2.msg = { ...ctx.msg, message: { conversation: '!tes' } };
    const returned2 = await route(ctx2);
    ok2 = returned2 === true && sentTexts.length > 0 && sentTexts.some(t => (t || '').includes('wa.me'));
    if (!ok2) err2 = `return=${returned2} sent=${JSON.stringify(sentTexts)}`;
  } catch (e) { err2 = e.message; }
  check('PM owner perintah tak dikenal (!tes) → info sewa', ok2, err2);

  // PM owner free-text TANPA titik → AI tetap merespons (titik hanya wajib di grup)
  let ok3 = false;
  let err3 = null;
  try {
    sentTexts = [];
    const ctx3 = { ...ctx, body: 'lagi apa' };
    ctx3.msg = { ...ctx.msg, message: { conversation: 'lagi apa' } };
    const returned3 = await route(ctx3);
    ok3 = returned3 === true && sentTexts.length > 0;
    if (!ok3) err3 = `return=${returned3} sent=${JSON.stringify(sentTexts)}`;
  } catch (e) { err3 = e.message; }
  check('PM owner free-text tanpa titik → AI langsung', ok3, err3);

  // Grup free-text TANPA titik → tidak diproses AI (wajib akhiran titik)
  let ok4 = false;
  let err4 = null;
  try {
    sentTexts = [];
    const ctx4 = {
      sock,
      msg: {
        key: { remoteJid: '120363000000000000@g.us', participant: owner, fromMe: false },
        message: { conversation: 'lagi apa' },
        pushName: 'Owner Test',
      },
      chatId: '120363000000000000@g.us',
      isGroup: true,
      groupId: '120363000000000000@g.us',
      senderJid: owner,
      senderName: 'Owner Test',
      body: 'lagi apa',
      OWNER_JID: owner,
      BOT_JID: '6289999999999@s.whatsapp.net',
    };
    const returned4 = await route(ctx4);
    ok4 = returned4 === false && sentTexts.length === 0;
    if (!ok4) err4 = `return=${returned4} sent=${JSON.stringify(sentTexts)}`;
  } catch (e) { err4 = e.message; }
  check('Grup owner free-text tanpa titik → tidak diproses AI', ok4, err4);
}

function testBanTimer() {
  // ─── parseDuration (utils/duration) — unit s/m/h/d/w/mo ───
  const d10s = parseDuration('!ban @a 10s');
  check('Ban durasi 10s → 10.000 ms "10 detik"', d10s?.ms === 10000 && d10s?.label === '10 detik');
  const d5m = parseDuration('!ban @a 5m');
  check('Ban durasi 5m → 300.000 ms "5 menit"', d5m?.ms === 300000 && d5m?.label === '5 menit');
  const d2h = parseDuration('!ban @a 2h');
  check('Ban durasi 2h → 7.200.000 ms "2 jam"', d2h?.ms === 7200000 && d2h?.label === '2 jam');
  const d1d = parseDuration('!ban @a 1d');
  check('Ban durasi 1d → 86.400.000 ms "1 hari"', d1d?.ms === 86400000 && d1d?.label === '1 hari');
  const d1w = parseDuration('!ban @a 1w');
  check('Ban durasi 1w → 604.800.000 ms "1 minggu"', d1w?.ms === 604800000 && d1w?.label === '1 minggu');
  const d1mo = parseDuration('!ban @a 1mo');
  check('Ban durasi 1mo → 2.592.000.000 ms "1 bulan"', d1mo?.ms === 2592000000 && d1mo?.label === '1 bulan');
  const d30m = parseDuration('!allowgroup 30m');
  check('Allowgroup 30m (flex) → 1.800.000 ms "30 menit"', d30m?.ms === 1800000 && d30m?.label === '30 menit');
  check('Ban tanpa durasi → null', parseDuration('!ban @a') === null);
  check('Ban durasi 0/negatif/format salah → null', parseDuration('0m') === null && parseDuration('-5s') === null && parseDuration('abc') === null && parseDuration('10j') === null);

  // ─── parseDurasi (AI teks → kode terpadu) ───
  check('parseDurasi "1 minggu" → 1w', parseDurasi('izinkan grup ini 1 minggu') === '1w');
  check('parseDurasi "1 bulan" → 1mo', parseDurasi('izinkan grup ini 1 bulan') === '1mo');
  check('parseDurasi "5 detik" → 5s', parseDurasi('izinkan grup ini 5 detik') === '5s');
  check('parseDurasi "2 hari" → 2d', parseDurasi('2 hari') === '2d');
  check('parseDurasi "1mo" → 1mo (bukan menit)', parseDurasi('1mo') === '1mo');
  check('parseDurasi "1 tahun" → 365d', parseDurasi('1 tahun') === '365d');
  check('parseDurasi "permanen" → forever', parseDurasi('permanen') === 'forever');

  // ─── DB: ban berdurasi global (lazy expiry) ───
  const uA = '6281111111111@s.whatsapp.net';
  unbanUser(uA); // reset
  banUser(uA, 'owner', Date.now() + 60000);
  check('Ban global masa depan → isUserBanned true', isUserBanned(uA));
  unbanUser(uA);
  banUser(uA, 'owner', Date.now() - 1000);
  check('Ban global expired → isUserBanned false + record terhapus', !isUserBanned(uA) && !isUserBanned(uA));

  // ─── DB: ban berdurasi lokal grup (lazy expiry) ───
  const g = '6280000000000@g.us';
  const uB = '6282222222222@s.whatsapp.net';
  unbanUserInGroup(g, uB); // reset
  banUserInGroup(g, uB, 'admin', Date.now() + 60000);
  check('Ban grup masa depan → isUserBannedInGroup true', isUserBannedInGroup(g, uB));
  unbanUserInGroup(g, uB);
  banUserInGroup(g, uB, 'admin', Date.now() - 1000);
  check('Ban grup expired → isUserBannedInGroup false + record terhapus', !isUserBannedInGroup(g, uB) && !isUserBannedInGroup(g, uB));

  // ─── DB: ban permanen tetap bekerja (tanpa expiresAt) ───
  unbanUser(uA);
  banUser(uA, 'owner');
  check('Ban permanen tetap isUserBanned true', isUserBanned(uA));
  unbanUser(uA);
}

// ─── TEST 5d: izin owner vs admin grup (ban lokal, del, hidetag) ─
async function testOwnerVsGroupAdmin() {
  const owner     = '6281234567890@s.whatsapp.net';
  const grpAdmin  = '628777000111@s.whatsapp.net';
  const grpAdmin2 = '628777000444@s.whatsapp.net';
  const member    = '628777000222@s.whatsapp.net';
  const member2   = '628777000333@s.whatsapp.net';
  const GROUP     = '120363000000000000@g.us';

  mockGroupMembers = [
    { id: owner,    admin: 'superadmin' },
    { id: grpAdmin, admin: 'admin' },
    { id: grpAdmin2, admin: 'admin' },
    { id: member,   admin: null },
    { id: member2,  admin: null },
  ];

  const baseCtx = {
    sock, chatId: GROUP, isGroup: true, groupId: GROUP,
    OWNER_JID: owner, BOT_JID: '6289999999999@s.whatsapp.net',
  };
  const mk = (body, sender) => ({
    ...baseCtx,
    msg: { key: { remoteJid: GROUP, participant: sender, fromMe: false }, message: { conversation: body }, pushName: 'T' },
    senderJid: sender, senderName: 'T', body,
  });

  // (a) Admin grup bisa !hidetag
  let okHidetag = false;
  try { sentTexts = []; const r = await route(mk('!hidetag halo', grpAdmin)); okHidetag = r === true && sentTexts.length > 0; } catch (e) { console.log('   └─', e.message); }
  check('Admin grup → !hidetag boleh', okHidetag);

  // (b) Admin grup bisa !ban member (lokal), member biasa ditolak ban admin lain
  let okBanLocal = false;
  try {
    unbanUserInGroup(GROUP, member); // reset
    sentTexts = [];
    const r = await route(mk(`!ban @${member.split('@')[0]}`, grpAdmin));
    okBanLocal = r === true && isUserBannedInGroup(GROUP, member) && !isUserBanned(member);
  } catch (e) { console.log('   └─', e.message); }
  check('Admin grup → !ban lokal tersimpan (bukan global)', okBanLocal);

  // (b1) Admin grup bisa !ban member dengan durasi
  let okBanDurLocal = false;
  try {
    unbanUserInGroup(GROUP, member); // reset
    sentTexts = [];
    const r = await route(mk(`!ban @${member.split('@')[0]} 10m`, grpAdmin));
    okBanDurLocal = r === true
      && isUserBannedInGroup(GROUP, member)
      && sentTexts.join(' ').includes('10 menit');
    unbanUserInGroup(GROUP, member); // bersihkan
  } catch (e) { console.log('   └─', e.message); }
  check('Admin grup → !ban @x 10m tersimpan + balasan durasi', okBanDurLocal);

  let okBanAdmin = false;
  try {
    sentTexts = [];
    const r = await route(mk(`!ban @${grpAdmin2.split('@')[0]}`, grpAdmin));
    okBanAdmin = r === true && sentTexts.join(' ').includes('admin grup');
  } catch (e) { console.log('   └─', e.message); }
  check('Admin grup → !ban admin lain ditolak', okBanAdmin);

  // (c) Member biasa ditolak !hidetag / !del / !ban
  let okMemberBlocked = false;
  try {
    sentTexts = [];
    const r1 = await route(mk('!hidetag halo', member));
    const r2 = await route(mk('!del', member));
    const r3 = await route(mk(`!ban @${member2.split('@')[0]}`, member));
    okMemberBlocked = r1 === true && r2 === true && r3 === true
      && sentTexts.every(t => t.includes('hanya untuk owner'));
  } catch (e) { console.log('   └─', e.message); }
  check('Member biasa → !hidetag/!del/!ban ditolak', okMemberBlocked);

  // (d) !ban all / !allowgroup tetap owner-only
  let okOwnerOnly = false;
  try {
    sentTexts = [];
    const r1 = await route(mk('!ban all', grpAdmin));
    const r2 = await route(mk('!allowgroup 7d', grpAdmin));
    const r3 = await route(mk('!unban all', grpAdmin));
    okOwnerOnly = r1 === true && r2 === true && r3 === true
      && sentTexts.every(t => t.includes('hanya untuk owner'));
  } catch (e) { console.log('   └─', e.message); }
  check('!ban all / !allowgroup / !unban all → owner-only', okOwnerOnly);

  // (d2) Owner → !allowgroup durasi bebas (flex) 1w & 1mo benar-benar diterima
  let okFlexAg = false;
  try {
    sentTexts = [];
    const r1 = await route(mk('!allowgroup 1w', owner));
    const ok1 = r1 === true && sentTexts.some(t => t.includes('1 Minggu'));
    sentTexts = [];
    const r2 = await route(mk('!allowgroup 1mo', owner));
    const ok2 = r2 === true && sentTexts.some(t => t.includes('1 Bulan'));
    sentTexts = [];
    const r3 = await route(mk('!allowgroup 2h', owner));
    const ok3 = r3 === true && sentTexts.some(t => t.includes('2 jam'));
    okFlexAg = ok1 && ok2 && ok3;
  } catch (e) { console.log('   └─', e.message); }
  check('Owner → !allowgroup 1w/1mo/2h (flex) diterima dengan label', okFlexAg);

  // (d3) Test dioveride sebelumnya → ISOLASI: reset owner-only loop
  let okOwnerOnly2 = false;
  try {
    sentTexts = [];
    const r1 = await route(mk('!allowgroup 7d', grpAdmin));
    okOwnerOnly2 = r1 === true && sentTexts.some(t => t.includes('hanya untuk owner'));
  } catch (e) { console.log('   └─', e.message); }
  check('!allowgroup tetap owner-only (pasca flex test)', okOwnerOnly2);

  // (e) Admin grup boleh !sw (group status ke grup); member biasa ditolak
  let okSwAdmin = false;
  try {
    sentTexts = []; sentTo = []; sentOpts = []; statusMessages = [];
    const r = await route(mk('!sw halo grup', grpAdmin));
    const st = statusMessages.find(x => x.jid === GROUP);
    okSwAdmin = r === true
      && !!st
      && st.data?.text === 'halo grup'
      && sentTexts.some(t => t.includes('berhasil dipasang'));
  } catch (e) { console.log('   └─', e.message); }
  check('Admin grup → !sw pasang group status ke grup', okSwAdmin);

  let okSwMember = false;
  try {
    sentTexts = []; sentTo = [];
    const r = await route(mk('!sw halo grup', member));
    okSwMember = r === true && sentTexts.every(t => t.includes('hanya untuk owner'));
  } catch (e) { console.log('   └─', e.message); }
  check('Member biasa → !sw ditolak', okSwMember);

  // (f) !sw di luar grup (PM) ditolak
  let okSwPm = false;
  try {
    sentTexts = []; sentTo = [];
    const pmCtx = { ...mk('!sw halo', owner), isGroup: false, groupId: null };
    const r = await route(pmCtx);
    okSwPm = r === true && sentTexts.some(t => t.includes('hanya bisa digunakan di dalam grup'));
  } catch (e) { console.log('   └─', e.message); }
  check('!sw di PM → ditolak (harus di grup)', okSwPm);

  mockGroupMembers = [];
}

// ─── TEST 5e: !mode on/off — toggle PM orang asing (owner saja) ─
async function testPmMode() {
  const owner  = '6281234567890@s.whatsapp.net';
  const member = '628777000555@s.whatsapp.net';

  // (a) Owner: !mode off → state & balasan status on
  let okOff = false;
  try {
    setPmMode(true); // reset
    sentTexts = [];
    const r = await route(makeCtx('!mode off', owner));
    okOff = r === true && getPmMode() === false && sentTexts.some(t => t.includes('nonaktif'));
  } catch (e) { console.log('   └─', e.message); }
  check('Owner → !mode off: state off & balasan status', okOff);

  // (b) Owner: !mode on → state kembali on
  let okOn = false;
  try {
    sentTexts = [];
    const r = await route(makeCtx('!mode on', owner));
    okOn = r === true && getPmMode() === true && sentTexts.some(t => t.includes('Mode PM aktif'));
  } catch (e) { console.log('   └─', e.message); }
  check('Owner → !mode on: state on & balasan status', okOn);

  // (c) Non-owner: !mode ditolak
  let okBlocked = false;
  try {
    sentTexts = [];
    const r = await route(makeCtx('!mode off', member));
    okBlocked = r === true && getPmMode() === true && sentTexts.some(t => t.includes('hanya untuk owner'));
  } catch (e) { console.log('   └─', e.message); }
  check('Non-owner → !mode ditolak & state tak berubah', okBlocked);

  // (d) !mode tanpa argumen → tampilkan panduan
  let okUsage = false;
  try {
    sentTexts = [];
    const r = await route(makeCtx('!mode', owner));
    okUsage = r === true && sentTexts.some(t => t.includes('Cara pakai !mode'));
  } catch (e) { console.log('   └─', e.message); }
  check('!mode tanpa argumen → panduan', okUsage);
}

// ─── TEST 6: gacha — tarik mengurangi money & pity jalan ─
async function testGacha() {
  const sender = '628777666555@s.whatsapp.net';
  autoRegisterUser(sender, 'Gacha Test');
  addMoney(sender, 200000);
  const before = getUserMoney(sender);
  const pityBefore = getGachaStats(sender)?.pity || 0;

  let ok = false;
  let err = null;
  try {
    sentTexts = [];
    const returned = await route(makeCtx('!gacha 1', sender));
    const after = getUserMoney(sender);
    const stats = getGachaStats(sender);
    const okPity = (stats?.pity || 0) === pityBefore + 1;
    const okReply = returned === true && sentTexts.length > 0;
    const okChanged = after !== before;
    ok = okPity && okReply && okChanged;
    if (!ok) err = `money ${before}→${after}, return=${returned}, stats=${JSON.stringify(stats)}`;
  } catch (e) { err = e.message; }
  check('Gacha !gacha 1 → money & pity jalan', ok, err);

  // Tarik 10x — pity naik (resets bila dapat Legendary)
  let ok10 = false;
  try {
    addMoney(sender, 1000000);
    const pity0 = getGachaStats(sender)?.pity || 0;
    const before10 = getUserMoney(sender);
    sentTexts = [];
    const returned = await route(makeCtx('!gacha 10', sender));
    const after10 = getUserMoney(sender);
    const s10 = getGachaStats(sender);
    const okPulls = (s10?.pulls || 0) >= 11;
    const okMoney10 = after10 < before10;
    ok10 = returned === true && okPulls && okMoney10 && sentTexts.length > 0;
    if (!ok10) err = `pity0=${pity0} money ${before10}→${after10} pulls=${s10?.pulls}`;
  } catch (e) { err = e.message; ok10 = false; }
  check('Gacha !gacha 10 → 10x tarikan', ok10, err);
}

// ─── TEST 7: top bust — catat kerugian BJ & leaderboard mention ─
async function testTopBust() {
  const groupId = '120363000000000000@g.us';
  const loser = '6281111111111@s.whatsapp.net';

  let okEmpty = false;
  try {
    sentTexts = [];
    const returned = await route(makeCtx('!top bust'));
    okEmpty = returned === true && sentTexts.some(t => t.includes('Belum ada kerugian Blackjack'));
  } catch (e) { console.log('   └─', e.message); }
  check('!top bust tanpa data → pesan belum ada kerugian', okEmpty);

  let okTop = false;
  try {
    recordBjLoss(groupId, loser, 500);
    sentTexts = [];
    const returned = await route(makeCtx('!top bust'));
    const text = sentTexts[0] || '';
    okTop = returned === true
      && text.includes('TOP BUST')
      && text.includes('@6281111111111')
      && text.includes('500')
      && (lastSendContent?.mentions || []).includes(loser);
    if (!okTop) console.log('   └─', text, JSON.stringify(lastSendContent?.mentions));
  } catch (e) { console.log('   └─', e.message); }
  check('!top bust → leaderboard global + mention loser', okTop);
}

// ─── TEST 9: Tebak Boom — room, join, start, buka kotak ─
async function testBoom() {
  const GROUP = '120363000000000000@g.us';
  const p1 = '628100200300@s.whatsapp.net';
  const p2 = '628100200301@s.whatsapp.net';
  addMoney(p1, 100000);
  addMoney(p2, 100000);
  const b1 = getUserMoney(p1);
  const b2 = getUserMoney(p2);

  let okCreate = false;
  try {
    sentTexts = [];
    const r = await route(makeCtx('!tebakboom 1000', p1));
    okCreate = r === true && sentTexts.some(t => t.includes('Room Tebak Boom')) && getUserMoney(p1) === b1 - 1000;
  } catch (e) { console.log('   └─', e.message); }
  check('Tebak Boom !tebakboom 1000 → room & saldo terpotong', okCreate);

  let okJoin = false;
  try {
    sentTexts = [];
    const r = await route(makeCtx('!tebakboom join', p2));
    okJoin = r === true && sentTexts.some(t => t.includes('bergabung')) && getUserMoney(p2) === b2 - 1000;
  } catch (e) { console.log('   └─', e.message); }
  check('Tebak Boom join → terdaftar & saldo terpotong', okJoin);

  let okStart = false;
  try {
    sentTexts = [];
    const r = await route(makeCtx('!tebakboom start', p1));
    okStart = r === true && sentTexts.some(t => t.includes('DIMULAI'));
  } catch (e) { console.log('   └─', e.message); }
  check('Tebak Boom start → game dimulai', okStart);

  let okOpen = false;
  try {
    const game = boomGames.get(GROUP);
    const giliran = game && game.turnOrder[game.turnIndex];
    sentTexts = [];
    const r = await route(makeCtx('!buka 1', giliran));
    okOpen = r === true && sentTexts.length > 0;
  } catch (e) { console.log('   └─', e.message); }
  check('Tebak Boom !buka 1 (giliran aktif) → merespons', okOpen);

  boomGames.delete(GROUP);
}

// ─── TEST 8: ingatan AI — fakta, lupa, daftar, riwayat ─
async function testBotMemory() {
  const owner = '6281234567890@s.whatsapp.net';
  const pmCtx = {
    sock,
    msg: { key: { remoteJid: owner, fromMe: false }, message: { conversation: '' }, pushName: 'Owner Test' },
    chatId: owner,
    isGroup: false,
    groupId: null,
    senderJid: owner,
    senderName: 'Owner Test',
    body: '',
    OWNER_JID: owner,
    BOT_JID: '6289999999999@s.whatsapp.net',
  };
  const mkPm = (body) => ({ ...pmCtx, body, msg: { ...pmCtx.msg, message: { conversation: body } } });

  // (a) "ingat bahwa X" → konfirmasi + fakta tersimpan
  let okRemember = false;
  try {
    sentTexts = [];
    const r = await route(mkPm('ingat bahwa nama kamu Rudi.'));
    okRemember = r === true && sentTexts.some(t => t.includes('✅ Diingat: nama kamu Rudi'))
      && memory.getFacts().includes('nama kamu Rudi');
  } catch (e) { console.log('   └─', e.message); }
  check('"ingat bahwa X." → fakta tersimpan', okRemember);

  // (b) "daftar ingatan" → menampilkan fakta
  let okList = false;
  try {
    sentTexts = [];
    const r = await route(mkPm('daftar ingatan.'));
    const text = sentTexts.join(' ');
    okList = r === true && text.includes('Ingatan (1)') && text.includes('nama kamu Rudi');
  } catch (e) { console.log('   └─', e.message); }
  check('"daftar ingatan." → list fakta', okList);

  // (c) "lupakan X" → fakta terhapus
  let okForget = false;
  try {
    sentTexts = [];
    const r = await route(mkPm('lupakan rudi.'));
    okForget = r === true && sentTexts.some(t => t.includes('🗑️ Dihapus 1'))
      && !memory.getFacts().includes('nama kamu Rudi');
  } catch (e) { console.log('   └─', e.message); }
  check('"lupakan X." → fakta dihapus', okForget);

  // (d) parser kenali pola (bukan lewat AI)
  let okParser = false;
  try {
    const rem = parseIntent('tolong ingat bahwa proyek X jalan');
    const remBody = rem && rem.body.startsWith('memory:remember:');
    const fgt = parseIntent('lupa rudi');
    okParser = remBody && fgt && fgt.body.startsWith('memory:forget:');
  } catch (e) { console.log('   └─', e.message); }
  check('parseIntent kenali ingat/lupa (tanpa AI)', okParser);

  // (e) riwayat: push & cap 100 pesan (sesuai MAX_HISTORY memory.js — sengaja 100)
  let okHistory = false;
  try {
    for (let i = 0; i < 60; i++) memory.pushHistory(`tanya ${i}`, `jawab ${i}`); // 60 call = 120 entri
    const h = memory.getHistory();
    okHistory = h.length === 100 && h[0].content === 'tanya 10' && h[h.length - 1].content === 'jawab 59';
  } catch (e) { console.log('   └─', e.message); }
  check('riwayat chat cap 100 pesan (paling baru)', okHistory);
}

// ─── TEST 10: fitur porting NexaBot (fun & tools stateless) ─
async function testNexaCommands() {
  const run = async (body) => {
    sentTexts = [];
    const returned = await route(makeCtx(body));
    return { returned, text: sentTexts.join(' ') };
  };

  // Command acak merespons
  for (const [body, label] of [
    ['!jokes', 'jokes'], ['!lucu', 'lucu'], ['!quote', 'quote'], ['!kutipan', 'kutipan'],
    ['!dare', 'dare'], ['!tantangan', 'tantangan'], ['!truth', 'truth'], ['!jujur', 'jujur'],
  ]) {
    let ok = false;
    try { const r = await run(body); ok = r.returned === true && r.text.length > 0; } catch { /* noop */ }
    check(`Nexa !${label} merespons (${body})`, ok);
  }

  // 8ball: tanpa argumen → minta pertanyaan; dengan argumen → jawaban
  let ok8bEmpty = false;
  try {
    const r = await run('!8ball');
    ok8bEmpty = r.returned === true && r.text.toLowerCase().includes('tanyakan');
  } catch { /* noop */ }
  check('Nexa !8ball tanpa argumen → minta pertanyaan', ok8bEmpty);

  let ok8b = false;
  try {
    const r = await run('!8ball aku menang?');
    ok8b = r.returned === true && r.text.includes('🎱');
  } catch { /* noop */ }
  check('Nexa !8ball dengan pertanyaan → jawaban', ok8b);

  // Dice: default 1 dadu; jumlah di-clamp & tolak negatif
  let okDice1 = false;
  try {
    const r = await run('!dice');
    const m = r.text.match(/Total: (\d+)/);
    okDice1 = r.returned === true && m && +m[1] >= 1 && +m[1] <= 6 && !r.text.includes('|');
  } catch { /* noop */ }
  check('Nexa !dice default → 1 dadu', okDice1);

  let okDiceNeg = false;
  try {
    const r = await run('!dice -5');
    const m = r.text.match(/Total: (\d+)/);
    okDiceNeg = r.returned === true && m && +m[1] >= 1; // -5 ditolak → default 1 dadu
  } catch { /* noop */ }
  check('Nexa !dice -5 → guard jumlah (default 1 dadu)', okDiceNeg);

  // Base64 round-trip enc → dec
  let okB64 = false;
  try {
    const e = await run('!base64 enc halo');
    const enc = (e.text.match(/`([^`]+)`/) || [])[1];
    const d = await run(`!base64 dec ${enc}`);
    okB64 = enc === 'aGFsbw==' && d.text.includes('`halo`');
  } catch { /* noop */ }
  check('Nexa !base64 enc→dec round-trip', okB64);

  // Calc: aritmetika benar & injeksi huruf ditolak
  let okCalc = false;
  try {
    const r = await run('!calc 12*8+3');
    okCalc = r.returned === true && r.text.includes('= 99');
  } catch { /* noop */ }
  check('Nexa !calc 12*8+3 = 99', okCalc);

  let okCalcSafe = false;
  try {
    const r = await run('!calc process.exit(1)');
    okCalcSafe = r.returned === true && r.text.includes('Hanya mendukung');
  } catch { /* noop */ }
  check('Nexa !calc injeksi teks → ditolak sanitasi', okCalcSafe);
}

// ─── TEST 11: !jadian menjodohkan dengan anggota acak grup ─
async function testJodian() {
  const GROUP = '120363000000000000@g.us';
  const sender = '6281234567890@s.whatsapp.net';
  const bot = '6289999999999@s.whatsapp.net';
  const m1 = '628777000222@s.whatsapp.net';
  const m2 = '628777000333@s.whatsapp.net';

  // Isi anggota grup palsu (mock global di bawah)
  mockGroupMembers = [
    { id: bot, admin: 'superadmin' },
    { id: sender, admin: null },
    { id: m1, admin: null },
    { id: m2, admin: null },
  ];

  let ok = false;
  let err = null;
  try {
    sentTexts = [];
    lastSendContent = null;
    const returned = await route(makeCtx('!jadian', sender));
    const mentions = lastSendContent?.mentions || [];
    const inSet = mentions.includes(m1) || mentions.includes(m2);
    ok = returned === true
      && sentTexts.length > 0
      && mentions.length === 2
      && mentions.includes(sender)
      && inSet
      && !mentions.includes(bot);
    if (!ok) err = `mentions=${JSON.stringify(mentions)} sent=${JSON.stringify(sentTexts)}`;
  } catch (e) { err = e.message; }
  check('!jadian → jodoh anggota acak (mention sender + 1 member)', ok, err);

  // PM → ditolak
  let okPm = false;
  try {
    sentTexts = [];
    const ctx = makeCtx('!jadian', sender);
    ctx.isGroup = false; ctx.groupId = null; ctx.chatId = sender;
    ctx.msg.key.remoteJid = sender;
    const returned = await route(ctx);
    okPm = returned === true && sentTexts.some(t => t.includes('cuma bisa'));
  } catch (e) { console.log('   └─', e.message); }
  check('!jadian di PM → ditolak', okPm);

  mockGroupMembers = [];
}

// ─── TEST 12: !tebak angka — start, guard, reply, reward ─
async function testTebakAngka() {
  const GROUP = '120363000000000000@g.us';
  const sender = '6281234567890@s.whatsapp.net';
  autoRegisterUser(sender, 'Tebak Test');
  addMoney(sender, 0); // pastikan ada entry

  const mkReply = (body, stanzaId) => ({
    sock,
    msg: {
      key: { remoteJid: GROUP, participant: sender, fromMe: false },
      message: {
        extendedTextMessage: {
          text: body,
          contextInfo: { stanzaId, participant: sender, quotedMessage: { conversation: '🎲' } },
        },
      },
      pushName: 'Tebak Test',
    },
    chatId: GROUP,
    isGroup: true,
    groupId: GROUP,
    senderJid: sender,
    senderName: 'Tebak Test',
    body,
    OWNER_JID: '6281234567890@s.whatsapp.net',
    BOT_JID: '6289999999999@s.whatsapp.net',
  });

  // (a) start → prompt 1-100
  let okStart = false;
  try {
    sentTexts = [];
    const r = await route(makeCtx('!tebak', sender));
    okStart = r === true && sentTexts.some(t => t.includes('1-100'));
  } catch (e) { console.log('   └─', e.message); }
  check('!tebak → mulai & prompt 1-100', okStart);

  // (b) arg tidak valid → guard
  let okGuard = false;
  try {
    sentTexts = [];
    const r1 = await route(makeCtx('!tebak -5', sender));
    const r2 = await route(makeCtx('!tebak abc', sender));
    okGuard = r1 === true && r2 === true && sentTexts.join(' ').includes('angka 1-100');
  } catch (e) { console.log('   └─', e.message); }
  check('!tebak -5 / abc → guard angka 1-100', okGuard);

  // (c) tebak via reply ke pesan prompt (msgId mock = 'mock-id')
  let okReply = false;
  try {
    sentTexts = [];
    const r = await route(mkReply('50', 'mock-id'));
    okReply = r === true && sentTexts.some(t => t.includes('Lebih') || t.includes('BENAR') || t.includes('Sudah'));
    if (!okReply) throw new Error('sent=' + JSON.stringify(sentTexts));
  } catch (e) { console.log('   └─', e.message); }
  check('!tebak via reply pesan prompt → diproses', okReply);

  // (d) loop 1..100 sampai menang → money naik REWARD (1000)
  let okWin = false;
  let err = null;
  try {
    await route(makeCtx('!tebak stop', sender)); // bersihkan sesi
    sentTexts = [];
    await route(makeCtx('!tebak', sender)); // mulai baru
    const before = getUserMoney(sender);
    let won = false;
    for (let n = 1; n <= 100 && !won; n++) {
      sentTexts = [];
      const r = await route(makeCtx('!tebak ' + n, sender));
      if (r === true && sentTexts.some(t => t.includes('BENAR'))) won = true;
    }
    const after = getUserMoney(sender);
    okWin = won && after === before + 1000;
    if (!okWin) err = `before=${before} after=${after} won=${won}`;
  } catch (e) { err = e.message; }
  check('!tebak loop 1..100 → menang & +1000 money', okWin, err);
}

async function testBankAndRob() {
  const user = '628111222333@s.whatsapp.net';
  const target = '628444555666@s.whatsapp.net';

  // 1. Initial State
  resetMoney(user);
  resetMoney(target);
  addMoney(user, 1000);

  // 2. Deposit Test
  sentTexts = [];
  await route(makeCtx('!depo 400', user));
  check('!depo 400 memotong cash dan menambah bank', getUserMoney(user) === 600 && getBankData(user).balance === 400);

  // 3. Deposit All
  await route(makeCtx('!depo all', user));
  check('!depo all memasukkan sisa uang ke bank', getUserMoney(user) === 0 && getBankData(user).balance === 1000);

  // 4. Withdraw Test
  await route(makeCtx('!tarik 300', user));
  check('!tarik 300 mengembalikan cash dari bank', getUserMoney(user) === 300 && getBankData(user).balance === 700);

  // 5. Saldo Bank Kebal Begal Test
  // Target hanya punya saldo di bank, cash 0
  getBankData(target).balance = 50000;
  sentTexts = [];
  const ctxRobProtected = makeCtx(`!begal @628444555666`, user);
  ctxRobProtected.msg.message.extendedTextMessage = {
    text: `!begal @628444555666`,
    contextInfo: { mentionedJid: [target] },
  };
  await route(ctxRobProtected);
  check('Uang di bank kebal begal (target cash 0 ditolak)', sentTexts.some(t => t.includes('terlalu miskin') || t.includes('aman dari begal')));

  // 6. Test Begal dengan Cash cukup
  addMoney(target, 2000);
  sentTexts = [];
  await route(ctxRobProtected);
  check('Aksi !begal diproses (sukses atau gagal tertangkap)', sentTexts.some(t => t.includes('BERHASIL') || t.includes('GAGAL TOTAL')));
}

async function testBuckshotRoulette() {
  const p1 = '628111222333@s.whatsapp.net';
  const p2 = '628444555666@s.whatsapp.net';
  const chatId = '120363000000000000@g.us';

  const { buckshotGames, deleteGame } = require('../handlers/game/buckshot/state');
  deleteGame(chatId);

  // 1. Test Solo vs Dealer Bot
  resetMoney(p1);
  addMoney(p1, 500);
  sentTexts = [];
  let r = await route(makeCtx('!br bot 100', p1));
  check('!br bot 100 memulai game vs Bot', r === true && buckshotGames.has(chatId));
  check('Taruhan dipotong saat main vs Bot', getUserMoney(p1) === 400);

  const botGame = buckshotGames.get(chatId);
  check('Game vs Bot memiliki 2 pemain (termasuk DEALER_BOT)', botGame && botGame.players.includes('DEALER_BOT'));

  // Test !brstats
  sentTexts = [];
  r = await route(makeCtx('!brstats', p1));
  check('!brstats menampilkan status shotgun', r === true && sentTexts.some(t => t.includes('Status Senapan')));

  // Test tembak diri sendiri
  sentTexts = [];
  r = await route(makeCtx('!tembak diri', p1));
  check('!tembak diri diproses oleh game', r === true && sentTexts.some(t => t.includes('DORRR') || t.includes('KLIK')));

  deleteGame(chatId);

  // 2. Test PvP Challenge + Terima
  resetMoney(p1);
  resetMoney(p2);
  addMoney(p1, 1000);
  addMoney(p2, 1000);

  sentTexts = [];
  const ctxChallenge = makeCtx('!br @628444555666 200', p1);
  ctxChallenge.msg.message.extendedTextMessage = {
    text: '!br @628444555666 200',
    contextInfo: { mentionedJid: [p2] },
  };
  r = await route(ctxChallenge);
  check('!br @user 200 membuat tantangan pending', r === true && buckshotGames.has(chatId) && buckshotGames.get(chatId).stage === 'waiting');

  // Test non-invited mencoba terima -> ditolak
  sentTexts = [];
  const nonInvited = '628999111222@s.whatsapp.net';
  r = await route(makeCtx('!terima', nonInvited));
  check('Non-invited tidak bisa menerima tantangan', sentTexts.some(t => t.includes('tidak termasuk dalam daftar pemain')));

  // Target menerima tantangan
  sentTexts = [];
  r = await route(makeCtx('!terima', p2));
  const pvpGame = buckshotGames.get(chatId);
  check('Target @user berhasil menerima tantangan', r === true && pvpGame && pvpGame.stage === 'playing');
  check('Taruhan kedua pemain terpotong untuk pot', getUserMoney(p1) === 800 && getUserMoney(p2) === 800);

  deleteGame(chatId);
}

// ─── TEST: fix mention di Buckshot ────────────────────────
// 1) resolveTargetInGame: tag nomor HP harus kena pemain yang tersimpan LID
//    (alias-aware), jadi tembakan/borgol tidak miss jadi NaN damage.
// 2) isAccepted + renderInviteMessage: status "Siap" dihitung alias-aware,
//    sehingga penerima yang key JID-nya beda domain tetap tampil ✅.
async function testBuckshotMentionAlias() {
  registerJidAlias('91079999999999@lid', '628777888999');
  registerJidAlias('91076666666666@lid', '628555777888');

  // Tag "628555777888" (nomor HP lid2) padahal pemain disimpan sebagai LID
  const game = {
    players: ['91079999999999@lid', '91076666666666@lid'],
    hp: { '91079999999999@lid': 3, '91076666666666@lid': 2 },
  };
  const resolved = resolveTargetInGame(game, '628555777888@s.whatsapp.net', '91079999999999@lid');
  check('resolveTargetInGame memetakan tag HP ke pemain LID', resolved === '91076666666666@lid');

  const unknown = resolveTargetInGame(game, '628000000000@s.whatsapp.net', '91079999999999@lid');
  check('resolveTargetInGame tidak mengubah tag yang tidak dikenal', unknown === '628000000000@s.whatsapp.net');

  const inviteGame = {
    creator: '91079999999999@lid',
    invited: ['628777888999@s.whatsapp.net'],
    accepted: { '91079999999999@lid': true, '91076666666666@lid': true },
    bet: 100,
  };
  check('isAccepted alias-aware (LID key, invited phone jid)', isAccepted(inviteGame, '628777888999@s.whatsapp.net'));
  const invite = renderInviteMessage(inviteGame);
  check('renderInviteMessage menampilkan penerima LID sebagai Siap', invite.includes('✅ Siap'));
  check('renderInviteMessage tetap menampilkan daftar pemain via mention @nomor', invite.includes('@628777888999'));
}

// ─── TEST: Blackjack bagikan 2 kartu awal (+ natural blackjack) ──
// Setiap pemain menerima tepat 2 kartu saat game dimulai; pemain dengan
// 21 alami (2 kartu) otomatis ditandai done & diumumkan BLACKJACK.
async function testBlackjackDeal() {
  const GROUP = '120363000000000000@g.us';
  const p1 = '628100200400@s.whatsapp.net';
  const p2 = '628100200401@s.whatsapp.net';
  resetMoney(p1);
  resetMoney(p2);
  addMoney(p1, 1000);
  addMoney(p2, 1000);

  const cleanup = () => {
    const list = bjSessions[GROUP] || [];
    for (const s of list) if (s.timer) clearTimeout(s.timer);
    delete bjSessions[GROUP];
  };

  let okCreate = false;
  try {
    cleanup();
    sentTexts = [];
    const ctxChallenge = makeCtx('!bj @628100200401 100', p1);
    ctxChallenge.msg.message.extendedTextMessage = {
      text: '!bj @628100200401 100',
      contextInfo: { mentionedJid: [p2] },
    };
    const r = await route(ctxChallenge);
    okCreate = r === true && sentTexts.some(t => t.includes('Tantangan Blackjack'));
  } catch (e) { console.log('   └─', e.message); }
  check('Blackjack !bj @user 100 membuat tantangan pending', okCreate);

  let okDeal = false;
  try {
    sentTexts = [];
    const r = await route(makeCtx('!bj terima', p2));
    const board = sentTexts.find(t => t.includes('🎮 Game dimulai!')) || '';
    const kartuLines = (board.match(/Kartu: [^\n]*/g) || []);
    okDeal = r === true
      && board.includes('🎮 Game dimulai!')
      && kartuLines.length === 2
      && kartuLines.every(l => l.replace('Kartu: ', '').trim().split(/\s+/).length === 2);
    if (!okDeal) console.log('   └─ board:', board);
  } catch (e) { console.log('   └─', e.message); }
  check('Blackjack game dimulai: tiap pemain dapat 2 kartu', okDeal);

  cleanup();
}

// ─── TEST: top begal — leaderboard begal global ─
async function testTopBegal() {
  const p1 = '628100200700@s.whatsapp.net';
  updateRobStats(p1, true, 750);

  let okTop = false;
  try {
    sentTexts = [];
    const returned = await route(makeCtx('!top begal'));
    const text = sentTexts[0] || '';
    okTop = returned === true
      && text.includes('TOP BEGAL GLOBAL')
      && text.includes('@628100200700')
      && text.includes('750')
      && (lastSendContent?.mentions || []).includes(p1);
    if (!okTop) console.log('   └─', text, JSON.stringify(lastSendContent?.mentions));
  } catch (e) { console.log('   └─', e.message); }
  check('!top begal → leaderboard global + mention + jarahan', okTop);
}

// ─── TEST: top bobol — leaderboard bobol global ─
async function testTopBobol() {
  // Guard: !bobol target tanpa tabungan bank → ditolak (uji routing tanpa acak)
  let okGuard = false;
  try {
    const p2 = '628100200801@s.whatsapp.net';
    resetMoney(p2);
    addMoney(p2, 1000);
    sentTexts = [];
    const ctxRob = makeCtx('!bobol @628100200802', p2);
    ctxRob.msg.message.extendedTextMessage = {
      text: '!bobol @628100200802',
      contextInfo: { mentionedJid: ['628100200802@s.whatsapp.net'] },
    };
    const r = await route(ctxRob);
    okGuard = r === true && sentTexts.some(t => t.includes('terlalu tipis'));
  } catch (e) { console.log('   └─', e.message); }
  check('!bobol @user (bank target kosong) → ditolak', okGuard);

  const p1 = '628100200800@s.whatsapp.net';
  updateBobolStats(p1, true, 800);

  let okTop = false;
  try {
    sentTexts = [];
    const returned = await route(makeCtx('!top bobol'));
    const text = sentTexts[0] || '';
    okTop = returned === true
      && text.includes('TOP BOBOL GLOBAL')
      && text.includes('@628100200800')
      && text.includes('800')
      && (lastSendContent?.mentions || []).includes(p1);
    if (!okTop) console.log('   └─', text, JSON.stringify(lastSendContent?.mentions));
  } catch (e) { console.log('   └─', e.message); }
  check('!top bobol → leaderboard global + mention + jarahan bank', okTop);
}

(async () => {
  console.log('── SMOKE TEST — struktur pasca-rombak ──');
  console.log(`Sandbox: ${sandbox}\n`);

  testAmountParser();
  testMoneyGuards();
  testResetMoneyOversize();
  await testTransferInvalidAmount();
  await testBankAndRob();
  await testRandomMessages();
  await testKeyCommands();
  await testRpgClassSkill();
  await testFishItFishing();
  await testHidetagQuote();
  await testBotReplyQuote();
  await testBotOwnerPm();
  testBanTimer();
  await testOwnerVsGroupAdmin();
  await testPmMode();
  await testGacha();
  await testTopBust();
  await testTopBegal();
  await testTopBobol();
  await testBlackjackDeal();
  await testBoom();
  await testBotMemory();
  await testNexaCommands();
  await testJodian();
  await testTebakAngka();
  await testBuckshotRoulette();
  await testBuckshotMentionAlias();

  console.log(`\n── Hasil: ${passed} lulus, ${failures} gagal ──`);
  if (failures > 0) process.exit(1);
  console.log('✅ SMOKE TEST LULUS');
})();
