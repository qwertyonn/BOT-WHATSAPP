// handlers/economy/profile.js
// Profil global (!me) & peringkat terkaya global (!top money / !topmoney)
const { getUserMoney, getTopGlobalMoney, getBankData } = require('../../data/db');
const ui = require('../../utils/ui');
const { getNumber } = require('../../utils/jid');

// ─── !me — Profil Global ───────────────────────────────────
async function handleMe(ctx) {
  const { sock, msg, chatId, body, senderJid } = ctx;
  if (body.toLowerCase() !== '!me') return false;

  try {
    const realSenderJid = msg.key.participant || msg.key.remoteJid || senderJid;
    const tagName       = `@${getNumber(realSenderJid)}`;
    const money         = getUserMoney(realSenderJid);
    const bank          = getBankData(realSenderJid);

    const responseText = ui.box(
      `👤 *PROFIL AKUN*`,
      [
        ui.kv(`🏷️ Pengguna`, tagName),
        ui.kv(`💰 Saldo Dompet`, `Rp ${ui.money(money)}`),
        ui.kv(`🏛️ Saldo Bank`, `Rp ${ui.money(bank.balance || 0)}`),
        ui.kv(`🆔 User ID`, getNumber(realSenderJid)),
        ``,
        ui.bullet(`Ketik \`!bank\` untuk perbankan & bunga`),
        ui.bullet(`Ketik \`!claim\` untuk ambil bonus harian`),
        ui.bullet(`Ketik \`!tf @user [jml]\` untuk transfer uang`),
      ],
      'Status Terverifikasi Bot'
    );

    // Kirim foto profil sebagai gambar + caption; fallback teks jika PP tidak tersedia
    try {
      const ppUrl = await sock.profilePictureUrl(realSenderJid, 'image');
      if (ppUrl) {
        await sock.sendMessage(chatId, {
          image: { url: ppUrl },
          caption: responseText,
          mentions: [realSenderJid],
        }, { quoted: msg });
        return true;
      }
    } catch (ppErr) {
      console.warn('⚠️ Gagal mengambil foto profil untuk !me:', ppErr.message);
    }

    await sock.sendMessage(chatId, { text: responseText, mentions: [realSenderJid] }, { quoted: msg });
  } catch (err) {
    console.error('❌ Error Global command "!me":', err);
  }
  return true;
}

// ─── !top money / !topmoney — Peringkat terkaya global ────
async function handleTopMoney(ctx) {
  const { sock, msg, chatId, body } = ctx;
  if (body.toLowerCase() !== '!top money' && body.toLowerCase() !== '!topmoney') return false;

  try {
    const tops = getTopGlobalMoney(10);
    if (!tops.length) {
      await sock.sendMessage(chatId, { text: `❌ Belum ada data pemain!` }, { quoted: msg });
      return true;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = tops.map((p, i) => `${medals[i] || `*${i + 1}.*`} *${p.name}* \n   └ 💰 Rp ${ui.money(p.money)}`);
    await sock.sendMessage(chatId, { text: ui.box(`🏆 *TOP GLOBAL MONEY*`, lines, 'Pemain dengan saldo terbanyak') }, { quoted: msg });
  } catch (err) {
    console.error('❌ Error Global command "!top money":', err);
  }
  return true;
}

module.exports = { handleMe, handleTopMoney };
