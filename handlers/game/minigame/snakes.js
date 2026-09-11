// handlers/game/minigame/snakes.js
// Game Ular Tangga 2D interaktif dengan avatar foto profil.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { sameUser, getNumber } = require('../../../utils/jid');
const { readImage, maskCircle, fillCircle, strokeCircle, printTextOutlined } = require('../../../utils/sharp');

// ─── CACHE & KONFIGURASI GAME ULAR TANGGA ──────────────────
const snakesGames = new Map();
const snakesAndLadders = {
  // Tangga (Maju ke nomor lebih tinggi)
  4: 16,
  21: 40,
  26: 54,
  43: 76,
  59: 80,
  71: 90,
  // Ular (Turun ke nomor lebih rendah)
  30: 8,
  45: 19,
  47: 13,
  73: 51,
  82: 42,
  92: 68,
  98: 56
};

// Helper Function: Merender Papan 2D dengan Foto Profil Player
async function renderSnakesBoard(sock, chatId, game) {
  const boardPath = path.join(__dirname, '..', '..', '..', 'assets', 'ulartangga.png');

  if (!fs.existsSync(boardPath)) {
    throw new Error("File gambar papan game 'ulartangga.png' tidak ditemukan di root folder!");
  }

  // Mengubah resolusi base board ke 1000x1000 agar kalkulasi koordinat presisi
  const baseImage = readImage(boardPath).resize(1000, 1000, { fit: 'fill' });
  const composites = [];

  // Skema Warna Lingkaran Cadangan jika PP Gagal Dimuat
  const fallbackColors = ['#FF0000', '#0000FF', '#00FF00', '#FFFF00'];

  for (let i = 0; i < game.players.length; i++) {
    const playerJid = game.players[i];
    const pos = game.positions[playerJid];

    // Kalkulasi Baris & Kolom di Papan Grid 10x10 (Pola Ular Zig-zag)
    let row = Math.floor((pos - 1) / 10);
    let col = (pos - 1) % 10;
    if (row % 2 === 1) {
      col = 9 - col; // Baris ganjil berjalan dari kanan ke kiri
    }

    // Titik Tengah Grid Asli
    let x = col * 100 + 50;
    let y = (9 - row) * 100 + 50;

    // Premium Touch: Berikan sedikit geseran (offset) jika ada beberapa player di petak yang sama
    const offsetDistance = 22;
    if (i === 0) { x -= offsetDistance; y -= offsetDistance; }
    else if (i === 1) { x += offsetDistance; y -= offsetDistance; }
    else if (i === 2) { x -= offsetDistance; y += offsetDistance; }
    else if (i === 3) { x += offsetDistance; y += offsetDistance; }

    // Ambil Foto Profil Player
    let ppBuffer = null;
    try {
      const ppUrl = await sock.profilePictureUrl(playerJid, 'image');
      const res = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 5000 });
      ppBuffer = Buffer.from(res.data);
    } catch (err) {
      ppBuffer = null; // Pakai avatar fallback
    }

    // Potong Foto Profil Menjadi Lingkaran Sempurna HD dengan Frame Border Hitam-Putih
    let avatar;
    if (ppBuffer) {
      avatar = await maskCircle(readImage(ppBuffer).resize(70, 70, { fit: 'cover' }).ensureAlpha(), 70);
    } else {
      // Fallback: buat avatar bulat dengan inisial nomor player
      const color = fallbackColors[i] || '#FF00FF';
      avatar = sharp({ create: { width: 70, height: 70, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
      avatar = await fillCircle(avatar, 35, 35, 32, color);
      avatar = await printTextOutlined(avatar, { size: 32, text: `P${i + 1}`, x: 16, y: 16, outlineWidth: 2 });
    }
    const avatarBuf = await avatar.png().toBuffer();

    // Tambahkan border melingkar luar (kanvas 76x76)
    let bordered = sharp({ create: { width: 76, height: 76, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    bordered = bordered.composite([{ input: avatarBuf, left: 3, top: 3 }]);
    bordered = await strokeCircle(bordered, 38, 38, 35, '#FFFFFF', 3);
    bordered = await strokeCircle(bordered, 38, 38, 34, '#000000', 1);
    const borderedBuf = await bordered.png().toBuffer();

    composites.push({
      image: borderedBuf,
      x: Math.max(0, x - 38),
      y: Math.max(0, y - 38)
    });
  }

  const layers = composites.map(c => ({ input: c.image, left: c.x, top: c.y }));
  return await baseImage.composite(layers).jpeg({ quality: 90 }).toBuffer();
}

// ─── FITUR GAME ULAR TANGGA 2D INTERAKTIF (!snakes) ───────
async function handleSnakes(ctx) {
  const { sock, msg, chatId, senderJid, senderName, body } = ctx;

  if (!body.toLowerCase().startsWith('!snakes')) return false;

  const args = body.trim().split(/ +/).slice(1);
  const subCmd = args[0]?.toLowerCase();
  const currentGame = snakesGames.get(chatId);

  // 1. MENU UTAMA DAN BANTUAN (!snakes)
  if (!subCmd) {
    await sock.sendMessage(chatId, {
      text: [
        `🎲 *GAME ULAR TANGGA 2D* 🎲`,
        `────────────────────────`,
        `Mainkan keseruan ular tangga klasik langsung di WhatsApp dengan avatar foto profilmu!`,
        ``,
        `📌 *Daftar Perintah Game:*`,
        `• *!snakes play* — Membuat/membuka room game baru`,
        `• *!snakes join* — Bergabung ke dalam room antrean`,
        `• *!snakes start* — Memulai permainan (Minimal 1 player)`,
        `• *!snakes roll* — Mengocok dadu (Saat giliranmu)`,
        `• *!snakes cancel* — Menghentikan permainan yang berjalan`,
        ``,
        `💡 _Maksimal pemain di dalam 1 room adalah 4 Player._`
      ].join('\n')
    }, { quoted: msg });
    return true;
  }

  // 2. MEMBUAT ROOM PERMAINAN (!snakes play)
  if (subCmd === 'play') {
    if (currentGame) {
      await sock.sendMessage(chatId, { text: `⚠️ Sesi game ular tangga masih berjalan atau sedang mengantre di chat ini! Selesaikan atau gunakan *!snakes cancel* terlebih dahulu.` }, { quoted: msg });
      return true;
    }

    snakesGames.set(chatId, {
      status: 'waiting',
      creator: senderJid,
      players: [senderJid],
      playerNames: { [senderJid]: senderName },
      positions: { [senderJid]: 1 },
      turnIndex: 0
    });

    await sock.sendMessage(chatId, {
      text: `🎮 *Room Ular Tangga Berhasil Dibuat!* \n\n👑 Host: *@${getNumber(senderJid)}*\n👥 Player saat ini (1/4): \n1. *@${getNumber(senderJid)}*\n\n👉 Pemain lain bisa mengetik *!snakes join* untuk ikut bermain.\n👉 Ketik *!snakes start* jika ingin memulai game!`,
      mentions: [senderJid]
    }, { quoted: msg });
    return true;
  }

  // 3. BERGABUNG KE DALAM ROOM (!snakes join)
  if (subCmd === 'join') {
    if (!currentGame) {
      await sock.sendMessage(chatId, { text: `❌ Tidak ada room game yang aktif. Ketik *!snakes play* untuk membuat baru!` }, { quoted: msg });
      return true;
    }
    if (currentGame.status !== 'waiting') {
      await sock.sendMessage(chatId, { text: `❌ Game sudah dimulai, kamu tidak dapat bergabung di tengah jalan.` }, { quoted: msg });
      return true;
    }
    if (currentGame.players.includes(senderJid)) {
      await sock.sendMessage(chatId, { text: `⚠️ Kamu sudah berada di dalam antrean room ini!` }, { quoted: msg });
      return true;
    }
    if (currentGame.players.length >= 4) {
      await sock.sendMessage(chatId, { text: `🚫 Room sudah penuh! (Maksimal 4 Pemain).` }, { quoted: msg });
      return true;
    }

    currentGame.players.push(senderJid);
    currentGame.playerNames[senderJid] = senderName;
    currentGame.positions[senderJid] = 1;

    let listPlayers = currentGame.players.map((p, i) => `${i + 1}. *@${getNumber(p)}*`).join('\n');
    await sock.sendMessage(chatId, {
      text: `✅ Berhasil bergabung!\n\n🎮 *Daftar Player Saat Ini (${currentGame.players.length}/4):*\n${listPlayers}\n\nKetik *!snakes start* untuk segera bertanding!`,
      mentions: currentGame.players
    }, { quoted: msg });
    return true;
  }

  // 4. MEMULAI PERMAINAN (!snakes start)
  if (subCmd === 'start') {
    if (!currentGame) {
      await sock.sendMessage(chatId, { text: `❌ Tidak ada game yang bisa dimulai. Ketik *!snakes play* terlebih dahulu.` }, { quoted: msg });
      return true;
    }
    if (currentGame.status === 'playing') {
      await sock.sendMessage(chatId, { text: `⚠️ Game sudah berjalan!` }, { quoted: msg });
      return true;
    }

    currentGame.status = 'playing';
    currentGame.turnIndex = 0;
    const giliranJid = currentGame.players[currentGame.turnIndex];

    await sock.sendMessage(chatId, { text: `⏳ Sedang menyiapkan papan dan memproses foto profil player...` }, { quoted: msg });

    try {
      const boardBuffer = await renderSnakesBoard(sock, chatId, currentGame);
      await sock.sendMessage(chatId, {
        image: boardBuffer,
        caption: `🚀 *PERMAINAN ULAR TANGGA DIMULAI!* 🚀\n\nSemua pemain mulai dari kotak nomor *1*.\n\n🎲 Giliran pertama jalan: *@${getNumber(giliranJid)}*\n👉 Silahkan ketik *!snakes roll* untuk melempar dadu!`,
        mentions: [giliranJid]
      }, { quoted: msg });
    } catch (err) {
      console.error(err);
      await sock.sendMessage(chatId, { text: `❌ Gagal memproses gambar papan: ${err.message}` });
    }
    return true;
  }

  // 5. MENGOCOK DADU PERMAINAN (!snakes roll / !snakes lempar)
  if (subCmd === 'roll' || subCmd === 'lempar') {
    if (!currentGame || currentGame.status !== 'playing') {
      await sock.sendMessage(chatId, { text: `❌ Tidak ada game ular tangga yang sedang aktif berjalan!` }, { quoted: msg });
      return true;
    }

    const currentTurnJid = currentGame.players[currentGame.turnIndex];
    if (!sameUser(senderJid, currentTurnJid)) {
      await sock.sendMessage(chatId, { text: `⏳ *Bukan giliranmu!* Sekarang adalah giliran *@${getNumber(currentTurnJid)}*`, mentions: [currentTurnJid] }, { quoted: msg });
      return true;
    }

    // Acak Nilai Dadu (1 - 6)
    const dice = Math.floor(Math.random() * 6) + 1;
    let oldPos = currentGame.positions[senderJid];
    let newPos = oldPos + dice;
    let statusLog = `@${getNumber(senderJid)} melempar dadu dan mendapatkan angka 🎲 *${dice}*.\n`;

    // Aturan Finis Tepat (Jika melebihi 100, posisi berbalik mundur)
    if (newPos > 100) {
      let sisa = newPos - 100;
      newPos = 100 - sisa;
      statusLog += `Kamu Berlebih! Memantul kembali dari kotak 100 ke kotak *${newPos}*.\n`;
    } else {
      statusLog += `Berpindah dari kotak *${oldPos}* ➡️ *${newPos}*.\n`;
    }

    // Cek Efek Jebakan Ular atau Bonus Tangga
    if (snakesAndLadders[newPos]) {
      let targetPos = snakesAndLadders[newPos];
      if (targetPos > newPos) {
        statusLog += `🪜 *WOW TANGGA!* Kamu naik beruntung dari kotak ${newPos} ke kotak *${targetPos}*!\n`;
      } else {
        statusLog += `🐍 *OH TIDAK, ULAR!* Kamu tergigit dan merosot dari kotak ${newPos} ke kotak *${targetPos}*!\n`;
      }
      newPos = targetPos;
    }

    // Simpan Posisi Baru Pemain
    currentGame.positions[senderJid] = newPos;

    // CEK APAKAH ADA PLAYER YANG MENANG
    if (newPos === 100) {
      try {
        const finalBoard = await renderSnakesBoard(sock, chatId, currentGame);
        snakesGames.delete(chatId); // Hapus sesi game
        await sock.sendMessage(chatId, {
          image: finalBoard,
          caption: `🎉 🏆 *HURRAY! GAME OVER* 🏆 🎉\n\nSelamat kepada *@${getNumber(senderJid)}* yang telah berhasil mencapai kotak *100* terlebih dahulu dan memenangkan permainan! 👑`,
          mentions: [senderJid]
        }, { quoted: msg });
      } catch (e) {
        snakesGames.delete(chatId);
        await sock.sendMessage(chatId, { text: `🎉 Selamat *@${getNumber(senderJid)}* memenangkan game ular tangga!`, mentions: [senderJid] });
      }
      return true;
    }

    // Ganti Giliran ke Player Selanjutnya
    currentGame.turnIndex = (currentGame.turnIndex + 1) % currentGame.players.length;
    const nextPlayerJid = currentGame.players[currentGame.turnIndex];

    statusLog += `\n🎲 Giliran Selanjutnya: *@${getNumber(nextPlayerJid)}*`;

    // Kirim Update Papan Game Terbaru
    try {
      const updatedBoard = await renderSnakesBoard(sock, chatId, currentGame);
      await sock.sendMessage(chatId, {
        image: updatedBoard,
        caption: statusLog,
        mentions: [senderJid, nextPlayerJid]
      }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(chatId, { text: `❌ Error render peta: ${err.message}` });
    }
    return true;
  }

  // 6. MEMBATALKAN/MENSTOP PERMAINAN (!snakes cancel)
  if (subCmd === 'cancel' || subCmd === 'stop') {
    if (!currentGame) {
      await sock.sendMessage(chatId, { text: `❌ Tidak ada game aktif di chat grup ini yang bisa dibatalkan.` }, { quoted: msg });
      return true;
    }

    snakesGames.delete(chatId);
    await sock.sendMessage(chatId, { text: `⏹️ Permainan Ular Tangga telah dihentikan secara paksa oleh *@${getNumber(senderJid)}*. Semua data room dibersihkan!`, mentions: [senderJid] }, { quoted: msg });
    return true;
  }

  return true;
}

module.exports = { handleSnakes, renderSnakesBoard };