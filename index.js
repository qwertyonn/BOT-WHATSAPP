// ============================================================
// UNIFIED BOT - FishIt + Pokemon + RPG (Single WhatsApp Group)
// Prefix: !game untuk memilih game
//         !fishit xxx untuk Fishing
//         !p xxx untuk Pokemon
//         !rpg xxx untuk RPG
//         !play xxx untuk Memutar Musik/Video YouTube
// ============================================================
require('dotenv').config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino       = require('pino');
const qrcode     = require('qrcode-terminal');
const readline   = require('readline');
const path       = require('path');
const fs = require('fs');

// ─── Routing Handler (semua fitur dipindah ke handlers/) ──────
const { route } = require('./handlers/router');
const { parseButtonId } = require('./utils/buttons');
const { isUserBanned, isUserBannedInGroup, autoRegisterUser } = require('./data/db');
const { sameUser, getNumber, registerJidAlias, resolveNum } = require('./utils/jid');
const { getAllowedGroups, saveAllowedGroups } = require('./utils/groupAccess');
const { getPmMode } = require('./utils/pmMode');

const SESSION_PATH = path.join(__dirname, 'session');

// Konsol interaktif (tombol R/Q saat login), dibuat ulang per startBot()
let rl = null;

// Net proses: error async tak tertangani TIDAK boleh mematikan bot
// (default Node >=15 adalah exit) — cukup catat; reconnect tetap jalan.
process.on('unhandledRejection', (err) => console.error('⚠️ unhandledRejection:', err));
process.on('uncaughtException',  (err) => console.error('⚠️ uncaughtException:', err));

// ─── RECONNECT TAHAN-GAGAL ──────────────────────────────
// Semua penyambungan ulang lewat scheduleReconnect(): anti dobel jadwal,
// backoff eksponensial (3 dtk → maks 5 mnt), dan startBot yang gagal saat
// reconnect (internet masih mati, file session terkunci) otomatis dicoba
// lagi dengan jeda makin panjang — bukan mati diam selamanya.
let sessionGen       = 0;                       // naik tiap startBot(); listener sesi lama diabaikan
let activeSock       = null;                    // socket sesi berjalan (untuk di-end saat reconnect)
let reconnectTimer   = null;                    // guard anti dobel jadwal reconnect
const RECONNECT_BASE_MS = 1;
const RECONNECT_MAX_MS  = 5 * 60 * 1000;
let reconnectDelay = RECONNECT_BASE_MS;         // direset ke base tiap berhasil 'open'

function scheduleReconnect(reason) {
  if (reconnectTimer) return; // sudah ada percobaan terjadwal
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS); // naik untuk percobaan berikutnya
  console.log(`🔁 Reconnect dalam ${Math.round(delay / 1000)} dtk (${reason})`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try { activeSock?.end?.(new Error('reconnecting')); } catch (e) { /* abaikan */ }
    try {
      await startBot();
    } catch (err) {
      console.error('❌ startBot gagal saat reconnect:', err.message || err);
      scheduleReconnect('start gagal'); // coba lagi, jeda makin panjang
    }
  }, delay);
}

// ─── AUTO-CLEANUP FILE TMP ──────────────────────────────
// Menghapus otomatis file sementara (tmp_* & dasu.response) di folder root
// agar tidak menumpuk & menghemat penyimpanan. Dipanggil saat start,
// berkala, dan saat proses keluar.
function cleanupTmpFiles(opts = {}) {
  const olderThanMs = opts.olderThanMs || 0;
  const now         = Date.now();
  let deleted       = 0;

  // Scan root (file ffmpeg legacy) + direktori .tmp (file download)
  const scanDirs = [__dirname, path.join(__dirname, '.tmp')];
  for (const dir of scanDirs) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (err) {
      continue; // .tmp belum ada → abaikan
    }

    for (const name of files) {
      const isTmp = name.startsWith('tmp_') || name === 'dasu.response';
      if (!isTmp) continue;

      const filePath = path.join(dir, name);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        if (olderThanMs > 0 && now - stat.mtimeMs < olderThanMs) continue;
        fs.unlinkSync(filePath);
        deleted++;
        console.log(`🧹 File tmp dihapus: ${name}`);
      } catch (e) { /* abaikan */ }
    }
  }

  if (deleted > 0) console.log(`🧹 Auto-cleanup: ${deleted} file tmp dihapus.`);
  return deleted;
}

// Cleanup berkala (safety net): hapus file tmp berumur > 10 menit setiap 10 menit
const tmpCleanupInterval = setInterval(
  () => cleanupTmpFiles({ olderThanMs: 10 * 60 * 1000 }),
  10 * 60 * 1000
);
tmpCleanupInterval.unref?.();

// Cleanup saat proses keluar / di-kill
process.once('SIGINT',  () => { cleanupTmpFiles(); process.exit(0); });
process.once('SIGTERM', () => { cleanupTmpFiles(); process.exit(0); });
process.once('exit',    () => { try { cleanupTmpFiles(); } catch (e) { /* abaikan */ } });

// ─── CONFIGURATION ENVS ─────────────────────────────────
const OWNER_JID = process.env.OWNER_JID;
const BOT_JID = process.env.BOT_JID;
const PAIRING_NUMBER = process.env.PAIRING_NUMBER;

// ─── CEK FFMPEG (untuk fitur video/stiker/download) ─────
const { resolveFfmpeg } = require('./utils/ffmpeg');
function ffmpegAvailable() {
  return fs.existsSync(resolveFfmpeg().ffmpeg);
}
function warnIfNoFfmpeg() {
  if (!ffmpegAvailable()) {
    console.log('⚠️  PERINGATAN: FFmpeg tidak ditemukan di folder proyek!');
    console.log('    Fitur video tidak akan berfungsi: stiker video (!s), !tovid,');
    console.log('    !change video, !toaudio, dan download video/audio !play / !tt.');
    console.log('    Solusi Windows: jalankan  scripts/install-ffmpeg.bat  sekali, lalu restart bot.');
    console.log('    Solusi Termux : taruh binary ffmpeg & ffprobe di folder  ffmpeg/bin  (dalam proyek)');
    console.log('                    lalu  chmod +x  keduanya, dan restart bot.\n');
  } else {
    console.log('✅ FFmpeg terdeteksi — semua fitur media aktif.\n');
  }
}

// ────────────────────────────────────────────────────────
async function startBot() {
  sessionGen++;              // sesi baru; listener socket lama jadi tidak valid
  const myGen = sessionGen;
  console.log('\n🎮 ==========================================');
  console.log(' UNIFIED BOT — FishIt 🎣 + Pokemon 🎮 + RPG ⚔️ ');
  console.log('==========================================\n');
  warnIfNoFfmpeg();

  // Peringatan sisa percobaan pairing yang belum selesai
  try {
    const credsPath = path.join(SESSION_PATH, 'creds.json');
    if (fs.existsSync(credsPath)) {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      if (creds.registered === false && creds.pairingCode) {
        console.log('⚠️  Ada sisa percobaan pairing yang belum selesai (registered: false).');
        console.log('    Jika pairing terus gagal, hapus folder session untuk mulai bersih:');
        console.log('    Termux: rm -rf session   |   Windows: hapus folder session\n');
      }
    }
  } catch (e) { /* abaikan */ }

  // Bersihkan file tmp sisa dari sesi sebelumnya (crash / kill)
  cleanupTmpFiles();

  let pairingRequested = false;
  let forceQR = false;
  let lastQr = null;

  function showQR(qr) {
    lastQr = qr;
    console.log('📱 Scan QR Code berikut:\n');
    qrcode.generate(qr, { small: true });
    console.log('\n💡 WhatsApp → Perangkat Tertaut → Tautkan Perangkat\n');
  }

  async function requestPairing() {
    try {
      const code = await sock.requestPairingCode(PAIRING_NUMBER);
      console.log('\n📲 Kode Pairing: ' + code + '  (valid ±2 menit)');
      console.log('   WhatsApp → Perangkat Tertaut → Tautkan Perangkat Dengan Nomor Telepon');
      console.log('   ⌨️  Tekan R = buat kode baru | Q = beralih ke QR\n');
      return true;
    } catch (err) {
      console.log(`❌ Pairing gagal (${err.message}). Beralih ke QR...`);
      forceQR = true;
      if (lastQr) showQR(lastQr);
      return false;
    }
  }

  // Migrasi sekali pakai sudah dihapus (data sudah real JID & ekonomi global).

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

  // Ambil versi web WhatsApp terbaru (fallback ke versi Baileys bila gagal)
  let version;
  try {
    const waVersion = await fetchLatestWaWebVersion();
    version = waVersion.version;
  } catch (e) {
    const bv = await fetchLatestBaileysVersion();
    version = bv.version;
  }

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    logger:            pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser:           Browsers.ubuntu('Chrome'),
    syncFullHistory:   false,
  });
  activeSock = sock;

  // ─── Kontrol Interaktif: R = kode pairing baru | Q = paksa QR ───
  if (rl) rl.close();
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  rl.on('line', (line) => {
    const key = line.trim().toLowerCase();
    if (key === 'r') {
      if (PAIRING_NUMBER && !sock.authState.creds.registered) {
        pairingRequested = true;
        requestPairing();
      } else {
        console.log('⚠️  Pairing tidak aktif (PAIRING_NUMBER kosong / sudah terdaftar).');
      }
    } else if (key === 'q') {
      forceQR = true;
      if (lastQr) showQR(lastQr);
    }
  });

  
  // ─── Koneksi ───────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    if (myGen !== sessionGen) return; // event dari sesi/socket lama → abaikan
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      lastQr = qr;
      if (forceQR || !PAIRING_NUMBER || sock.authState.creds.registered) {
        showQR(qr);
      } else if (!pairingRequested) {
        pairingRequested = true;
        await requestPairing();
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('🚪 Bot logout. Hapus folder /session untuk login ulang.');
        return;
      }
      scheduleReconnect(
        code === DisconnectReason.restartRequired
          ? 'penautan berhasil, server minta restart'
          : `terputus (kode ${code})`
      );
    }
    if (connection === 'open') {
      reconnectDelay = RECONNECT_BASE_MS; // sukses tersambung → reset backoff
      console.log('✅ Bot terhubung!');
      console.log('🎣 FishIt  — Prefix: !fishit xxx');
      console.log('🎮 Pokemon — Prefix: !p xxx');
      console.log('⚔️  RPG    — Prefix: !rpg xxx');
      console.log('🎵 YouTube — Prefix: !play [judul]');
      console.log('🎮 Info    — Prefix: !game\n');
    }
  });

  sock.ev.on('creds.update', () => { if (myGen === sessionGen) saveCreds(); });

  // ─── Pesan Masuk ───────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (myGen !== sessionGen) return; // sesi lama → abaikan
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        const fromBotSelf = !!msg.key.fromMe;
        if (msg.key.remoteJid === 'status@broadcast') continue;

    const chatId = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const groupId = isGroup ? chatId : null;

    // ─── DIAGNOSA TOMBOL ─── pesan non-teks (respons tombol, dll) dicetak
    // mentah agar format respons nyata terlihat. Hanya tipe+kunci singkat.
    const msgKeys = Object.keys(msg.message || {});
    if (!msgKeys.includes('conversation') && !msgKeys.includes('extendedTextMessage')) {
      const btnId = (() => {
        try {
          return JSON.parse(msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id;
        } catch { return null; }
      })();
      console.log(`🧪 NON-TEKS ${isGroup ? 'GRUP' : 'PM'} tipe=[${msgKeys.join(',')}] remote=${chatId} participant=${msg.key.participant || '-'} btnId=${btnId}`);
    }

    // Identitas pengirim pakai JID mentah WhatsApp apa adanya (bisa @lid untuk
    // akun LID). Ini penting: mention/highlight harus sama persis dengan JID
    // member di grup. Resolusi LID->HP untuk key DB & deteksi owner dilakukan
    // di data/db.js via alias (JID_ALIASES).
    let senderJid = msg.key.participant || msg.key.remoteJid;

    // Self-heal alias LID->HP: bila participantAlt (nomor HP) tersedia dan
    // beda nomor dari JID mentah, catat agar key DB & deteksi owner konsisten.
    const altJid = isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt;
    if (altJid && getNumber(altJid) !== getNumber(senderJid)) registerJidAlias(senderJid, altJid);

    // ─── VALIDASI WHITELIST & MASA AKTIF GRUP ───
    const isOwner = sameUser(senderJid, OWNER_JID);

    // Jika pengirim BUKAN owner, jalankan pembatasan akses
    if (!isOwner) {
      if (isGroup) {
        const allowedGroups = getAllowedGroups();
        const groupData = allowedGroups[groupId];
        const now = Date.now();

        // Grup belum terdaftar → abaikan
        if (!groupData) continue;

        // Grup permanen → selalu aktif, tanpa cek kedaluwarsa
        if (groupData.permanent) {
          // allowed
        } else if (now > groupData.expiredAt) {
          delete allowedGroups[groupId];
          saveAllowedGroups(allowedGroups);
          continue; // Abaikan pesan dari user biasa di grup tak terdaftar/expired
        }
      } else {
        // Chat PM dari orang asing. Mode on (default): arahkan ke owner
        // (info sewa bot). Mode off: abaikan total, tak dibalas & tak diproses.
        if (getPmMode()) {
          const ownerNum = resolveNum(OWNER_JID);
          sock.sendMessage(chatId, {
            text: `👋 Halo! Mau sewa bot ini?\nSilakan chat ke owner:\n📱 https://wa.me/${ownerNum}`,
          });
        }
        continue;
      }
    }
    // ─── BATAS VALIDASI WHITELIST ───

    // Tombol interaktif: id tombol = command. Bridge → diperlakukan seperti
    // user mengetik command itu (mis. ketuk "Profil" → body = "!me").
    let body = parseButtonId(msg);
    if (!body) {
      body = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ''
      ).trim();
    }

    if (!body) continue;

    // Anti-loop: pesan dari akun bot sendiri (dariMe) hanya diproses bila berupa
    // command (!), agar balasan bot tidak ikut diproses ulang tanpa henti.
    if (fromBotSelf && !body.startsWith('!')) continue;

        senderJid  = msg.key.participant || msg.key.remoteJid;
        const senderName = msg.pushName || senderJid.split('@')[0] || 'Player';

        // ─── BAN CHECK — abaikan pesan dari user yang dibanned ───
        if (isUserBanned(senderJid)) continue;

        // Ban lokal per grup: user di-ban oleh admin grup tidak bisa pakai
        // fitur bot di grup itu, tapi masih normal di grup lain.
        if (isGroup && isUserBannedInGroup(groupId, senderJid)) continue;

        console.log(`📨 [${isGroup ? 'GRUP' : 'PM'}] ${senderName}: ${body}`);

        // ─── AUTO-REGISTRASI ─── pengguna pertama kali memakai
        // command bot langsung terdaftar di 3 game (nama = nickname WA)
        if (body.startsWith('!')) autoRegisterUser(senderJid, senderName);

        // ─── DISPATCH ROUTER ─── panggil handler berurutan ─────────
        const ctx = {
          sock, msg, chatId, isGroup, groupId,
          senderJid, senderName, body,
          OWNER_JID, BOT_JID,
        };

        if (await route(ctx)) continue;


      } catch (err) {
        console.error('❌ Error memproses pesan:', err);
      }
    }
  });

  return sock;
}

startBot().catch(err => {
  console.error('❌ Gagal menjalankan bot:', err);
  process.exit(1);
});
