// ============================================================
// FISHING COMMAND HANDLERS
// ============================================================
const {
  getFishingPlayer, updateFishingPlayer,
  getUserMoney, addMoney, deductMoney, getTopRarity,
} = require('../../../data/db');
const { TIERS, LOCATIONS, ALL_FISH, RODS, BAITS } = require('../../../data/gameData');
const {
  rollTier, pickFish, getRodBonus, getBaitBonus,
  formatWeight, formatGold, getFishingDelay, FISHING_COOLDOWN,
  FISH_SELL_TIERS, fishUnitPrice,
} = require('../../../game/fishingEngine');
const ui = require('../../../utils/ui');
const { quickReply, sendMenu, listButton } = require('../../../utils/buttons');
const { evaluateAchievements, renderUnlocked } = require('./achievements');
const { parsePositiveAmount } = require('../../../utils/amount');

// State mancing aktif: Map<jid, { locId, startTime }>
const activeFishing = new Map();

// Ses i prompt jumlah jual: botMsgId → { senderJid, fishName }
const sellPrompts = new Map();

function rememberSellPrompt(sentMsg, senderJid, fishName) {
  if (!sentMsg?.key?.id) return;
  sellPrompts.set(sentMsg.key.id, { senderJid, fishName });
  const timer = setTimeout(() => sellPrompts.delete(sentMsg.key.id), 5 * 60 * 1000);
  if (timer.unref) timer.unref();
}

// Sesi prompt jumlah beli umpan: botMsgId → { senderJid, baitId }
const buyPrompts = new Map();

function rememberBuyPrompt(sentMsg, senderJid, baitId) {
  if (!sentMsg?.key?.id) return;
  buyPrompts.set(sentMsg.key.id, { senderJid, baitId });
  const timer = setTimeout(() => buyPrompts.delete(sentMsg.key.id), 5 * 60 * 1000);
  if (timer.unref) timer.unref();
}

// ─── !f.menu ─────────────────────────────────────────────
function cmdMenu(playerName) {
  return ui.box('🌊 *FISHIT*', [
    `Halo, *${playerName}*! Siap memancing?`,
    ``,
    ui.section(`👤 *AKUN PEMAIN*`),
    ``,
    ui.cmd('!fishit profil', 'Status & statistik'),
    ui.cmd('!fishit inv', 'Cek tas & umpan'),
    ui.cmd('!gantinama [nama]', 'Ubah nama semua game (100k)'),
    ``,
    ui.section(`🎣 *AKTIVITAS MANCING*`),
    ``,
    ui.cmd('!fishit lokasi', 'Daftar spot mancing'),
    ui.cmd('!fishit mancing [no]', 'Mulai memancing'),
    ``,
    ui.section(`💼 *PASAR & EKONOMI*`),
    ``,
    ui.cmd('!fishit shop [rod/bait]', 'Toko joran & umpan'),
    ui.cmd('!fishit beli [type] [id] [jml]'),
    ui.cmd('!fishit jual all', 'Jual hasil tangkapan'),
    ``,
    ui.section(`🏆 *PAPAN PERINGKAT*`),
    ``,
    ui.cmd('!fishit top player'),
    ui.cmd('!fishit achievement', 'Koleksi achievement & reward'),
    ``,
    ui.section(`📖 *DATA KOLEKSI*`),
    ``,
    ui.cmd('!fishit fishdex', 'Koleksi jenis ikan'),
  ], 'Pilih perintah yang kamu butuhkan.');
}

// ─── !f.profil ───────────────────────────────────────────
function cmdProfil(jid) {
  const p = getFishingPlayer(jid);
  if (!p) return `❌ Kamu belum terdaftar di FishIt.`;
  const rod          = RODS.find(r => r.id === p.rod) || RODS[0];
  const totalFish    = Object.values(p.inventory || {}).reduce((acc, v) => acc + v.count, 0);
  const fishdexCount = Object.keys(p.fishdex || {}).length;
  const rarityInfo   = p.rarityRecord.tier > 0 ? TIERS[p.rarityRecord.tier] : null;
  return ui.box('👤 PROFIL PEMANCING', [
    ui.kv('🎭 Nama', `*${p.name}*`),
    ui.kv('💰 Money', `*${formatGold(getUserMoney(jid))}*`),
    ui.kv('🎣 Joran', `*${rod.emoji} ${rod.name}*`),
    ui.kv('🐟 Ikan di Inv', `*${totalFish} ekor*`),
    ui.kv('📖 Fishdex', `*${fishdexCount}/${ALL_FISH.length} jenis*`),
    ui.kv('🏆 Total Tangkapan', `*${p.totalCaught}x*`),
    ``,
    `🌟 *TANGKAPAN TERLANGKA*`,
    rarityInfo
      ? `${rarityInfo.emoji} ${p.rarityRecord.fishName} (${rarityInfo.name})\n⚖️ ${formatWeight(p.rarityRecord.weight)}`
      : '_Belum ada tangkapan spesial_',
  ], 'Terus mancing! 🎣');
}

// ─── !f.lokasi ───────────────────────────────────────────
function cmdLokasi() {
  let lines = [];
  for (const [id, loc] of Object.entries(LOCATIONS)) {
    const reqRod = RODS.find(r => r.tier === loc.minRodTier) || { name: 'Bebas' };
    lines.push(`• *${id}. ${loc.emoji} ${loc.name}*`);
    lines.push(`  📝 ${loc.desc}`);
    lines.push(`  🐟 ${TIERS[loc.minTier].emoji}${TIERS[loc.minTier].name} ~ ${TIERS[loc.maxTier].emoji}${TIERS[loc.maxTier].name}`);
    lines.push(`  🎣 Syarat: *${reqRod.name}* (Tier ${loc.minRodTier})`);
    lines.push('');
  }
  lines.push(ui.bullet('Ketik *!fishit mancing [nomor]* untuk mulai!'));
  return ui.box('🗺️ PILIH LOKASI', lines);
}

// Sections dropdown pilihan lokasi per zona joran (id = command, bridge di index.js)
function getLocationRows() {
  const zones = [
    { key: '🎣 Pemula (Rod T1-3)', min: 1, max: 3 },
    { key: '🌊 Menengah (Rod T4-7)', min: 4, max: 7 },
    { key: '🔱 Pro (Rod T8+)', min: 8, max: 99 },
  ];
  const byZone = zones.map(z => ({ ...z, items: [] }));
  for (const [id, loc] of Object.entries(LOCATIONS)) {
    const zone = byZone.find(z => loc.minRodTier >= z.min && loc.minRodTier <= z.max);
    if (zone) {
      zone.items.push({
        title: `${id}. ${loc.emoji} ${loc.name}`,
        description: `${TIERS[loc.minTier].emoji}~${TIERS[loc.maxTier].emoji} · ${loc.desc.slice(0, 24)}`,
        id: `!fishit mancing ${id}`,
      });
    }
  }
  return byZone.filter(z => z.items.length).map(z => ({ title: z.key, rows: z.items }));
}

// ─── !f.mancing ──────────────────────────────────────────
// Alur: validasi → konsumsi 1 umpan sekarang → kirim "sedang memancing"
// → 5 detik (getFishingDelay) → hasil (zonk atau tangkapan).
async function cmdMancing(jid, locationId, sock, chatId, rawMsg) {
  let p = getFishingPlayer(jid);
  if (!p) return `❌ Kamu belum terdaftar di FishIt.`;

  // Migrasi sekali: ekonomi dirombak → inventory ikan & umpan lama dihapus,
  // progresi (joran, fishdex, achievement, totalCaught) dipertahankan.
  if (!p.econV2) {
    updateFishingPlayer(jid, { inventory: {}, bait: {}, econV2: true });
    p = getFishingPlayer(jid);
    return `🔄 Ekonomi FishIt dirombak! Inventori ikan & umpan kamu di-reset.\nJoran, Fishdex & Achievement tetap.\n\nSilakan mancing lagi dari awal. 🎣`;
  }

  const locId = parsePositiveAmount(locationId);
  const loc   = LOCATIONS[locId];
  if (!loc) return `❌ Lokasi tidak valid! Ketik *!fishit lokasi*.`;

  const playerRod = RODS.find(r => r.id === p.rod) || RODS[0];
  if (playerRod.tier < loc.minRodTier) {
    const reqRod = RODS.find(r => r.tier === loc.minRodTier);
    return `❌ Joran tidak cukup kuat!\n📍 *${loc.name}* butuh: *${reqRod.name}* (Tier ${loc.minRodTier})\nUpgrade di *!fishit shop rod*!`;
  }

  const now = Date.now();
  if (p.fishingCooldown > now) {
    const sisa = Math.ceil((p.fishingCooldown - now) / 1000);
    return `⏳ Sabar! Cooldown *${sisa} detik*.`;
  }
  if (activeFishing.has(jid)) return `🎣 Kamu sudah mancing! Tunggu hasilnya...`;

  const playerBaits = p.bait || {};
  let usedBait = null;
  for (let i = BAITS.length - 1; i >= 0; i--) {
    const b = BAITS[i];
    if (playerBaits[b.id] && playerBaits[b.id] > 0) { usedBait = b; break; }
  }
  if (!usedBait) return `❌ Kamu tidak punya umpan! Beli di *!fishit shop bait*`;

  // Konsumsi umpan SEKARANG (anti-exploit: matikan bot saat nunggu ≠ mancing gratis)
  const newBaits = { ...playerBaits };
  newBaits[usedBait.id]--;

  activeFishing.set(jid, { locId, startTime: now });

  const startMsg = ui.box('🎣 MANCING', [
    `*${p.name}* sedang memancing di *${loc.emoji} ${loc.name}*!`,
    ui.kv('🪱 Umpan', `${usedBait.emoji} ${usedBait.name}`),
    ui.kv('🎣 Joran', `${playerRod.emoji} ${playerRod.name}`),
  ], 'Menunggu ikan menggigit... 🌊');
  await sock.sendMessage(chatId, { text: startMsg }, { quoted: rawMsg });

  setTimeout(async () => {
    activeFishing.delete(jid);
    const fresh = getFishingPlayer(jid);
    if (!fresh) return;

    updateFishingPlayer(jid, { bait: newBaits, fishingCooldown: now + FISHING_COOLDOWN });

    const rodBonus  = getRodBonus(fresh.rod);
    const baitBonus = getBaitBonus(usedBait.id);
    const tier      = rollTier(locId, rodBonus, baitBonus);

    if (tier === null) {
      const zonkMessages = [
        '❌ Yah, ikannya lepas! Umpanmu habis dimakan.',
        '❌ Tidak ada tarikan sama sekali...',
        '❌ Umpanmu dicuri ikan kecil!',
        '❌ Arus terlalu kuat, kailmu tersangkut!',
      ];
      const zonkText = zonkMessages[Math.floor(Math.random() * zonkMessages.length)];
      await sendMenu(sock, chatId, {
        text: zonkText,
        footer: '🎣 Coba lagi?',
        quoted: rawMsg,
        fallbackText: zonkText,
        buttons: [quickReply(`!fishit mancing ${locId}`, '🎣 Mancing Lagi')],
      });
      return null;
    }

    // ── Tangkapan masuk ──
    const caught = pickFish(tier);
    if (!caught) return null;

    const newInv = { ...(fresh.inventory || {}) };
    if (newInv[caught.name]) {
      newInv[caught.name].count++;
      newInv[caught.name].weight += caught.weight;
    } else {
      newInv[caught.name] = { count: 1, weight: caught.weight, tier: caught.tier };
    }

    const newFishdex = { ...(fresh.fishdex || {}) };
    const isNew      = !newFishdex[caught.name];
    if (isNew) {
      newFishdex[caught.name] = { caught: 1, maxWeight: caught.weight, tier: caught.tier, firstCaught: Date.now() };
    } else {
      newFishdex[caught.name].caught++;
      if (caught.weight > newFishdex[caught.name].maxWeight) newFishdex[caught.name].maxWeight = caught.weight;
    }

    let newRarityRecord = { ...(fresh.rarityRecord || { tier: 0, fishName: '', weight: 0 }) };
    if (caught.tier > newRarityRecord.tier || (caught.tier === newRarityRecord.tier && caught.weight > newRarityRecord.weight)) {
      newRarityRecord = { tier: caught.tier, fishName: caught.name, weight: caught.weight };
    }

    const tierInfo = TIERS[caught.tier];

    updateFishingPlayer(jid, {
      bait: newBaits, inventory: newInv, fishdex: newFishdex,
      rarityRecord: newRarityRecord,
      totalCaught: (fresh.totalCaught || 0) + 1,
      fishingCooldown: Date.now() + FISHING_COOLDOWN,
    });

    let body = [
      `🎉 *${fresh.name}* berhasil menangkap!`,
      ``,
      `${tierInfo.emoji} *${caught.name}*`,
      ui.kv('✨ Tier', `*${tierInfo.name}*`),
      ui.kv('⚖️ Bobot', `*${formatWeight(caught.weight)}*`),
      ui.kv('💰 Est. Harga', `*${formatGold(caught.price)}*`),
    ];
    if (isNew) body.push('', '🆕 *IKAN BARU di Fishdex!* 📖');

    const newly = evaluateAchievements(getFishingPlayer(jid));
    if (newly.length) body.push(renderUnlocked(newly));

    const resultMsg = ui.box('🐟 TANGKAPAN', body, 'Ketik !fishit jual all untuk menjual ikan');
    await sendMenu(sock, chatId, {
      text: resultMsg,
      footer: '🎣 Lanjut memancing?',
      quoted: rawMsg,
      fallbackText: resultMsg,
      buttons: [quickReply(`!fishit mancing ${locId}`, '🎣 Mancing Lagi')],
    });
    return null;
  }, getFishingDelay());

  return null;
}

// ─── !f.inv ──────────────────────────────────────────────
function cmdInv(jid) {
  const p = getFishingPlayer(jid);
  if (!p) return `❌ Belum terdaftar di FishIt.`;
  const inv   = p.inventory || {};
  const baits = p.bait || {};
  const lines = [
    ui.kv('💰 Money', `*${formatGold(getUserMoney(jid))}*`),
    ``,
    `🐟 *IKAN*`,
  ];
  const entries = Object.entries(inv);
  if (!entries.length) {
    lines.push('_Belum ada ikan. Yuk mancing! 🎣_');
  } else {
    for (const [name, data] of entries) {
      lines.push(`${TIERS[data.tier].emoji} ${name} x${data.count} (${formatWeight(data.weight)} total)`);
    }
  }
  lines.push('', `🪱 *UMPAN*`);
  let hasBait = false;
  for (const bait of BAITS) {
    if (baits[bait.id] && baits[bait.id] > 0) { lines.push(`${bait.emoji} ${bait.name} x${baits[bait.id]}`); hasBait = true; }
  }
  if (!hasBait) lines.push('_Tidak ada umpan! Beli di !fishit shop bait_');
  return ui.box('🎒 INVENTORI', lines);
}

// ─── !f.jual ─────────────────────────────────────────────
// 3 mode: tanpa arg → dropdown pilih ikan/jual semua; hanya nama ikan →
// prompt jumlah (teks); nama + jumlah → jual langsung.
async function cmdJual(sock, chatId, jid, args, quotedMsg) {
  const p = getFishingPlayer(jid);
  if (!p) return `❌ Belum terdaftar di FishIt.`;
  const inv = { ...(p.inventory || {}) };
  if (!Object.keys(inv).length) return `❌ Inventori ikan kosong!`;

  // ─── MODE 1: TANPA ARG → DROPDOWN ───
  if (!args.length) {
    const sections = [
      { title: '🏷️ Jual Semua', rows: [{ title: '🔁 Jual Semua', description: `Semua ${Object.keys(inv).length} jenis`, id: '!fishit jual all' }] },
      { title: '🐟 Ikan', rows: Object.entries(inv).map(([name, data]) => ({
        title: `${TIERS[data.tier].emoji} ${name} x${data.count}`,
        description: `~${formatGold(fishUnitPrice(data))}/ekor`,
        id: `!fishit jual ${name}`,
      })) },
    ];
    const jualText = ui.box('💰 JUAL IKAN', [
      'Pilih ikan yang ingin dijual:',
      ui.bullet('*Jual Semua* — jual semua ikan sekaligus'),
      ui.bullet('Pilih ikan → ketik jumlahnya'),
    ]);
    await sendMenu(sock, chatId, {
      text: jualText,
      footer: '💰 Pilih ikan untuk dijual',
      quoted: quotedMsg,
      fallbackText: jualText,
      buttons: [listButton('💰 Jual Ikan', sections)],
    });
    return null;
  }

  // ─── MODE 2: HANYA NAMA IKAN (TANPA JUMLAH) → PROMPT ───
  {
    const lastArg = args[args.length - 1];
    const hasQty = parsePositiveAmount(lastArg) !== null;
    const fishName = (hasQty ? args.slice(0, -1) : args).join(' ');
    if (!hasQty && fishName.toLowerCase() !== 'all') {
      const matchKey = Object.keys(inv).find(k => k.toLowerCase() === fishName.toLowerCase())
                    || Object.keys(inv).find(k => k.toLowerCase().includes(fishName.toLowerCase()));
      if (matchKey) {
        const maxCount = inv[matchKey].count;
        const promptText = `❓ Jual *${matchKey}* berapa ekor? (maks ${maxCount})\n\nBalas ketik *!fishit jual ${matchKey} [jumlah]*, ketik *all* utk semua, atau tap tombol di bawah.`;
        const msgId = await sendMenu(sock, chatId, {
          text: promptText,
          footer: `🐟 ${matchKey}`,
          quoted: quotedMsg,
          fallbackText: promptText,
          buttons: [quickReply(`!fishit jual ${matchKey} all`, '📦 Jual Semua')],
        });
        if (msgId) rememberSellPrompt({ key: { id: msgId } }, jid, matchKey);
        return null;
      }
    }
  }

  const tierMults = FISH_SELL_TIERS;
  let totalEarned = 0, soldList = [];

  if (args[0]?.toLowerCase() === 'all') {
    for (const [name, data] of Object.entries(inv)) {
      const earn = Math.floor(data.weight * (tierMults[data.tier] || 10));
      totalEarned += earn;
      soldList.push(`${TIERS[data.tier].emoji} ${name} x${data.count} → *${formatGold(earn)}*`);
    }
    addMoney(jid, totalEarned);
    updateFishingPlayer(jid, { inventory: {} });
    return ui.box('💰 JUAL SEMUA', [
      ...soldList,
      '',
      ui.kv('💵 Total', `*${formatGold(totalEarned)}*`),
      ui.kv('💰 Money', `*${formatGold(getUserMoney(jid))}*`),
    ]);
  }

  let amount = 1;
  const lastArg = args[args.length - 1];
  const lastIsAll = lastArg?.toLowerCase() === 'all' || lastArg?.toLowerCase() === 'semua';
  let fishArgs = [...args];
  if (lastIsAll) { fishArgs = fishArgs.slice(0, -1); }
  else if (parsePositiveAmount(lastArg) !== null) { amount = parsePositiveAmount(lastArg); fishArgs = fishArgs.slice(0, -1); }
  const fishName = fishArgs.join(' ');
  const keys = Object.keys(inv);
  const matchKey = keys.find(k => k.toLowerCase() === fishName.toLowerCase())
                || keys.find(k => k.toLowerCase().includes(fishName.toLowerCase()));
  if (!matchKey) return `❌ Ikan "${fishName}" tidak ditemukan!`;
  const fishData = inv[matchKey];
  if (lastIsAll) amount = fishData.count;
  if (fishData.count < amount) return `❌ Kamu hanya punya *${fishData.count}x ${matchKey}*.`;
  const avgWeight = fishData.weight / fishData.count;
  const earn      = Math.floor(avgWeight * amount * (tierMults[fishData.tier] || 10));
  fishData.count  -= amount;
  fishData.weight -= avgWeight * amount;
  if (fishData.count <= 0) delete inv[matchKey]; else inv[matchKey] = fishData;
  addMoney(jid, earn);
  updateFishingPlayer(jid, { inventory: inv });
  return ui.box('💰 TERJUAL', [
    `${TIERS[fishData.tier].emoji} ${matchKey} x${amount}`,
    ui.kv('💵 Dapat', `*${formatGold(earn)}*`),
    ui.kv('💰 Money', `*${formatGold(getUserMoney(jid))}*`),
  ]);
}

// ─── !f.shop ─────────────────────────────────────────────
async function cmdShop(sock, chatId, args, quotedMsg) {
  const sub = args[0]?.toLowerCase();
  if (sub === 'rod' || sub === 'joran') {
    let lines = [];
    for (const rod of RODS) {
      lines.push(`${rod.emoji} *${rod.name}* (Tier ${rod.tier})`);
      lines.push(`   💰 ${formatGold(rod.price)} | +${rod.bonus} bonus`);
      lines.push(`   Beli: *!fishit beli joran ${rod.id}*`, '');
    }
    return ui.box('🎣 TOKO PANCINGAN', lines, '!fishit shop bait untuk umpan');
  }
  if (sub === 'bait' || sub === 'umpan') {
    let lines = [];
    for (const bait of BAITS) {
      lines.push(`${bait.emoji} *${bait.name}*`);
      lines.push(`   💰 ${formatGold(bait.price)}/pcs | +${bait.bonus} bonus`);
      lines.push(`   Beli: *!fishit beli umpan ${bait.id} [jumlah]*`, '');
    }
    return ui.box('🪱 TOKO UMPAN', lines, '!fishit shop rod untuk joran');
  }

  // Tanpa sub → 2 tombol dropdown (Joran & Umpan)
  const shopText = ui.box('🏪 FISHING SHOP', [
    'Pilih kategori toko:',
    '',
    ui.cmd('!fishit shop rod', 'Toko Joran'),
    ui.cmd('!fishit shop bait', 'Toko Umpan'),
  ]);
  const rodRows = RODS.map(rod => ({
    title: `${rod.emoji} ${rod.name}`,
    description: `💰 ${formatGold(rod.price)} | +${rod.bonus} bonus`,
    id: `!fishit beli joran ${rod.id}`,
  }));
  const baitRows = BAITS.map(bait => ({
    title: `${bait.emoji} ${bait.name}`,
    description: `💰 ${formatGold(bait.price)}/pcs | +${bait.bonus} bonus`,
    id: `!fishit beli umpan ${bait.id}`,
  }));
  await sendMenu(sock, chatId, {
    text: shopText,
    footer: '🏪 Pilih toko',
    quoted: quotedMsg,
    fallbackText: shopText,
    buttons: [
      listButton('🎣 Joran', [{ title: 'Joran', rows: rodRows }]),
      listButton('🪱 Umpan', [{ title: 'Umpan', rows: baitRows }]),
    ],
  });
  return null;
}

// ─── !f.beli ─────────────────────────────────────────────
async function cmdBeli(sock, chatId, jid, args, quotedMsg) {
  const p = getFishingPlayer(jid);
  if (!p) return `❌ Belum terdaftar di FishIt.`;
  const type   = args[0]?.toLowerCase();
  const itemId = args[1];
  const amount = parsePositiveAmount(args[2]) || 1;
  if (type === 'joran') {
    const rod = RODS.find(r => r.id === itemId);
    if (!rod) return `❌ ID joran tidak valid! Cek *!fishit shop rod*.`;
    if (getUserMoney(jid) < rod.price) return `❌ Money tidak cukup! Butuh *${formatGold(rod.price)}*.`;
    deductMoney(jid, rod.price);
    updateFishingPlayer(jid, { rod: rod.id });
    return ui.box('✅ BELI JORAN', [
      `Beli *${rod.emoji} ${rod.name}*!`,
      ui.kv('💰 Sisa', `*${formatGold(getUserMoney(jid))}*`),
    ]);
  }
  if (type === 'umpan') {
    const bait = BAITS.find(b => b.id === itemId);
    if (!bait) return `❌ ID umpan tidak valid! Cek *!fishit shop bait*.`;
    if (!hasAmount) {
      const promptText = `❓ Beli *${bait.emoji} ${bait.name}* berapa?\n\nBalas ketik *!fishit beli umpan ${bait.id} [jumlah]*.`;
      const msgId = await sendMenu(sock, chatId, {
        text: promptText,
        footer: `🪱 ${bait.name}`,
        quoted: quotedMsg,
        fallbackText: promptText,
        buttons: [quickReply(`!fishit beli umpan ${bait.id} 1`, '🛒 Beli 1')],
      });
      if (msgId) rememberBuyPrompt({ key: { id: msgId } }, jid, bait.id);
      return null;
    }
    const totalCost = bait.price * amount;
    if (getUserMoney(jid) < totalCost) return `❌ Money tidak cukup! Butuh *${formatGold(totalCost)}*.`;
    const newBaits = { ...(p.bait || {}) };
    newBaits[bait.id] = (newBaits[bait.id] || 0) + amount;
    deductMoney(jid, totalCost);
    updateFishingPlayer(jid, { bait: newBaits });
    return ui.box('✅ BELI UMPAN', [
      `Beli *${bait.emoji} ${bait.name} x${amount}*!`,
      ui.kv('💰 Sisa', `*${formatGold(getUserMoney(jid))}*`),
    ]);
  }
  return `❌ Format: *!fishit beli joran [id]* atau *!fishit beli umpan [id] [jml]*`;
}

// ─── !f.fishdex ──────────────────────────────────────────
function cmdFishdex(jid) {
  const p = getFishingPlayer(jid);
  if (!p) return `❌ Belum terdaftar di FishIt.`;
  const fishdex = p.fishdex || {};
  const lines = [
    ui.kv('📊 Koleksi', `*${Object.keys(fishdex).length}/${ALL_FISH.length}* jenis`),
    '',
  ];
  for (const [tierNum, tierInfo] of Object.entries(TIERS)) {
    const tierFish   = ALL_FISH.filter(f => f.tier === parseInt(tierNum));
    const caughtFish = tierFish.filter(f => fishdex[f.name]);
    lines.push(`${tierInfo.emoji} *${tierInfo.name}* (${caughtFish.length}/${tierFish.length})`);
    for (const fish of tierFish) {
      if (fishdex[fish.name]) {
        const d = fishdex[fish.name];
        lines.push(`  ✅ ${fish.name} — ${d.caught}x | Max: ${formatWeight(d.maxWeight)}`);
      } else {
        lines.push(`  ❓ ???`);
      }
    }
    lines.push('');
  }
  return ui.box('📖 FISHDEX', lines);
}

// ─── !f.top ───────────────────────────────────────────────
function cmdTop(sub) {
  if (sub === 'player' || !sub) {
    const tops = getTopRarity(10);
    if (!tops.length) return `❌ Belum ada pemain dengan tangkapan!`;
    const medals = ['🥇','🥈','🥉'];
    const lines = [];
    tops.forEach((p, i) => {
      const r = p.rarityRecord;
      const t = TIERS[r.tier];
      lines.push(`${medals[i] || `${i+1}.`} *${p.name}*`, `   ${t.emoji} ${r.fishName} (${t.name})`, `   ⚖️ ${formatWeight(r.weight)}`, '');
    });
    return ui.box('🏆 TOP PLAYER', lines);
  }
  return `❌ Format: *!fishit top player*`;
}

module.exports = {
  cmdMenu, cmdProfil, cmdLokasi, getLocationRows,
  cmdMancing, cmdInv, cmdJual, cmdShop, cmdBeli,
  cmdFishdex, cmdTop, sellPrompts, buyPrompts,
  activeFishing,
};
