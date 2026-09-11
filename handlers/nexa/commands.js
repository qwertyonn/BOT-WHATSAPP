// handlers/nexa/commands.js
// Fitur fun & tools hasil porting dari NexaBot (folder bot/) — stateless,
// tanpa API eksternal, tanpa DB. Semua command berprefix '!'.
const { sameUser, getNumber } = require('../../utils/jid');
const { addMoney } = require('../../data/db');
const { parsePositiveAmount } = require('../../utils/amount');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function tokenOf(body) {
  return (body || '').trim().split(/\s+/)[0].toLowerCase();
}

async function reply(ctx, text) {
  await ctx.sock.sendMessage(ctx.chatId, { text }, { quoted: ctx.msg });
}

const JOKES = [
  'Kenapa ayam nyebrang jalan? Karena ke pinggir jalan.',
  'Apa bedanya tukang becak sama tukang bakso? Tukang becak muter, tukang bakso enak.',
  'Kenapa semut naik kuda? Karena kudanya diam.',
  'Apa bahasa Inggrisnya "sudah mandi"? Already bath.',
  'Kenapa kucing diusir dari rumah? Karena meong (melong).',
  'Bapakmu karawang? Bukan, bapakmu yang karawang.',
  'Apa yang dikatakan bola saat lelah? Aku butuh istirahat bola.',
  'Kenapa huruf A tak punya teman? Karena dia sombong (som-A).',
  'Berapa berat hati yang patah? 1 broken-heart.',
  'Kenapa ikan paling pintar? Karena selalu di sekolah (di sek-olah).',
  'Kenapa kopi selalu pagi bangun? Karena dia kedudukan (ke-du-kut).',
  'Apa makanan kesukaan hantu? Soto setan (so-tong).',
  'Kenapa pensil tak bisa bohong? Karena dia lurus.',
  'Apa bahasa Inggrisnya "lapar"? Hungry, tapi kalau kelaparan massal disebut hungry bersama.',
  'Kenapa komputer demam? Karena banyak virus.',
  'Apa bedanya awan dan kompor? Awan di atas, kompor di bawah (kom-por = kompor).',
  'Kenapa buku selalu tenang? Karena dia banyak baca, dikit bicara.',
  'Apa kata kunci pohon kalau capek? Root-ah (istirahat).',
  'Kenapa lampu merah malu? Karena di-lihat semua orang.',
  'Apa yang dikatakan roti sebelum bertengkar? Ayo, kita loaf (love) lagi.',
  'Kenapa kentang masuk sekolah? Mau jadi kentang goreng sarjana.',
  'Apa pelajaran favorit gunung? Geologi, karena dia suka naik.',
  'Kenapa kaca selalu jujur? Karena dia transparan.',
  'Apa bahasa Inggrisnya "beli rokok"? Buy rokok, tapi kalau ketahuan istri jadi bye-rokok.',
  'Kenapa jam tangan galak? Karena suka nge-jam (jejam) orang.',
  'Apa kata sapi sebelum tidur? Moo-tid (good night).',
  'Kenapa pensil lulus ujian? Karena dia poin-poin terus.',
  'Apa bedanya matahari dan pelajar? Matahari terbit pagi, pelajar terbit (online) malam.',
  'Kenapa sapu ikut demo? Mau hak menyapu bersih.',
  'Apa yang dikatakan gedung ke gedung lain? Kita bertingkat-tingkat.',
  'Kenapa kunci selalu tenang? Karena dia punya kunci ketenangan.',
  'Apa bahasa Inggrisnya "ketinggalan bis"? Miss the bus, tapi kalau sering terjadi jadi Mister Bus.',
  'Kenapa gelas sedih? Karena isinya kosong, hatinya pun.',
  'Apa makanan favorit matematika? Pi-zza.',
  'Kenapa sepatu selalu berpasangan? Karena dia tak mau jomblo.',
  'Apa kata kura-kura kalau menang lari? Pelan-pelan tapi pasti, bro.',
  'Kenapa penghapus dimusuhi? Karena suka menghilangkan kesalahan orang.',
  'Apa bahasa Inggrisnya "kemalaman"? Late night, tapi kalau di hutan jadi lost night.',
  'Kenapa sabun suka mandi? Karena itu kerjanya.',
  'Apa yang dikatakan baterai lemah? Aku kehilangan energi cinta.',
  'Kenapa peta selalu bingung? Karena sering dilipat.',
  'Apa bedanya kulkas dan mantan? Dua-duanya bikin dingin, tapi kulkas masih berguna.',
  'Kenapa gunting menang terus di suit? Karena dia tajam.',
  'Apa kata pisang sebelum dikolak? Semoga manis nasibku.',
  'Kenapa kipas angin capek? Karena muter terus dari pagi.',
  'Apa bahasa Inggrisnya "kehabisan pulsa"? Out of credit, tapi kalau di desa out of signal.',
  'Kenapa sendok dan garpu bertengkar? Masalah selera.',
  'Apa yang dikatakan tisu? Aku siap menyerap tangismu.',
  'Kenapa lem selalu akrab? Karena suka menempel.',
  'Apa bedanya langit dan hati? Langit biru, hati bisa hitam kalau diselingkuh.',
  'Kenapa kapal selam takut? Karena dia tenggelam dalam pikiran.',
  'Apa kata kacamata hitam? Dunia terlalu terang, aku butuh filter.',
  'Kenapa printer sering marah? Karena sering di-paper (paper jam).',
  'Apa makanan kesukaan robot? Byte (bait).',
  'Kenapa singa jadi raja? Karena dia berani (ber-ani).',
  'Apa bahasa Inggrisnya "pusing tujuh keliling"? Dizzy, tapi kalau muter terus jadi dizzy loop.',
  'Kenapa tali sepatu suka lepas? Karena dia ingin bebas.',
  'Apa yang dikatakan jembatan? Aku menghubungkan, bukan memisahkan.',
  'Kenapa botol plastik dibenci? Karena dia sampah kalau tak dikelola.',
  'Apa bedanya cinta dan kopi? Kopi bisa pahit di awal, cinta pahit di akhir.',
  'Kenapa kamera malu? Karena sering difoto orang tapi dia tak pernah lihat dirinya.',
  'Apa kata kompas? Utara selalu benar, tapi aku yang memilih arah.',
  'Kenapa tangga lelah? Karena tiap hari naik-turun.',
  'Apa bahasa Inggrisnya "lupa bawa dompet"? Forget wallet, tapi kalau lupa nama pacar jadi forget heart.',
  'Kenapa awan selalu nganggur? Karena dia cuma melayang.',
  'Apa yang dikatakan ban bocor? Aku kehabisan angin hidup.',
  'Kenapa pensil baru sombong? Karena masih tajam namanya.',
  'Apa bedanya hujan dan berita? Hujan turun dari atas, berita kadang jatuhkan orang.',
  'Kenapa meja makan ramai? Karena banyak piring bicara.',
  'Apa kata kabel rusak? Aku putus tapi bukan hubungan.',
  'Kenapa kalender tenang? Karena dia tahu waktunya lewat.',
  'Apa makanan favorit komet? Ekor panjang (ekor-panjang).',
  'Kenapa speaker berisik? Karena dia suka bicara keras.',
  'Apa bahasa Inggrisnya "kepanasan"? Hot, tapi kalau di kompor jadi burnt.',
  'Kenapa jarum tenang? Karena dia kecil tapi penting.',
  'Apa yang dikatakan bayangan? Aku selalu di belakangmu, kecuali gelap.',
  'Kenapa es batu cuek? Karena dia dingin orangnya.',
  'Apa bedanya mimpi dan rencana? Mimpi gratis, rencana butuh effort.',
  'Kenapa gula manis? Karena dia tidak pernah menyebalkan.',
  'Apa kata pena mahal? Aku tulis sejarah, bukan sekadar kata.',
  'Kenapa tong sampah bahagia? Karena dia menerima segalanya.',
  'Apa bahasa Inggrisnya "telat kerja"? Late, tapi kalau tiap hari jadi habit.',
  'Kenapa jendela pintar? Karena dia tahu kapan buka tutup.',
  'Apa yang dikatakan helm? Aku lindungi kepalamu, jaga hatimu sendiri.',
  'Kenapa roda sepeda bahagia? Karena berputar dengan teman.',
  'Apa bedanya otak dan harddisk? Otak bisa lupa, harddisk tinggal format.',
  'Kenapa lilin sedih? Karena dia meleleh saat memberi cahaya.',
  'Apa kata angin? Aku lewat, tapi aku tinggalkan sejuk.',
  'Kenapa cermin tak punya musuh? Karena dia cuma memantulkan.',
  'Apa makanan kesukaan listrik? Watt-melon.',
  'Kenapa jaket hangat? Karena dia pelukan portable.',
  'Apa bahasa Inggrisnya "kena tilang"? Get fined, tapi kalau dijalan tikus jadi lucky.',
  'Kenapa sendal jepit populer? Karena dia nyaman di kaki rakyat.',
  'Apa yang dikatakan baterai habis? Jangan cari aku di saat lemah.',
  'Kenapa buku tulis penuh? Karena dia rajin catat.',
  'Apa bedanya kaya dan bahagia? Kaya di rekening, bahagia di hati.',
  'Kenapa antenna TV bengkok? Karena dia cari sinyal cinta.',
  'Apa kata korek api? Aku nyalakan semangatmu, bukan ngomelmu.',
  'Kenapa kulkas berdenging? Karena dia bekerja diam-diam.',
  'Apa bahasa Inggrisnya "ngantuk berat"? Sleepy, tapi kalau pas ngaji jadi sinful sleepy.',
  'Kenapa payung setia? Karena dia lindungi saat hujan.',
  'Apa yang dikatakan pulpen bocor? Maaf, aku tak kuat simpan perasaan.',
  'Kenapa paku lurus? Karena dia tak mau belok dari niat.',
  'Apa bedanya harimau dan dosen? Harimau makan di hutan, dosen makan waktu.',
  'Kenapa bantal empuk? Karena dia terima kepala lelah.',
  'Apa kata kaset rusak? Aku putar ulang, tapi tak sama.',
  'Kenapa resleting cepat? Karena dia selesaikan satu tarikan.',
  'Apa makanan favorit tikus? Keju, tapi kalau di rumah sakit jadi infeksi.',
  'Kenapa termos bisa panas dan dingin? Karena dia fleksibel kayak orang dewasa.',
  'Apa bahasa Inggrisnya "ketinggalan kereta"? Miss the train, tapi kalau di hati jadi miss you.',
  'Kenapa kuas lukis senyum? Karena dia ciptakan warna.',
  'Apa yang dikatakan karcis? Aku tiket ke bahagiaanmu, jaga baik.',
  'Kenapa korek gas sombong? Karena dia bisa nyala sendiri.',
  'Apa bedanya laut dan ibu? Dua-duanya luas, tapi ibu tak pernah surut.',
  'Kenapa stop kontak galak? Karena dia colok kalau suka.',
  'Apa kata tisu kering? Aku habis dipakai, tapi aku rela.',
  'Kenapa milimetro kecil? Karena dia presisi, bukan besar.',
  'Apa bahasa Inggrisnya "buntu ide"? Stuck, tapi kalau di dapur jadi stuck food.',
  'Kenapa balon sedih? Karena dia mudah ledak kalau ditekan.',
  'Apa yang dikatakan rantai? Kita kuat karena saling kait.',
  'Kenapa peta selalu tenang? Karena dia tahu jalan pulang.',
  'Apa makanan kesukaan kalkulator? Angka bulat.',
  'Kenapa kabel USB bingung? Karena ada dua sisi yang mirip.',
  'Apa bedanya teman dan wifi? Teman bisa hilang, wifi bisa lupa password.',
  'Kenapa kipas langit pelan? Karena dia di atas, tak perlu cepat.',
  'Apa kata paku yang lepas? Aku copot, tapi bukan hati.',
  'Kenapa gelas kopi hangat? Karena dia simpan cerita pagi.',
  'Apa bahasa Inggrisnya "abis makan"? Done eating, tapi kalau kenyang banget jadi done breathing.',
  'Kenapa pensil meja rapi? Karena dia punya tempat.',
  'Apa yang dikatakan batu? Aku diam, tapi aku pondasi.',
  'Kenapa pantai tenang? Karena dia dengar ombak, bukan omel.',
  'Apa bedanya otak dan awan? Otak isinya ide, awan isinya air hujan.',
  'Kenapa mesin cuci berputar? Karena dia sibuk beresin hidup orang.',
  'Apa kata kabel LAN? Aku hubungkan dunia, tak perlu drama.'
];

const QUOTES = [
  ['Albert Einstein', 'Imajinasi lebih penting dari pengetahuan.'],
  ['Nelson Mandela', 'Pendidikan adalah senjata paling kuat yang bisa kamu gunakan untuk mengubah dunia.'],
  ['Steve Jobs', 'Stay hungry, stay foolish.'],
  ['Budi', 'Jangan menunggu mood, karena mood takkan pernah datang.'],
  ['Confucius', 'Pilih pekerjaan yang kamu cintai, dan kamu tak akan bekerja sehari pun dalam hidupmu.'],
  ['R.A. Kartini', 'Tiada awan di langit yang tetap selamanya.'],
  ['Mark Twain', 'Orang yang berhenti belajar sudah mati.'],
  ['Soekarno', 'Bangsa yang besar adalah bangsa yang menghargai jasa pahlawannya.'],
  ['Anonymous', 'Kesuksesan adalah jatuh sembilan kali, bangkit sepuluh kali.'],
  ['Bill Gates', 'Jangan membandingkan dirimu dengan orang lain, itu akan membuatmu meragukan diri sendiri.']
];

const DARES = [
  'Kirim foto selfie lucu.',
  'Nyanyikan satu baris lagu favoritmu.',
  'Bicara pake logat sunda 1 menit.',
  'Kirim voice note bilang "aku cakep".',
  'Putar 1 lagu lalu jelaskan maknanya.',
  'Ceritakan joke terbaikmu.',
  'Kirim stiker favoritmu.',
  'Bilang 5 hal yang kamu syukuri hari ini.',
  'Lakukan 10 squat sekarang.',
  'Tiru suara hewan kesukaanmu.',
  'Tulis puisi 2 baris tentang grup ini.',
  'Sebutkan 3 nama makanan enak.',
  'Berpose ala model lewat foto.',
  'Jelaskan warna kesukaanmu dan alasannya.',
  'Kirim audio "good morning" version malam.'
];

const TRUTHS = [
  'Pernahkah kamu berbohong ke orang tua?',
  'Siapa orang yang paling kamu sayangi?',
  'Pernahkah kamu mencuri sesuatu?',
  'Apa ketakutan terbesarmu?',
  'Pernahkah kamu patah hati?',
  'Rahasia terbesar yang belum kamu ceritakan?',
  'Pernahkah kamu iri pada teman?',
  'Apa kebiasaan burukmu?',
  'Pernahkah kamu menyesal kenal seseorang?',
  'Siapa pacar idealmu?',
  'Pernahkah kamu bohong soal nilai sekolah?',
  'Apa hal paling memalukan yang pernah terjadi?',
  'Pernahkah kamu ngefans berlebihan?',
  'Siapa yang kamu telepon saat bermasalah?',
  'Pernahkah kamu salah kirim chat?'
];

const EIGHTBALL = [
  'Ya, pasti.', 'Tidak mungkin.', 'Mungkin saja.', 'Menurutku ya.', 'Hmm, coba lagi nanti.',
  'Sangat mungkin.', 'Jangan harap.', 'Tanda-tandanya bagus.', 'Coba tanya besok.', 'Absolut ya.',
  'Sepertinya tidak.', 'Kamu tahu jawabannya.', 'Waktunya akan bicara.', 'Ya, tapi sabar.', 'Tidak, lupakan.'
];

// Hanya angka & operator matematika — tanpa huruf = tak bisa manggil fungsi.
const MATH_RE = /^[0-9+\-*/%().\s]+$/;

// ─── !jokes / !lucu ──────────────────────────────────────
async function handleJokes(ctx) {
  const t = tokenOf(ctx.body);
  if (t !== '!jokes' && t !== '!lucu') return false;
  await reply(ctx, `😂 *JOKES*\n\n${pick(JOKES)}`);
  return true;
}

// ─── !quote / !kutipan ───────────────────────────────────
async function handleQuote(ctx) {
  const t = tokenOf(ctx.body);
  if (t !== '!quote' && t !== '!kutipan') return false;
  const q = pick(QUOTES);
  await reply(ctx, `💬 *QUOTE OF THE DAY*\n\n_"${q[1]}"_\n\n— *${q[0]}*`);
  return true;
}

// ─── !dare / !tantangan ──────────────────────────────────
async function handleDare(ctx) {
  const t = tokenOf(ctx.body);
  if (t !== '!dare' && t !== '!tantangan') return false;
  await reply(ctx, `⚡ *DARE (TANTANGAN)*\n\n${pick(DARES)}`);
  return true;
}

// ─── !truth / !jujur ─────────────────────────────────────
async function handleTruth(ctx) {
  const t = tokenOf(ctx.body);
  if (t !== '!truth' && t !== '!jujur') return false;
  await reply(ctx, `🔥 *TRUTH (KEJUJURAN)*\n\n${pick(TRUTHS)}`);
  return true;
}

// ─── !8ball / !magic ─────────────────────────────────────
async function handleEightball(ctx) {
  const t = tokenOf(ctx.body);
  if (t !== '!8ball' && t !== '!magic') return false;
  const q = (ctx.body || '').trim().split(/\s+/).slice(1).join(' ').trim();
  if (!q) {
    await reply(ctx, '🎱 *MAGIC 8-BALL*\n\nTanyakan sesuatu!\nContoh: `!8ball apakah hari ini cerah?`');
    return true;
  }
  await reply(ctx, `🎱 *MAGIC 8-BALL*\n\n❓ *Tanya:* ${q}\n🔮 *Jawaban:* ${pick(EIGHTBALL)}`);
  return true;
}

// ─── !dice / !roll ───────────────────────────────────────
async function handleDice(ctx) {
  const t = tokenOf(ctx.body);
  if (t !== '!dice' && t !== '!roll') return false;
  // Guard jumlah: tolak non-bilangan & negatif (konvensi parsing jumlah).
  const raw = parsePositiveAmount((ctx.body || '').trim().split(/\s+/)[1]);
  const n = raw !== null ? Math.min(raw, 6) : 1;
  const res = [];
  for (let i = 0; i < n; i++) res.push(Math.floor(Math.random() * 6) + 1);
  const total = res.reduce((a, b) => a + b, 0);
  await reply(ctx, `🎲 *LEMPAR DADU* (${n} Dadu)\n\nHasil: ${res.map(r => `[ ${r} ]`).join(' ')}\nTotal: ${total}`);
  return true;
}

// ─── !base64 / !b64 ──────────────────────────────────────
async function handleBase64(ctx) {
  const parts = (ctx.body || '').trim().split(/\s+/);
  const t = (parts[0] || '').toLowerCase();
  if (t !== '!base64' && t !== '!b64') return false;
  const mode = (parts[1] || '').toLowerCase();
  const text = parts.slice(2).join(' ');
  if (!text) {
    await reply(ctx, '🔐 *BASE64 CONVERTER*\n\nContoh penggunaan:\n• `!base64 enc halo dunia`\n• `!base64 dec aGFsbw==`');
    return true;
  }
  if (mode === 'enc') {
    await reply(ctx, `🔐 *BASE64 ENCODE*\n\n\`${Buffer.from(text, 'utf8').toString('base64')}\``);
    return true;
  }
  if (mode === 'dec') {
    try {
      await reply(ctx, `🔓 *BASE64 DECODE*\n\n\`${Buffer.from(text, 'base64').toString('utf8')}\``);
    } catch {
      await reply(ctx, '❌ Gagal decode base64.');
    }
    return true;
  }
  await reply(ctx, '⚠️ Pilihan mode: `enc` (encode) atau `dec` (decode).');
  return true;
}

// ─── !calc / !kalkulator / !math ─────────────────────────
async function handleCalc(ctx) {
  const full = (ctx.body || '').trim();
  const t = tokenOf(full);
  if (t !== '!calc' && t !== '!kalkulator' && t !== '!math') return false;
  const sp = full.indexOf(' ');
  const expr = (sp === -1 ? '' : full.slice(sp + 1)).replace(/,/g, '.').trim();
  if (!expr) {
    await reply(ctx, '🧮 *KALKULATOR*\n\nContoh: `!calc 12 * 8 + 3`');
    return true;
  }
  if (!MATH_RE.test(expr)) {
    await reply(ctx, '❌ Hanya mendukung angka & operator: `+ - * / % ( ) .`');
    return true;
  }
  try {
    const result = Function('"use strict";return (' + expr + ')')();
    await reply(ctx, `🧮 ${expr} = ${result}`);
  } catch {
    await reply(ctx, '❌ Ekspresi matematika tidak valid.');
  }
  return true;
}

// ─── !jadian / !jodoh ─────────────────────────────────────
// Bot menjodohkan pengguna dengan 1 anggota acak lain di grup.
async function handleJodoh(ctx) {
  const t = tokenOf(ctx.body);
  if (t !== '!jadian' && t !== '!jodoh') return false;
  const { sock, msg, chatId, groupId, senderJid, isGroup, BOT_JID } = ctx;

  if (!isGroup) {
    await reply(ctx, '⚠️ Perintah ini cuma bisa dipakai di dalam grup!');
    return true;
  }

  let candidates = [];
  try {
    const meta = await sock.groupMetadata(groupId);
    candidates = (meta?.participants || [])
      .map(p => p.id)
      .filter(j => !sameUser(j, senderJid) && !sameUser(j, BOT_JID));
  } catch (err) {
    await reply(ctx, '❌ Gagal mengambil daftar anggota grup.');
    return true;
  }

  if (!candidates.length) {
    await reply(ctx, '😢 Tidak ada kandidat lain di grup ini.');
    return true;
  }

  const target = pick(candidates);
  await sock.sendMessage(
    chatId,
    {
      text: `💞 *MATCHMAKER GRUP* 💞\n\n✨ @${getNumber(senderJid)} resmi dijodohkan dengan @${getNumber(target)}!\nSemoga langgeng dan harmonis selalu! 💐`,
      mentions: [senderJid, target],
    },
    { quoted: msg }
  );
  return true;
}

// ─── !tebak / !tebakangka ───────────────────────────────────
// Tebak angka 1-100. Main gratis, menang dapat reward money.
// Tebak via reply ke pesan prompt bot, atau `!tebak <n>`.
const TEBAK_REWARD = 1000;
const tebakGames = new Map();

function tebakPrune() {
  const now = Date.now();
  for (const [k, g] of tebakGames) {
    if (now - g.createdAt > 5 * 60 * 1000) tebakGames.delete(k); // ponytail: TTL in-memory
  }
}

function tebakParse(n) {
  const v = parsePositiveAmount(n);
  return v !== null && v >= 1 && v <= 100 ? v : null;
}

async function tebakStart(ctx) {
  tebakPrune();
  if (tebakGames.has(ctx.chatId)) {
    await reply(ctx, '⚠️ Masih ada sesi tebak aktif di chat ini!\nBalas pesan bot dengan angka, atau ketik *!tebak stop*.');
    return true;
  }
  const number = Math.floor(Math.random() * 100) + 1;
  const res = await ctx.sock.sendMessage(
    ctx.chatId,
    { text: '🎯 *TEBAK ANGKA (1-100)*\n\nAku sudah memilih angka rahasia antara *1 sampai 100*.\n💬 *Cara main:* Balas/reply pesan ini dengan angka tebakanmu (atau ketik `!tebak <angka>`)!' },
    { quoted: ctx.msg }
  );
  tebakGames.set(ctx.chatId, { number, tries: 0, msgId: res?.key?.id, createdAt: Date.now() });
  return true;
}

async function tebakStop(ctx) {
  if (tebakGames.delete(ctx.chatId)) await reply(ctx, '🛑 Sesi tebak angka dihentikan.');
  else await reply(ctx, '⚠️ Tidak ada sesi tebak aktif di chat ini.');
  return true;
}

async function tebakGuess(ctx, n) {
  const g = tebakGames.get(ctx.chatId);
  if (!g) {
    await reply(ctx, '⚠️ Belum ada sesi tebak angka. Mulai dengan *!tebak*.');
    return true;
  }
  const val = tebakParse(n);
  if (val === null) {
    await reply(ctx, '❌ Masukkan angka 1-100 yang valid.');
    return true;
  }
  g.tries += 1;
  if (val === g.number) {
    addMoney(ctx.senderJid, TEBAK_REWARD);
    tebakGames.delete(ctx.chatId);
    await reply(ctx, `🎉 *TEBAKAN BENAR!* 🎉\n\nAngka rahasianya adalah *${g.number}*.\nKamu berhasil menebak dalam *${g.tries}* percobaan.\n💰 *Reward:* +${TEBAK_REWARD} Money!`);
  } else {
    const hint = val < g.number ? '⬆️ Lebih besar dari ' + val : '⬇️ Lebih kecil dari ' + val;
    await reply(ctx, `🎯 *TEBAK ANGKA*\n\nPetunjuk: *${hint}*\nPercobaan: ke-${g.tries}\n\n_Balas pesan ini atau ketik \`!tebak <angka>\` untuk mencoba lagi._`);
  }
  return true;
}

async function handleTebakAngka(ctx) {
  const t = tokenOf(ctx.body);
  if (t === '!tebak' || t === '!tebakangka') {
    const sub = (ctx.body || '').trim().split(/\s+/)[1];
    if (!sub || sub === 'start') return tebakStart(ctx);
    if (sub === 'stop') return tebakStop(ctx);
    return tebakGuess(ctx, sub);
  }
  // Path reply: hanya kalau reply ke pesan prompt & isinya angka
  const g = tebakGames.get(ctx.chatId);
  if (!g) return false;
  const ci = ctx.msg?.message?.extendedTextMessage?.contextInfo;
  if (!ci || ci.stanzaId !== g.msgId) return false;
  const bodyNum = (ctx.body || '').trim();
  if (!/^\d+$/.test(bodyNum)) return false;
  return tebakGuess(ctx, bodyNum);
}

module.exports = {
  handleJokes,
  handleQuote,
  handleDare,
  handleTruth,
  handleEightball,
  handleDice,
  handleBase64,
  handleCalc,
  handleJodoh,
  handleTebakAngka,
};
