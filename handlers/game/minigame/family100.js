// handlers/game/minigame/family100.js
// Game Family 100: kuis tebak jawaban grup.
const fs = require('fs');
const path = require('path');
const familyData = require('../../../data/family100');
const { getNumber } = require('../../../utils/jid');

const familyCache = new Map();
const familyStateFile = process.env.BOT_FAMILY_STATE_PATH ? path.resolve(process.env.BOT_FAMILY_STATE_PATH) : path.join(__dirname, '..', '..', '..', 'state', 'family100_state.json');
let currentFamilyIndex = 0;

// Baca indeks terakhir dari file jika file tersebut ada
if (fs.existsSync(familyStateFile)) {
    try {
        const stateData = fs.readFileSync(familyStateFile, 'utf-8');
        const parsedState = JSON.parse(stateData);
        currentFamilyIndex = parsedState.currentIndex || 0;
        console.log(`[Family 100] Berhasil memuat indeks terakhir: ${currentFamilyIndex}`);
    } catch (err) {
        console.error('❌ Gagal membaca file state Family 100, menggunakan indeks 0:', err);
        currentFamilyIndex = 0;
    }
}

async function handleFamily100(ctx) {
  const { sock, msg, chatId, senderJid, body } = ctx;

  // 1. PEMBUATAN GAME BARU
  if (body.toLowerCase() === '!family100') {
    // 1. PENGECEKAN UTAMA: Cek dulu di awal sebelum membuat data game baru
    if (familyCache.has(chatId)) {
        await sock.sendMessage(chatId, {
            text: `❌ Masih ada sesi game *Family 100* yang sedang berjalan di chat ini!\n\nSilakan selesaikan semua tebakan terlebih dahulu, atau ketik *nyerah* untuk mengakhiri game saat ini sebelum memulai yang baru.`
        }, { quoted: msg });
        return true;
    }

    // 2. Ambil soal dari list berdasarkan indeks saat ini
    const ttgSoal = familyData[currentFamilyIndex];

    // 3. Naikkan indeks untuk persiapan game berikutnya
    currentFamilyIndex++;

    // 4. Jika indeks sudah mencapai batas akhir panjang list, reset kembali ke 0 (paling atas)
    if (currentFamilyIndex >= familyData.length) {
        currentFamilyIndex = 0;
    }

    // 💾 SIMPAN INDEKS TERBARU KE FILE (Supaya kalau bot mati tidak mengulang)
    try {
        fs.writeFileSync(familyStateFile, JSON.stringify({ currentIndex: currentFamilyIndex }), 'utf-8');
    } catch (err) {
        console.error('❌ Gagal menyimpan data indeks Family 100:', err);
    }

    // 5. Strukturkan data game
    const game = {
        soal: ttgSoal.soal,
        jawaban: ttgSoal.jawaban.map(j => ({
            kata: j.kata.toLowerCase().trim(),
            ditebak: false,
            penjawab: null
        }))
    };

    // 6. Simpan sesi game baru ke dalam cache
    familyCache.set(chatId, game);

    // 7. Kirim pesan papan tebakan awal ke grup
    let listJawaban = game.jawaban.map((j, i) => `${i + 1}. ..........`).join('\n');
    await sock.sendMessage(chatId, {
        text: `🎮 *FAMILY 100* 🎮\n\n${game.soal}\n\n${listJawaban}`
    }, { quoted: msg });
    return true;
  }

  // 2. LOGIKA CEK JAWABAN & FITUR NYERAH (berjalan untuk pesan apa pun saat game aktif)
  if (familyCache.has(chatId)) {
    const game = familyCache.get(chatId);
    const input = body.toLowerCase();

    // 🏳️ FITUR NYERAH
    if (input === 'nyerah') {
        let listJawaban = game.jawaban.map((j, i) => {
            if (j.ditebak) {
                return `${i + 1}. *${j.kata.toUpperCase()}* — @${getNumber(j.penjawab)} ✅`;
            }
            return `${i + 1}. *${j.kata.toUpperCase()}*`;
        }).join('\n');

        const penjawabJids = game.jawaban
            .filter(j => j.ditebak)
            .map(j => j.penjawab);

        await sock.sendMessage(chatId, {
            text: `🏳️ *Yahhh, menyerah... Game Berakhir!*\n\n${game.soal}\n\n*KUNCI JAWABAN COMPLETE:* \n${listJawaban}\n\nKetik *!family100* untuk memulai game baru!` ,
            mentions: penjawabJids
        }, { quoted: msg });

        familyCache.delete(chatId);
        return true;
    }

    // Pengecekan jawaban benar
    const index = game.jawaban.findIndex(j => j.kata === input && !j.ditebak);

    if (index !== -1) {
        game.jawaban[index].ditebak = true;
        game.jawaban[index].penjawab = senderJid;

        let listBaru = game.jawaban.map((j, i) => {
            if (j.ditebak) {
                return `${i + 1}. ${j.kata.toUpperCase()} — @${getNumber(j.penjawab)}`;
            }
            return `${i + 1}. ..........`;
        }).join('\n');

        const semuaTerjawab = game.jawaban.every(j => j.ditebak);
        let text = `✅ *Benar!* "${input}" ditemukan!\n\n${game.soal}\n\n${listBaru}`;

        if (semuaTerjawab) text += `\n\n🎉 *KEREN! Semua jawaban berhasil ditebak!*`;

        await sock.sendMessage(chatId, {
            text: text,
            mentions: game.jawaban.filter(j => j.ditebak).map(j => j.penjawab)
        }, { quoted: msg });

        if (semuaTerjawab) familyCache.delete(chatId);
        // Catatan: jawaban benar TIDAK menghentikan alur (mirror perilaku asli index.js)
    }
  }

  return false;
}

module.exports = { handleFamily100 };