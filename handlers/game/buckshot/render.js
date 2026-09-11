// handlers/game/buckshot/render.js
// Format pesan UI WhatsApp untuk Buckshot Roulette.
const { getNumber, sameUser } = require('../../../utils/jid');
const ui = require('../../../utils/ui');
const { quickReply, listButton } = require('../../../utils/buttons');

const ITEM_ICONS = {
  kaca: '🔍 Kaca',
  rokok: '🚬 Rokok',
  gergaji: '🪚 Gergaji',
  borgol: '⛓️ Borgol',
  bir: '🍺 Bir',
};

function renderHp(hp, maxHp = 3) {
  let hearts = '';
  for (let i = 0; i < maxHp; i++) {
    hearts += i < hp ? '❤️' : '🖤';
  }
  return `${hearts} (${hp}/${maxHp})`;
}

function playerName(jid) {
  if (jid === 'DEALER_BOT') return '🤖 Dealer (Bot)';
  return `@${getNumber(jid)}`;
}

// Cek status "sudah menerima" secara alias-aware (LID vs nomor HP tidak
// masalah). Key `accepted` memakai JID mentah pengirim, sementara daftar
// pemain diundang bisa tersimpan dengan JID beda domain (mis. fallback
// @s.whatsapp.net vs member asli @lid).
function isAccepted(game, jid) {
  if (!game || !game.accepted) return false;
  return Object.keys(game.accepted).some(k => k === jid || sameUser(k, jid));
}

/**
 * Render undangan / tantangan menunggu pemain
 */
function renderInviteMessage(game) {
  const lines = [
    `🎲 *BUCKSHOT ROULETTE — TANTANGAN BARU* 🎲`,
    ``,
    `Tantangan dari: ${playerName(game.creator)}`,
    `Taruhan: *${game.bet > 0 ? `${ui.money(game.bet)} Money` : 'Gratis (Fun)'}*`,
    `Total Pemain Diundang: *${game.invited.length} orang*`,
    ``,
    `📋 *Daftar Pemain:*`,
  ];

  for (const jid of [game.creator, ...game.invited]) {
    const isAcceptedPlayer = isAccepted(game, jid);
    const status = isAcceptedPlayer ? '✅ Siap' : '⏳ Menunggu';
    lines.push(`• ${playerName(jid)}: ${status}`);
  }

  lines.push(``);
  lines.push(`Ketik *!terima* atau *!brterima* untuk menerima tantangan.`);
  lines.push(`Ketik *!tolak* atau *!brtolak* untuk menolak.`);
  if (game.invited.length > 1) {
    lines.push(`Pembuat game bisa ketik *!brmulai* jika minimal 2 orang sudah siap.`);
  }
  lines.push(`Ketik *!brbatal* untuk membatalkan tantangan.`);
  lines.push(`⏰ Batas waktu: 2 menit.`);

  return lines.join('\n');
}

/**
 * Buat tombol quick action untuk tahap tantangan/undangan
 */
function buildInviteButtons(game) {
  const buttons = [
    quickReply('!terima', '✅ Terima'),
    quickReply('!tolak', '❌ Tolak'),
  ];
  if (game.invited.length > 1) {
    buttons.push(quickReply('!brmulai', '▶️ Mulai'));
  } else {
    buttons.push(quickReply('!brbatal', '🚫 Batal'));
  }
  return buttons;
}

/**
 * Render informasi reload peluru baru
 */
function renderReloadMessage(shellsInfo, itemsGiven) {
  const lines = [
    `🔄 *SENAPAN DIISI ULANG!* 🔄`,
    ``,
    `Senapan shotgun diisi:`,
    `🔴 Peluru Tajam : *${shellsInfo.totalLive}*`,
    `⚪ Peluru Kosong: *${shellsInfo.totalBlank}*`,
    `Urutan peluru telah diacak secara rahasia!`,
    ``,
    `🎁 *Item Baru Dibagikan (+2 item per pemain):*`,
  ];

  for (const [jid, items] of Object.entries(itemsGiven)) {
    const itemStr = items.length > 0 ? items.map(it => ITEM_ICONS[it] || it).join(', ') : '(Penuh)';
    lines.push(`• ${playerName(jid)}: ${itemStr}`);
  }

  return lines.join('\n');
}

/**
 * Render papan status permainan (HP, item, giliran, efek aktif)
 */
function renderGameStatus(game, actionNote = '') {
  const liveLeft = game.shells.filter(s => s === 'live').length;
  const blankLeft = game.shells.filter(s => s === 'blank').length;

  const lines = [
    `💥 *BUCKSHOT ROULETTE* 💥`,
  ];

  if (actionNote) {
    lines.push(``);
    lines.push(actionNote);
  }

  lines.push(``);
  lines.push(`🔫 *Status Senapan:*`);
  lines.push(`• Sisa Shell : *${game.shells.length}* (🔴 ${liveLeft} Tajam | ⚪ ${blankLeft} Kosong)`);
  if (game.doubleNext) {
    lines.push(`• ⚠️ *Gergaji Aktif:* Tembakan berikutnya bernilai *2 DAMAGE*!`);
  }
  if (game.handcuffed) {
    lines.push(`• ⛓️ *Borgol:* Giliran ${playerName(game.handcuffed)} diskip putaran ini.`);
  }

  lines.push(``);
  lines.push(`👥 *Kondisi Pemain:*`);
  for (const jid of game.players) {
    const hpStr = renderHp(game.hp[jid], game.maxHp);
    const deadTag = game.hp[jid] <= 0 ? ' 💀 [MATI]' : '';
    const turnTag = jid === game.turn ? ' 👉 [GILIRAN]' : '';
    const items = (game.items[jid] || []).map(it => ITEM_ICONS[it] || it).join(', ') || '-';

    lines.push(`• ${playerName(jid)}${turnTag}${deadTag}`);
    lines.push(`  HP: ${hpStr}`);
    if (game.hp[jid] > 0) {
      lines.push(`  Saku: [ ${items} ]`);
    }
  }

  lines.push(``);
  lines.push(`🎯 *Giliran Sekarang:* ${playerName(game.turn)}`);
  lines.push(``);
  lines.push(`Perintah:`);
  lines.push(`• *!tembak diri* (tembak diri sendiri, bonus turn jika kosong)`);
  if (game.players.length === 2) {
    lines.push(`• *!tembak dia* / *!tembak lawan*`);
  } else {
    lines.push(`• *!tembak @lawan* (tembak target pilihanmu)`);
  }
  lines.push(`• *!item [kaca/rokok/gergaji/borgol/bir]*`);

  return lines.join('\n');
}

/**
 * Buat tombol quick action saat game sedang berjalan.
 * Maks 3 tombol (WhatsApp interactive limit):
 * 1. Tembak Diri
 * 2. Tembak Lawan (atau list select target jika multiplayer > 2)
 * 3. List Item di saku atau quick stats
 */
function buildGameButtons(game) {
  const buttons = [];
  const currentTurnJid = game.turn;
  const aliveOpponents = game.players.filter(j => game.hp[j] > 0 && j !== currentTurnJid);

  // Tombol 1: Tembak Diri Sendiri
  buttons.push(quickReply('!tembak diri', '🎯 Tembak Diri'));

  // Tombol 2: Tembak Lawan
  if (aliveOpponents.length === 1) {
    buttons.push(quickReply('!tembak dia', '💥 Tembak Lawan'));
  } else if (aliveOpponents.length > 1) {
    const rows = aliveOpponents.map((opp, idx) => ({
      title: `Tembak Lawan ${idx + 1}`,
      description: `Target: @${getNumber(opp)} (HP: ${game.hp[opp]})`,
      id: `!tembak @${getNumber(opp)}`,
    }));
    buttons.push(listButton('🎯 Pilih Target Tembak', [{ title: 'Target Lawan', rows }]));
  }

  // Tombol 3: Pakai Item dari Saku Pemain Giliran Aktif
  const turnItems = game.items[currentTurnJid] || [];
  if (turnItems.length > 0) {
    // Kelompokkan item unik
    const uniqueItems = Array.from(new Set(turnItems));
    const rows = uniqueItems.map(item => {
      const count = turnItems.filter(i => i === item).length;
      return {
        title: `Pakai ${ITEM_ICONS[item] || item}`,
        description: `Jumlah: ${count}x di saku`,
        id: `!item ${item}`,
      };
    });
    buttons.push(listButton('🎒 Pakai Item', [{ title: 'Item Saku', rows }]));
  } else {
    // Jika tidak ada item, sediakan tombol cek status
    buttons.push(quickReply('!brstats', '📊 Status'));
  }

  return buttons;
}

/**
 * Render pemenang akhir game
 */
function renderVictoryMessage(winnerJid, pot, bet) {
  const lines = [
    `🏆 *GAME OVER — BUCKSHOT ROULETTE* 🏆`,
    ``,
    `Selamat kepada ${playerName(winnerJid)}!`,
    `Kamu adalah satu-satunya yang selamat dari meja maut!`,
  ];

  if (pot > 0) {
    lines.push(``);
    lines.push(`💰 Total Hadiah: *${ui.money(pot)} Money* berhasil dibawa pulang!`);
  }

  return lines.join('\n');
}

module.exports = {
  ITEM_ICONS,
  renderHp,
  playerName,
  isAccepted,
  renderInviteMessage,
  buildInviteButtons,
  renderReloadMessage,
  renderGameStatus,
  buildGameButtons,
  renderVictoryMessage,
};
