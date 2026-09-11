// handlers/utility/menuCommands.js
// Menu utama: !menu dan halaman pemilih game !game (pakai tombol interaktif)
const ui = require('../../utils/ui');
const { listButton, sendMenu } = require('../../utils/buttons');

// ─── !menu — teks panel menu utama ─────────────────────────
function buildMenuText(senderName) {
  return ui.box(`Menu Utama`, [
    `Halo *${senderName}*, pilih perintah di bawah.`,
    ``,
    ui.section(`💰 *Uang & akun*`),
    ui.inlineCmd('!me', 'Profil & saldo'),
    ui.inlineCmd('!bank', 'Bank & bunga'),
    ui.inlineCmd('!claim', 'Reward harian'),
    ui.inlineCmd('!gacha', 'Gacha hadiah'),
    ui.inlineCmd('!tf', 'Transfer uang'),
    ui.inlineCmd('!gantinama', 'Ganti nama game'),
    ui.inlineCmd('!begal', 'Begal pemain'),
    ui.inlineCmd('!bobol', 'Bobol bank'),
    ui.inlineCmd('!top money / !top bust', 'Top terkaya & kerugian'),
    ui.inlineCmd('!top begal / !top bobol', 'Top begal & bobol'),
    ``,
    ui.section(`🎮 *Game utama*`),
    ui.inlineCmd('!game', 'Daftar semua game'),
    ui.inlineCmd('!fishit menu', 'Mancing'),
    ui.inlineCmd('!p menu', 'Pokemon'),
    ui.inlineCmd('!rpg menu', 'RPG & raid'),
    ui.inlineCmd('!casino help', 'Casino'),
    ui.inlineCmd('!togel menu', 'Togel'),
    ui.inlineCmd('!mahjong', 'Mahjong'),
    ``,
    ui.section(`🕹️ *Mini game*`),
    ui.inlineCmd('!family100', 'Family 100'),
    ui.inlineCmd('!ttt', 'TicTacToe'),
    ui.inlineCmd('!suit', 'Suit'),
    ui.inlineCmd('!br', 'Buckshot Roulette'),
    ui.inlineCmd('!pet menu', 'Pet Arena'),
    ui.inlineCmd('!snakes', 'Ular tangga'),
    ui.inlineCmd('!tebak', 'Tebak angka'),
    ui.inlineCmd('!tebakboom', 'Tebak Boom'),
    ``,
    ui.section(`🎉 *Fun & sosial*`),
    ui.inlineCmd('!jadian', 'Cari jodoh'),
    ui.inlineCmd('!jokes', 'Jokes'),
    ui.inlineCmd('!quote', 'Kutipan'),
    ui.inlineCmd('!truth', 'Truth'),
    ui.inlineCmd('!dare', 'Dare'),
    ui.inlineCmd('!8ball', 'Bola ramalan'),
    ui.inlineCmd('!dice', 'Dadu'),
    ``,
    ui.section(`🎵 *Media & downloader*`),
    ui.inlineCmd('!play', 'YouTube'),
    ui.inlineCmd('!playlirik', 'Lagu + lirik'),
    ui.inlineCmd('!tt', 'TikTok'),
    ui.inlineCmd('!send', 'Repost media HD'),
    ``,
    ui.section(`🖼️ *Alat & stiker*`),
    ui.inlineCmd('!s', 'Stiker'),
    ui.inlineCmd('!smeme', 'Stiker meme'),
    ui.inlineCmd('!toimg / !tovid', 'Stiker → foto/video'),
    ui.inlineCmd('!toaudio', 'Video → audio'),
    ui.inlineCmd('!change', 'Potong rasio'),
    ui.inlineCmd('!getpp', 'Foto profil'),
    ui.inlineCmd('!b64', 'Base64'),
    ui.inlineCmd('!calc', 'Kalkulator'),
    ui.inlineCmd('!afk', 'AFK'),
    ``,
  ], 'Ketik ! lalu nama perintah');
}

// ─── !menu — Menu utama bot ────────────────────────────────
async function handleMenu(ctx) {
  const { sock, msg, chatId, body, senderName } = ctx;
  if (body.toLowerCase() !== '!menu') return false;

  const text = buildMenuText(senderName);
  await sendMenu(sock, chatId, {
    text,
    title: `Menu Utama`,
    footer: `Pilih kategori`,
    quoted: msg,
    fallbackText: text,
    buttons: [
      listButton('📋 Buka Menu', [
        { title: '💰 Uang & akun', rows: [
          { title: 'Profil & Saldo', description: 'Lihat data akun', id: '!me' },
          { title: 'Bank & Bunga', description: 'Simpan & klaim bunga', id: '!bank' },
          { title: 'Klaim Harian', description: 'Reward gratis', id: '!claim' },
          { title: 'Gacha', description: 'Gacha harian', id: '!gacha' },
          { title: 'Transfer Uang', description: 'Kirim ke pemain lain', id: '!tf' },
          { title: 'Ganti Nama', description: 'Semua game (100k)', id: '!gantinama' },
        ] },
        { title: '🥷 Begal & Bobol', rows: [
          { title: 'Begal Pemain', description: 'Rampok cash (50%)', id: '!begal' },
          { title: 'Bobol Bank', description: 'Rampok tabungan bank', id: '!bobol' },
          { title: 'Top Begal', description: 'Peringkat begal', id: '!top begal' },
          { title: 'Top Bobol', description: 'Peringkat bobol', id: '!top bobol' },
        ] },
        { title: '🎮 Game utama', rows: [
          { title: 'Daftar Game', description: 'Semua game', id: '!game' },
          { title: 'FishIt', description: 'Mancing santai', id: '!fishit menu' },
          { title: 'Pokemon', description: 'Tangkap & battle', id: '!p menu' },
          { title: 'RPG', description: 'Dungeon & raid', id: '!rpg menu' },
          { title: 'Casino', description: 'Blackjack & dadu', id: '!casino help' },
          { title: 'Togel', description: 'Tebak angka', id: '!togel menu' },
          { title: 'Mahjong', description: 'Solo & 4 pemain', id: '!mahjong' },
        ] },
        { title: '🕹️ Mini game', rows: [
          { title: 'Family 100', description: 'Kuis grup', id: '!family100' },
          { title: 'TicTacToe', description: 'Tris 2 pemain', id: '!ttt' },
          { title: 'Suit', description: 'Batu-gunting-kertas', id: '!suit' },
          { title: 'Ular Tangga', description: 'Klasik', id: '!snakes' },
          { title: 'Pet Arena', description: 'Adu pet', id: '!pet menu' },
          { title: 'Tebak Angka', description: '1-100 gratis', id: '!tebak' },
          { title: 'Tebak Boom', description: 'Tebak bom', id: '!tebakboom' },
          { title: 'Buckshot Roulette', description: '1v1 / PvP', id: '!br help' },
        ] },
        { title: '🎉 Fun & sosial', rows: [
          { title: 'Cari Jodoh', description: 'Random di grup', id: '!jadian' },
          { title: 'Jokes', description: 'Receh', id: '!jokes' },
          { title: 'Kutipan', description: 'Motivasi', id: '!quote' },
          { title: 'Truth', description: 'Tantangan jujur', id: '!truth' },
          { title: 'Dare', description: 'Tantangan menantang', id: '!dare' },
          { title: 'Bola Ramalan', description: '8-ball', id: '!8ball bot' },
          { title: 'Dadu', description: 'Keberuntungan', id: '!dice' },
        ] },
        { title: '🎵 Media & downloader', rows: [
          { title: 'YouTube', description: 'Audio/video', id: '!play' },
          { title: 'Lagu + Lirik', description: 'Kartu & audio', id: '!playlirik' },
          { title: 'TikTok', description: 'Tanpa logo', id: '!tt' },
          { title: 'Repost Media', description: 'Kirim ulang HD', id: '!send' },
        ] },
        { title: '🖼️ Alat & stiker', rows: [
          { title: 'Stiker', description: 'Dari media', id: '!s' },
          { title: 'Stiker Meme', description: 'Meme teks', id: '!smeme' },
          { title: 'Stiker → Foto/Video', description: 'Konversi ulang', id: '!toimg' },
          { title: 'Video → Audio', description: 'Ekstrak audio', id: '!toaudio' },
          { title: 'Potong Rasio', description: '1:1 / 9:16 / 16:9', id: '!change' },
          { title: 'Foto Profil', description: 'Ambil PP WA', id: '!getpp' },
          { title: 'Base64', description: 'Encode/decode', id: '!b64' },
          { title: 'Kalkulator', description: 'Hitung cepat', id: '!calc' },
          { title: 'AFK', description: 'Status pergi', id: '!afk' },
        ] },
      ]),
    ],
  });
  return true;
}

// ─── !game — teks panel pemilih game ───────────────────────
function buildGameText() {
  return ui.box(`Game Utama`, [
    `Semua game pakai akun *Money* yang sama.`,
    ``,
    ui.section(`🎣 *FishIt*`),
    ui.inlineCmd('!fishit mancing 1', 'Mulai mancing'),
    ui.inlineCmd('!fishit menu', 'Menu lengkap'),
    ``,
    ui.section(`⚡ *Pokemon*`),
    ui.inlineCmd('!p spawn', 'Spawn liar'),
    ui.inlineCmd('!p menu', 'Menu lengkap'),
    ``,
    ui.section(`⚔️ *RPG*`),
    ui.inlineCmd('!rpg tebang', 'Tebang pohon'),
    ui.inlineCmd('!rpg tambang', 'Menambang'),
    ui.inlineCmd('!rpg menu', 'Menu lengkap'),
    ``,
    ui.section(`🎰 *Casino, togel, mahjong*`),
    ui.inlineCmd('!bj', 'Blackjack'),
    ui.inlineCmd('!togel', 'Togel 2D/3D/4D'),
    ui.inlineCmd('!mahjong', 'Mahjong 1-4 pemain'),
    ui.inlineCmd('!br', 'Buckshot Roulette'),
    ``,
    ui.section(`🕹️ *Mini game*`),
    ui.inlineCmd('!family100', 'Kuis grup'),
    ui.inlineCmd('!suit', 'Suit klasik'),
    ui.inlineCmd('!ttt', 'TicTacToe'),
    ui.inlineCmd('!pet menu', 'Pet Arena'),
    ui.inlineCmd('!snakes', 'Ular tangga'),
    ui.inlineCmd('!tebakboom', 'Tebak Boom'),
    ``,
  ], 'Ketik nama game untuk mulai');
}

// ─── !game — Halaman pemilih game ──────────────────────────
async function handleGame(ctx) {
  const { sock, msg, chatId, body } = ctx;
  if (body.toLowerCase() !== '!game') return false;

  const text = buildGameText();
  await sendMenu(sock, chatId, {
    text,
    title: `Game Utama`,
    footer: `Pilih game`,
    quoted: msg,
    fallbackText: text,
    buttons: [
      listButton('🎮 Buka Game', [
        { title: '🎣 FishIt', rows: [
          { title: 'Status Mancing', description: 'Tangkapan & joran', id: '!fishit profil' },
          { title: 'Daftar Lokasi', description: 'Spot memancing', id: '!fishit lokasi' },
          { title: 'Jual Semua Ikan', description: 'Tukar jadi Money', id: '!fishit jual all' },
          { title: 'Menu FishIt', description: 'Lengkap', id: '!fishit menu' },
        ] },
        { title: '⚡ Pokemon', rows: [
          { title: 'Spawn Pokemon', description: 'Pokemon liar', id: '!p spawn' },
          { title: 'Trainer Profil', description: 'Statistik', id: '!p profil' },
          { title: 'Koleksi', description: 'Pokemon milikmu', id: '!p koleksi' },
          { title: 'Leaderboard', description: 'Top trainer', id: '!p rank' },
          { title: 'Menu Pokemon', description: 'Lengkap', id: '!p menu' },
        ] },
        { title: '⚔️ RPG', rows: [
          { title: 'Karakter', description: 'Status & equip', id: '!rpg profil' },
          { title: 'Tebang Pohon', description: 'Kayu crafting', id: '!rpg tebang' },
          { title: 'Tambang', description: 'Bijih & emas', id: '!rpg tambang' },
          { title: 'Shop', description: 'Senjata & armor', id: '!rpg shop' },
          { title: 'Raid Boss', description: 'Boss 1-6 pemain', id: '!rpg raid' },
          { title: 'Menu RPG', description: 'Lengkap', id: '!rpg menu' },
        ] },
        { title: '🎰 Casino & togel', rows: [
          { title: 'Blackjack', description: 'Melawan dealer', id: '!bj' },
          { title: 'Casino', description: 'Dadu & lainnya', id: '!casino help' },
          { title: 'Togel', description: 'Tebak angka', id: '!togel' },
          { title: 'Mahjong', description: 'Solo & 4 pemain', id: '!mahjong' },
        ] },
        { title: '🕹️ Mini game', rows: [
          { title: 'Family 100', description: 'Kuis grup', id: '!family100' },
          { title: 'Suit', description: 'Batu-gunting-kertas', id: '!suit' },
          { title: 'TicTacToe', description: 'Tris 2 pemain', id: '!ttt' },
          { title: 'Ular Tangga', description: 'Klasik', id: '!snakes' },
          { title: 'Tebak Boom', description: 'Tebak bom', id: '!tebakboom' },
          { title: 'Pet Arena', description: 'Adu pet', id: '!pet menu' },
        ] },
        { title: '🔙 Menu Utama', rows: [
          { title: 'Kembali', description: 'Semua fitur bot', id: '!menu' },
        ] },
      ]),
    ],
  });
  return true;
}

module.exports = { handleMenu, handleGame, buildMenuText, buildGameText };