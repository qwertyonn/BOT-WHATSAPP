// handlers/economy/bank.js
// Sistem Perbankan & Begal (Rob)
const {
  getUserMoney,
  addMoney,
  deductMoney,
  getBankData,
  depositBank,
  withdrawBank,
  deductBankBalance,
  calculatePendingInterest,
  claimBankInterest,
  getRobStats,
  updateRobStats,
  getRobTop,
  getBobolStats,
  updateBobolStats,
  getBobolTop,
} = require('../../data/db');
const ui = require('../../utils/ui');
const { sameUser, resolveMentionedJids, getNumber } = require('../../utils/jid');
const { resolveAmount } = require('../../utils/amount');

const ROB_COOLDOWN_MS = 20 * 60 * 1000; // 20 menit
const MIN_ROB_TARGET_CASH = 500;        // korban harus punya minimal 500 cash
const MIN_ROBBER_CASH = 200;             // pembegal harus punya minimal 200 cash untuk modal denda

const BOBOL_COOLDOWN_MS = 20 * 60 * 1000;  // 20 menit
const MIN_BOBOL_TARGET_BANK = 500;         // korban harus punya minimal 500 saldo bank
const BOBOL_SUCCESS_RATE = 0.25;           // lebih sulit: 25% sukses
const BOBOL_STEAL_MIN_PERCENT = 0.30;      // curi 30%-50% saldo bank (hasil bisa besar)
const BOBOL_STEAL_MAX_PERCENT = 0.50;
const BOBOL_STEAL_MIN_AMOUNT = 100;
const BOBOL_FINE_MIN_PERCENT = 0.20;       // denda gagal lebih besar: 20%-30%
const BOBOL_FINE_MAX_PERCENT = 0.30;

// ─── HANDLER BANK: !bank, !depo, !deposit, !tarik, !wd, !withdraw, !klaimbunga ───
async function handleBank(ctx) {
  const { sock, msg, chatId, senderJid, body } = ctx;
  const raw = body.trim();
  const lower = raw.toLowerCase();

  const isBankInfo = lower === '!bank';
  const isDepo = lower.startsWith('!depo ') || lower.startsWith('!deposit ') || lower === '!depo' || lower === '!deposit';
  const isTarik = lower.startsWith('!tarik ') || lower.startsWith('!wd ') || lower.startsWith('!withdraw ') || lower === '!tarik' || lower === '!wd' || lower === '!withdraw';
  const isKlaimBunga = lower === '!klaimbunga' || lower === '!klaim bunga';

  if (!isBankInfo && !isDepo && !isTarik && !isKlaimBunga) return false;

  const realSenderJid = msg.key.participant || msg.key.remoteJid || senderJid;
  const userCash = getUserMoney(realSenderJid);
  const bank = getBankData(realSenderJid);
  const pendingInterest = calculatePendingInterest(realSenderJid);

  // 1. INFO REKENING BANK (!bank)
  if (isBankInfo) {
    const totalAset = userCash + (bank.balance || 0);
    const text = ui.box(
      `🏦 *PUSAT PERBANKAN BOT*`,
      [
        ui.kv(`💵 Saldo Dompet`, `Rp ${ui.money(userCash)}`),
        ui.kv(`🏛️ Saldo Bank`, `Rp ${ui.money(bank.balance || 0)}`),
        ui.kv(`💎 Total Aset`, `Rp ${ui.money(totalAset)}`),
        ui.kv(`📈 Bunga Berjalan`, `Rp ${ui.money(pendingInterest)} (1%/hari)`),
        ``,
        `💡 *Uang di bank aman dari aksi begal, tapi tidak dari bobol!*`,
        ``,
        ui.bullet(`\`!depo [jumlah|all]\` : Simpan uang ke bank`),
        ui.bullet(`\`!tarik [jumlah|all]\` : Tarik uang ke dompet`),
        ui.bullet(`\`!klaimbunga\` : Klaim bunga simpanan`),
        ui.bullet(`\`!begal @user\` : Begal uang dompet lawan`),
        ui.bullet(`\`!bobol @user\` : Bobol tabungan bank lawan (sulit, hasil besar)`),
      ],
      'Layanan Bank & Tabungan Aman'
    );
    await sock.sendMessage(chatId, { text, mentions: [realSenderJid] }, { quoted: msg });
    return true;
  }

  // 2. KLAIM BUNGA (!klaimbunga)
  if (isKlaimBunga) {
    if (pendingInterest <= 0) {
      await sock.sendMessage(chatId, {
        text: `⏳ Belum ada bunga yang bisa diklaim saat ini. Simpan uang lebih banyak atau tunggu lebih lama!`,
      }, { quoted: msg });
      return true;
    }
    const claimed = claimBankInterest(realSenderJid);
    const currentBank = getBankData(realSenderJid);
    await sock.sendMessage(chatId, {
      text: `🎉 Berhasil mengklaim bunga tabungan sebesar *Rp ${ui.money(claimed)}*!\n🏛️ Saldo bank sekarang: *Rp ${ui.money(currentBank.balance)}*`,
    }, { quoted: msg });
    return true;
  }

  // 3. DEPOSIT UANG (!depo / !deposit)
  if (isDepo) {
    const parts = raw.split(/\s+/);
    const amountArg = parts[1];
    if (!amountArg) {
      await sock.sendMessage(chatId, {
        text: `❓ Format salah!\nContoh: *!depo 5000* atau *!depo all*`,
      }, { quoted: msg });
      return true;
    }

    const amount = resolveAmount(amountArg, userCash);
    if (!amount) {
      if (amountArg.toLowerCase() === 'all' && userCash <= 0) {
        await sock.sendMessage(chatId, { text: `❌ Dompet kamu kosong, tidak ada uang yang bisa didepositkan.` }, { quoted: msg });
        return true;
      }
      await sock.sendMessage(chatId, { text: `❌ Jumlah uang deposit tidak valid!` }, { quoted: msg });
      return true;
    }

    if (userCash < amount) {
      await sock.sendMessage(chatId, {
        text: `❌ Uang tunai tidak cukup!\n💵 Dompet: *Rp ${ui.money(userCash)}*`,
      }, { quoted: msg });
      return true;
    }

    const success = depositBank(realSenderJid, amount);
    if (!success) {
      await sock.sendMessage(chatId, { text: `❌ Gagal memproses deposit bank. Coba lagi.` }, { quoted: msg });
      return true;
    }

    const updatedBank = getBankData(realSenderJid);
    const updatedCash = getUserMoney(realSenderJid);
    await sock.sendMessage(chatId, {
      text: `✅ Berhasil menyimpan *Rp ${ui.money(amount)}* ke Bank!\n\n🏛️ Saldo Bank: *Rp ${ui.money(updatedBank.balance)}*\n💵 Sisa Dompet: *Rp ${ui.money(updatedCash)}*`,
    }, { quoted: msg });
    return true;
  }

  // 4. TARIK UANG (!tarik / !wd / !withdraw)
  if (isTarik) {
    const parts = raw.split(/\s+/);
    const amountArg = parts[1];
    const bankBalance = bank.balance || 0;

    if (!amountArg) {
      await sock.sendMessage(chatId, {
        text: `❓ Format salah!\nContoh: *!tarik 5000* atau *!tarik all*`,
      }, { quoted: msg });
      return true;
    }

    const amount = resolveAmount(amountArg, bankBalance);
    if (!amount) {
      if (amountArg.toLowerCase() === 'all' && bankBalance <= 0) {
        await sock.sendMessage(chatId, { text: `❌ Saldo bank kamu kosong.` }, { quoted: msg });
        return true;
      }
      await sock.sendMessage(chatId, { text: `❌ Jumlah penarikan tidak valid!` }, { quoted: msg });
      return true;
    }

    if (bankBalance < amount) {
      await sock.sendMessage(chatId, {
        text: `❌ Saldo bank tidak cukup!\n🏛️ Saldo Bank: *Rp ${ui.money(bankBalance)}*`,
      }, { quoted: msg });
      return true;
    }

    const success = withdrawBank(realSenderJid, amount);
    if (!success) {
      await sock.sendMessage(chatId, { text: `❌ Gagal menarik uang dari bank. Coba lagi.` }, { quoted: msg });
      return true;
    }

    const updatedBank = getBankData(realSenderJid);
    const updatedCash = getUserMoney(realSenderJid);
    await sock.sendMessage(chatId, {
      text: `✅ Berhasil menarik *Rp ${ui.money(amount)}* dari Bank!\n\n💵 Saldo Dompet: *Rp ${ui.money(updatedCash)}*\n🏛️ Sisa Bank: *Rp ${ui.money(updatedBank.balance)}*`,
    }, { quoted: msg });
    return true;
  }

  return false;
}

// ─── HANDLER BEGAL: !begal, !rob ──────────────────────────
async function handleRob(ctx) {
  const { sock, msg, chatId, senderJid, body } = ctx;
  const raw = body.trim();
  const lower = raw.toLowerCase();

  const isBegal = lower.startsWith('!begal') || lower.startsWith('!rob');
  if (!isBegal) return false;

  const realSenderJid = msg.key.participant || msg.key.remoteJid || senderJid;
  const robStats = getRobStats(realSenderJid);

  // Cek Cooldown Begal
  const now = Date.now();
  const elapsed = now - (robStats.lastRob || 0);
  if (elapsed < ROB_COOLDOWN_MS) {
    const remainingSec = Math.ceil((ROB_COOLDOWN_MS - elapsed) / 1000);
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    await sock.sendMessage(chatId, {
      text: `🚨 Polisi masih patroli ketat! Tunggu *${m}m ${s}s* sebelum membegal lagi.`,
    }, { quoted: msg });
    return true;
  }

  // Cek modal denda pembegal
  const robberCash = getUserMoney(realSenderJid);
  if (robberCash < MIN_ROBBER_CASH) {
    await sock.sendMessage(chatId, {
      text: `❌ Kamu miskin banget untuk jadi begal! Minimal punya *Rp ${ui.money(MIN_ROBBER_CASH)}* di dompet untuk jaminan denda jika tertangkap.`,
    }, { quoted: msg });
    return true;
  }

  // Cari Target
  const mentionedJids = await resolveMentionedJids(msg, raw, sock, chatId);
  const targetJid = mentionedJids[0] || null;

  if (!targetJid) {
    await sock.sendMessage(chatId, {
      text: `❌ Tag atau reply orang yang ingin kamu begal!\nContoh: *!begal @user*`,
    }, { quoted: msg });
    return true;
  }

  if (sameUser(targetJid, realSenderJid)) {
    await sock.sendMessage(chatId, { text: `🤦 Mau begal diri sendiri? Jangan stres gitu bro.` }, { quoted: msg });
    return true;
  }

  // Cek saldo target (hanya cash di dompet yang bisa dibegal)
  const targetCash = getUserMoney(targetJid);
  if (targetCash < MIN_ROB_TARGET_CASH) {
    await sock.sendMessage(chatId, {
      text: `🛡️ Target terlalu miskin atau uangnya sudah disimpan di Bank! Target harus punya minimal *Rp ${ui.money(MIN_ROB_TARGET_CASH)}* di dompet.`,
    }, { quoted: msg });
    return true;
  }

  // Peluang 50% Berhasil
  const isSuccess = Math.random() < 0.5;

  if (isSuccess) {
    // Berhasil: dapat 10% - 30% dari cash korban
    const percent = 0.10 + Math.random() * 0.20;
    const stolenAmount = Math.max(50, Math.floor(targetCash * percent));

    updateRobStats(realSenderJid, true, stolenAmount);
    deductMoney(targetJid, stolenAmount);
    addMoney(realSenderJid, stolenAmount);

    const text = ui.box(
      `🥷 *AKSI BEGAL BERHASIL!*`,
      [
        `Target @${getNumber(targetJid)} berhasil dipojokkan!`,
        ``,
        ui.kv(`💰 Hasil Begal`, `Rp ${ui.money(stolenAmount)}`),
        ui.kv(`💵 Sisa Uang Korban`, `Rp ${ui.money(getUserMoney(targetJid))}`),
        ``,
        `💡 *Korban:* Simpan uangmu di \`!depo\` agar aman dari begal!`,
      ],
      'Operasi Sukses Tanpa Jejak'
    );

    await sock.sendMessage(chatId, {
      text,
      mentions: [realSenderJid, targetJid],
    }, { quoted: msg });
    return true;
  } else {
    // Gagal: Kena tangkap warga/polisi, bayar denda 15% - 25% uang pembegal ke korban
    const finePercent = 0.15 + Math.random() * 0.10;
    const fineAmount = Math.max(100, Math.min(robberCash, Math.floor(robberCash * finePercent)));

    updateRobStats(realSenderJid, false);
    deductMoney(realSenderJid, fineAmount);
    addMoney(targetJid, fineAmount);

    const text = ui.box(
      `🚔 *AKSI BEGAL GAGAL TOTAL!*`,
      [
        `Kamu tertangkap basah saat mencoba membegal @${getNumber(targetJid)}!`,
        `Warga memukuli dan memaksamu ganti rugi!`,
        ``,
        ui.kv(`💸 Denda Diserahkan`, `Rp ${ui.money(fineAmount)}`),
        ui.kv(`💵 Sisa Uangmu`, `Rp ${ui.money(getUserMoney(realSenderJid))}`),
        ``,
        `⏳ Kamu tidak bisa begal selama 20 menit.`,
      ],
      'Tertangkap Warga'
    );

    await sock.sendMessage(chatId, {
      text,
      mentions: [realSenderJid, targetJid],
    }, { quoted: msg });
    return true;
  }
}

// ─── TOP BEGAL: !top begal ─────────────────────────────────
async function handleTopBegal(ctx) {
  const { sock, msg, chatId, body } = ctx;
  if ((body || '').toLowerCase() !== '!top begal') return false;

  const tops = getRobTop(5);
  if (!tops.length) {
    return sock.sendMessage(chatId, { text: '❌ Belum ada data begal!' }, { quoted: msg });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = tops.map((p, i) => `${medals[i] || `*${i + 1}.*`} @${getNumber(p.jid)}\n   └ 💰 Jarahan: Rp ${ui.money(p.stolen)} | 🎯 ${p.successCount} sukses / 💀 ${p.failCount} gagal`);

  return sock.sendMessage(chatId, {
    text: ui.box('🏆 *TOP BEGAL GLOBAL*', lines, 'Pembegal paling meresahkan'),
    mentions: tops.map(p => p.jid)
  }, { quoted: msg });
}

// ─── HANDLER BOBOL BANK: !bobol @user ──────────────────────
// Lebih sulit daripada begal (25% sukses) tapi hasilnya besar (30-50% tabungan).
async function handleBobol(ctx) {
  const { sock, msg, chatId, senderJid, body } = ctx;
  const raw = body.trim();
  const lower = raw.toLowerCase();

  if (lower !== '!bobol' && !lower.startsWith('!bobol ')) return false;

  const realSenderJid = msg.key.participant || msg.key.remoteJid || senderJid;
  const bobolStats = getBobolStats(realSenderJid);

  // Cek Cooldown Bobol
  const now = Date.now();
  const elapsed = now - (bobolStats.lastBobol || 0);
  if (elapsed < BOBOL_COOLDOWN_MS) {
    const remainingSec = Math.ceil((BOBOL_COOLDOWN_MS - elapsed) / 1000);
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    await sock.sendMessage(chatId, {
      text: `🚨 Jaring pengaman bank diperketat! Tunggu *${m}m ${s}s* sebelum membobol lagi.`,
    }, { quoted: msg });
    return true;
  }

  // Cek modal denda pembobol
  const robberCash = getUserMoney(realSenderJid);
  if (robberCash < MIN_ROBBER_CASH) {
    await sock.sendMessage(chatId, {
      text: `❌ Kamu miskin banget untuk jadi pembobol! Minimal punya *Rp ${ui.money(MIN_ROBBER_CASH)}* di dompet untuk jaminan denda jika tertangkap.`,
    }, { quoted: msg });
    return true;
  }

  // Cari Target
  const mentionedJids = await resolveMentionedJids(msg, raw, sock, chatId);
  const targetJid = mentionedJids[0] || null;

  if (!targetJid) {
    await sock.sendMessage(chatId, {
      text: `❌ Tag atau reply orang yang ingin kamu bobol!\nContoh: *!bobol @user*`,
    }, { quoted: msg });
    return true;
  }

  if (sameUser(targetJid, realSenderJid)) {
    await sock.sendMessage(chatId, { text: `🤦 Mau bobol rekening sendiri? Pinjem duit aja bro.` }, { quoted: msg });
    return true;
  }

  // Cek saldo bank target (hanya tabungan bank yang bisa dibobol)
  const targetBank = getBankData(targetJid).balance || 0;
  if (targetBank < MIN_BOBOL_TARGET_BANK) {
    await sock.sendMessage(chatId, {
      text: `🛡️ Tabungan bank target terlalu tipis! Target harus punya minimal *Rp ${ui.money(MIN_BOBOL_TARGET_BANK)}* di bank.`,
    }, { quoted: msg });
    return true;
  }

  // Peluang 25% Berhasil (lebih sulit dari begal)
  const isSuccess = Math.random() < BOBOL_SUCCESS_RATE;

  if (isSuccess) {
    // Berhasil: dapat 30% - 50% dari tabungan korban
    const percent = BOBOL_STEAL_MIN_PERCENT + Math.random() * (BOBOL_STEAL_MAX_PERCENT - BOBOL_STEAL_MIN_PERCENT);
    const stolenAmount = Math.max(BOBOL_STEAL_MIN_AMOUNT, Math.floor(targetBank * percent));

    updateBobolStats(realSenderJid, true, stolenAmount);
    deductBankBalance(targetJid, stolenAmount);
    addMoney(realSenderJid, stolenAmount);

    const text = ui.box(
      `🥷 *AKSI BOBOL BERHASIL!*`,
      [
        `Tabungan @${getNumber(targetJid)} berhasil dijebol!`,
        ``,
        ui.kv(`💰 Hasil Bobol`, `Rp ${ui.money(stolenAmount)}`),
        ui.kv(`🏛️ Sisa Tabungan Korban`, `Rp ${ui.money(getBankData(targetJid).balance || 0)}`),
        ``,
        `💡 *Korban:* Tarik uangmu ke dompet agar tak bisa dibobol.`,
      ],
      'Brankas Terbongkar Tanpa Jejak'
    );

    await sock.sendMessage(chatId, {
      text,
      mentions: [realSenderJid, targetJid],
    }, { quoted: msg });
    return true;
  } else {
    // Gagal: Alaram berbunyi, bayar denda 20% - 30% uang pembobol ke korban
    const finePercent = BOBOL_FINE_MIN_PERCENT + Math.random() * (BOBOL_FINE_MAX_PERCENT - BOBOL_FINE_MIN_PERCENT);
    const fineAmount = Math.max(100, Math.min(robberCash, Math.floor(robberCash * finePercent)));

    updateBobolStats(realSenderJid, false);
    deductMoney(realSenderJid, fineAmount);
    addMoney(targetJid, fineAmount);

    const text = ui.box(
      `🚔 *AKSI BOBOL GAGAL TOTAL!*`,
      [
        `Kamu tertangkap sapol PP saat membobol @${getNumber(targetJid)}!`,
        `Sirene meraung dan kamu dihakimi warga!`,
        ``,
        ui.kv(`💸 Denda Diserahkan`, `Rp ${ui.money(fineAmount)}`),
        ui.kv(`💵 Sisa Uangmu`, `Rp ${ui.money(getUserMoney(realSenderJid))}`),
        ``,
        `⏳ Kamu tidak bisa bobol selama 20 menit.`,
      ],
      'Tertangkap Basah'
    );

    await sock.sendMessage(chatId, {
      text,
      mentions: [realSenderJid, targetJid],
    }, { quoted: msg });
    return true;
  }
}

// ─── TOP BOBOL: !top bobol ─────────────────────────────────
async function handleTopBobol(ctx) {
  const { sock, msg, chatId, body } = ctx;
  if ((body || '').toLowerCase() !== '!top bobol') return false;

  const tops = getBobolTop(5);
  if (!tops.length) {
    return sock.sendMessage(chatId, { text: '❌ Belum ada data bobol!' }, { quoted: msg });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = tops.map((p, i) => `${medals[i] || `*${i + 1}.*`} @${getNumber(p.jid)}\n   └ 💰 Jarahan Bank: Rp ${ui.money(p.stolen)} | 🎯 ${p.successCount} sukses / 💀 ${p.failCount} gagal`);

  return sock.sendMessage(chatId, {
    text: ui.box('🏆 *TOP BOBOL GLOBAL*', lines, 'Pembobol brankas paling licik'),
    mentions: tops.map(p => p.jid)
  }, { quoted: msg });
}

module.exports = { handleBank, handleRob, handleTopBegal, handleBobol, handleTopBobol };
