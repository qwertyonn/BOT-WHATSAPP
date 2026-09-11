// test/mahjong.test.js
// Test Mahjong: engine murni (win detection, AI discard) + handler solo flow
// (setup, draw, discard) terhadap mock socket di sandbox.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

// ─── SANDBOX ─────────────────────────────────────────────
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-test-'));
process.env.BOT_DB_PATH = path.join(sandbox, 'database.json');
process.env.BOT_BACKUP_DIR = path.join(sandbox, 'backups');
process.env.BOT_AI_MEMORY_PATH = path.join(sandbox, 'ai_memory.json');

const eng = require('../game/mahjongEngine');
const { route } = require('../handlers/router');
const { autoRegisterUser, getUserMoney } = require('../data/db');

let sentTexts = [];
let relayCount = 0;
const sock = {
  sendMessage: async (chatId, content) => {
    sentTexts.push(content?.text || '');
    return { key: { id: 'mock-id' } };
  },
  relayMessage: async () => { relayCount++; },
  groupMetadata: async () => ({ participants: [] }),
  profilePictureUrl: async () => { throw new Error('no-pp'); },
  updateMediaMessage: async () => {},
  waUploadToServer: async () => ({ mediaUrl: 'https://x', directPath: '/p' }),
  user: { id: '6289999999@s.whatsapp.net' },
};

function makeCtx(body, sender = '6281234567890@s.whatsapp.net') {
  return {
    sock, msg: { key: { remoteJid: sender, participant: sender }, pushName: 'MJTest' },
    chatId: sender, isGroup: false, groupId: null,
    senderJid: sender, senderName: 'MJTest', body,
    OWNER_JID: sender, BOT_JID: sender,
  };
}

let checks = 0, passed = 0;
function check(name, cond) {
  checks++;
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else console.log(`  ❌ ${name}`);
}

// ─── ENGINE TESTS ────────────────────────────────────────
function testEngine() {
  console.log('\n── ENGINE ──');

  // Wall 108 & format
  check('createWall → 108 tile', eng.createWall().length === 108);
  check('tileLabel m5 → M5', eng.tileLabel('m5') === 'M5');
  check('parseTile m9 valid', JSON.stringify(eng.parseTile('m9')) === JSON.stringify({ suit: 'm', rank: 9 }));
  check('parseTile x0 invalid', eng.parseTile('x0') === null);

  // Win: 4 set + 1 pair
  const w1 = ['m1','m2','m3','p1','p2','p3','s1','s1','s1','s5','s5','s7','s8','s9'];
  check('winHand double-seq menang', eng.isWinningHand(w1));

  const w2 = ['m5','m5','m5','p7','p7','p7','s2','s3','s4','s9','s9','m3','m4','m5'];
  check('winHand triplet menang', eng.isWinningHand(w2));

  // Non-win
  const bad = ['m1','m2','m3','p1','p2','p3','s1','s1','s5','s5','s9','m4','m5','s8'];
  check('badHand (2set+3pair+2spare) gagal', !eng.isWinningHand(bad));

  const pairs = ['m1','m1','m2','m2','m3','m3','p4','p4','s5','s5','s6','s6','m7','m7'];
  check('all-pairs gagal', !eng.isWinningHand(pairs));

  // Tenpai / canWinWith
  const thir = ['m1','m2','m3','p1','p2','p3','s7','s8','s9','s5','s5','s5','s9'];
  check('canWinWith s9 → menang', eng.canWinWith(thir, 's9'));
  check('canWinWith m9 → tidak', !eng.canWinWith(thir, 'm9'));
  check('isTenpai benar', eng.isTenpai(thir));

  // Discard / bestDiscard / botTurn
  const h14 = eng.sortHand(['m1','m2','m3','p5','p5','s2','s2','s2','s7','s7','s7','m4','s6','s8']);
  const bd = eng.bestDiscard(h14);
  check('bestDiscard → hand 13 & tile milik hand', bd.hand.length === 13 && h14.includes(bd.tile));
  const bt = eng.botTurn(h14);
  check('botTurn non-win → discard', bt.type === 'discard' && bt.hand.length === 13);
  const bw = eng.botTurn(w1);
  check('botTurn win hand → win', bw.type === 'win');

  // isWallEmpty
  check('isWallEmpty true utk kosong', eng.isWallEmpty([]));

  // dealHand pakai wall real
  const wall = eng.createWall();
  const hand13 = eng.dealHand(wall);
  check('dealHand → 13 tile', hand13.length === 13);
  check('wall berkurang 13', wall.length === 95);
}

// ─── HANDLER (penolakan PM + solo di grup) ───────────────
async function testHandler() {
  console.log('\n── HANDLER (PM tolak + solo grup) ──');
  const sender = '6281234567890@s.whatsapp.net';
  autoRegisterUser(sender, 'MJTest');
  const before = getUserMoney(sender);

  // PM: mulai game harus ditolak (hanya grup).
  sentTexts = [];
  let ok = await route(makeCtx('!mahjong solo 100', sender));
  const pmMsg = sentTexts.join(' ');
  check('!mahjong solo di PM → consumed', ok === true);
  check('!mahjong solo di PM → pesan grup-only', /hanya.*grup/.test(pmMsg));
  check('!mahjong solo di PM → tidak reserve ante', getUserMoney(sender) === before);

  sentTexts = [];
  ok = await route(makeCtx('!mahjong', sender));
  check('!mahjong di PM → consumed', ok === true);

  // Solo vs bot di GRUP.
  const GROUP = '120363000000000000@g.us';
  function gctx(body, snd) {
    return { sock, msg: { key: { remoteJid: GROUP, participant: snd }, pushName: 'X' },
      chatId: GROUP, isGroup: true, groupId: GROUP,
      senderJid: snd, senderName: 'X', body, OWNER_JID: snd, BOT_JID: GROUP };
  }

  const beforeG = getUserMoney(sender);
  sentTexts = [];
  ok = await route(gctx('!mahjong 100 solo', sender));
  check('!mahjong 100 solo di grup → consumed', ok === true);
  check('ante solo di grup ter-reserve', getUserMoney(sender) === beforeG - 100);

  sentTexts = [];
  ok = await route(gctx('!draw', sender));
  check('!draw (solo grup) → consumed', ok === true);

  sentTexts = [];
  ok = await route(gctx('!dis m1', sender));
  check('!dis (resource tak ada) → consumed, no crash', ok === true);

  sentTexts = [];
  ok = await route(gctx('!mahjong batal', sender));
  check('!mahjong batal → refund ante', ok === true && getUserMoney(sender) === beforeG);

  // !mahjong polos di grup → tampil panduan, tanpa reserve.
  const beforeH = getUserMoney(sender);
  sentTexts = [];
  ok = await route(gctx('!mahjong', sender));
  const helpMsg = sentTexts.join(' ');
  check('!mahjong polos di grup → consumed', ok === true);
  check('!mahjong polos → panduan (bukan mulai)', /PANDUAN/.test(helpMsg) && !/Game dimulai/.test(helpMsg));
  check('!mahjong polos → tak reserve ante', getUserMoney(sender) === beforeH);
}

// ─── HANDLER (multi room undangan di grup) ───────────────
async function testMulti() {
  console.log('\n── HANDLER (multi room undangan) ──');
  const GROUP = '120363000000000000@g.us';
  const creator = '6281111111111@s.whatsapp.net';
  const p2 = '6282222222222@s.whatsapp.net';
  const p3 = '6283333333333@s.whatsapp.net';
  autoRegisterUser(creator, 'Creator');
  autoRegisterUser(p2, 'P2');
  autoRegisterUser(p3, 'P3');

  function gctx(body, sender) {
    return { sock, msg: { key: { remoteJid: GROUP, participant: sender }, pushName: 'X' },
      chatId: GROUP, isGroup: true, groupId: GROUP,
      senderJid: sender, senderName: 'X', body, OWNER_JID: creator, BOT_JID: GROUP };
  }

  // !mahjong dengan ante tanpa solo/tag → tolak + panduan singkat.
  sentTexts = [];
  let ok = await route(gctx('!mahjong 100', creator));
  const tolakMsg = sentTexts.join(' ');
  check('!mahjong 100 (tanpa solo/tag) → tolak', ok === true && /Pilih mode/.test(tolakMsg));

  // Buat room multi: undang p2 (tag manual @6282222222222).
  sentTexts = [];
  relayCount = 0;
  ok = await route(gctx('!mahjong 100 @6282222222222', creator));
  check('!mahjong 100 @p2 → room dibuat', ok === true && relayCount > 0);

  // Yang TIDAK diundang tidak boleh join.
  sentTexts = [];
  ok = await route(gctx('!mahjong join', p3));
  const blokMsg = sentTexts.join(' ');
  check('!mahjong join (tidak diundang) → ditolak', ok === true && /tidak diundang/.test(blokMsg));

  // Yang diundang join → auto-start (semua undangan masuk).
  sentTexts = [];
  ok = await route(gctx('!mahjong join', p2));
  check('!mahjong join (diundang) → consumed & auto-start', ok === true);

  // Cancel + refund khusus creator (game sudah jalan di sesi).
  sentTexts = [];
  ok = await route(gctx('!mahjong batal', creator));
  check('!mahjong batal (creator) → refund', ok === true);

  // Flow manual: room, join 1 undangan, lalu creator mulai manual.
  sentTexts = [];
  await route(gctx('!mahjong 500 @6282222222222', creator));
  await route(gctx('!mahjong join', p2));
  sentTexts = [];
  ok = await route(gctx('!mahjong mulai', creator));
  check('!mahjong mulai manual (≥2) → game jalan', ok === true);
  sentTexts = [];
  ok = await route(gctx('!mahjong batal', creator));
  check('batal game multi → refund', ok === true);
}

// ─── RUN ─────────────────────────────────────────────────
(async () => {
  console.log(`── MAHJONG TEST — sandbox: ${sandbox}`);
  testEngine();
  await testHandler();
  await testMulti();
  console.log(`\n${passed}/${checks} checks passed`);
  process.exit(checks === passed ? 0 : 1);
})();
