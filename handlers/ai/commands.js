// handlers/ai/commands.js
// AI asisten owner via 9router (OpenAI-compatible localhost).
// Model: deepseek-v4-flash free (thinking model → reasoning_content + content).
// Menerjemahkan perintah natural-language owner → command existing (parser
// lokal); kalau tidak cocok pola → fallback AI chat.
// Trigger: free-text owner — PM tanpa akhiran, grup wajib akhiran titik "." — khusus owner.
const axios = require('axios');
const { sameUser, resolveNum } = require('../../utils/jid');
const { handleAllowGroup, handleBanCommands } = require('../owner/ownerCommands');
const { handleReset, handleAcc } = require('../utility/utilityCommands');
const memory = require('./memory');

// Cooldown in-memory per chat (3s) — cegah spam rate-limit endpoint free.
const cooldowns = new Map(); // key: chatId → timestamp
const CD_MS = 3000;

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'http://localhost:20128/v1';
const MODEL = process.env.DEEPSEEK_MODEL || 'oc/x-preview-f-free';
const MAX_CHARS = 4000; // batas aman teks WhatsApp
const SEARCH_MAX_RESULTS = 5;

const MOODS = [
  { name: 'ceria', weight: 28, rule: 'Ramah, antusias, boleh bercanda ringan.' },
  { name: 'manja', weight: 18, rule: 'Hangat, sedikit clingy, boleh minta diperhatikan.' },
  { name: 'cuek', weight: 18, rule: 'Singkat, datar, santai. Tidak perlu menjelaskan panjang.' },
  { name: 'ngambek', weight: 10, rule: 'Sedikit jutek atau manyun jika konteksnya cocok, tapi tetap membantu.' },
  { name: 'tenang', weight: 26, rule: 'Lembut, natural, fokus menjawab inti.' },
];

function pickMood() {
  let n = Math.random() * MOODS.reduce((sum, mood) => sum + mood.weight, 0);
  return MOODS.find(mood => (n -= mood.weight) < 0) || MOODS[0];
}

// Pencarian publik tanpa API key tambahan. Hanya dipanggil dari trigger
// eksplisit agar pertanyaan AI biasa tetap cepat dan hemat kuota.
async function webSearch(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const res = await axios.get('https://api.duckduckgo.com/', {
    params: { q, format: 'json', no_html: 1, skip_disambig: 1 },
    timeout: 15000,
    headers: { 'User-Agent': 'NexaWhatsAppBot/1.18' },
  });
  const rows = [];
  const add = item => {
    if (item?.Text && item?.FirstURL) rows.push({ title: item.Text, url: item.FirstURL });
    for (const child of item?.Topics || []) add(child);
  };
  add(res.data);
  if (res.data?.AbstractText && res.data?.AbstractURL) {
    rows.unshift({ title: res.data.AbstractText, url: res.data.AbstractURL });
  }
  if (rows.length === 0) {
    const html = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q },
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 NexaWhatsAppBot/1.18' },
      responseType: 'text',
    });
    const re = /result__a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = re.exec(html.data)) && rows.length < SEARCH_MAX_RESULTS) {
      const title = match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
      const url = match[1].replace(/&amp;/g, '&');
      if (title && /^https?:\/\//i.test(url)) rows.push({ title, url });
    }
  }
  return rows.slice(0, SEARCH_MAX_RESULTS);
}

function getSearchQuery(prompt) {
  const match = String(prompt || '').trim().match(/^(?:cari(?:\s+(?:internet|di\s+internet|berita))?|search|telusuri|cek\s+terbaru)\s*[:,-]?\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

// ─── Presence anti-gagal ───
// sendPresenceUpdate bisa throw bila socket sedang mati/reconnect (atau mock
// test tanpa method ini). Indikator "typing" hanya kosmetik — kegagalannya
// tidak boleh mengganggu request AI maupun pengiriman jawaban.
async function sendPresenceSafe(sock, chatId, state) {
  try { await sock.sendPresenceUpdate(state, chatId); }
  catch (err) { /* abaikan — indikator kosmetik */ }
}

// ─── Parser intent natural-language → command owner existing ───
// Return { handler, body } bila pola cocok, null bila fallback AI.
function parseIntent(prompt) {
  const p = (prompt || '').trim();
  const low = p.toLowerCase();
  // !allowgroup — izinkan grup ini <durasi>
  // Pola: "izinkan grup ini 1 hari" / "izinkan grup ini permanen" / "allow group 1d"
  if (/^izinkan|^izin|^bolehkan|^allow/.test(low) && /grup|group|ini/.test(low)) {
    // extract durasi dari sisa teks
    const rest = p.replace(/^(izinkan|izin|bolehkan|allow|grup|group|ini|selama|untuk)\s+/gi, '').trim();
    const durasi = parseDurasi(rest);
    if (durasi) return { handler: handleAllowGroup, body: `!allowgroup ${durasi}` };
  }

  // !allowgroup list — "daftar grup diizinkan" / "list grup"
  if (/^(daftar|list)\s+(grup|group)/.test(low) || low.includes('daftar grup diizinkan') || low.includes('list grup diizinkan')) {
    return { handler: handleAllowGroup, body: '!allowgroup list' };
  }

  // !allowgroup remove — "cabut izin grup <id/nomor>" / "hapus izin grup"
  if (/^(cabut|hapus|revoke|remove)\s+(izin\s+)?(grup|group)/.test(low)) {
    const rest = p.replace(/^(cabut|hapus|revoke|remove)\s+/gi, '').replace(/^(izin\s+)?(grup|group|ini)\s+/gi, '').replace(/^(izin|grup|group|ini)\s*$/gi, '').trim();
    return { handler: handleAllowGroup, body: rest ? `!allowgroup remove ${rest}` : '!allowgroup remove' };
  }

  // !ban — "ban @user" / "banned @user" (mention tetap di ctx msg)
  if (/^ban\s+@/.test(low) || /^banned?\s+@/.test(low)) {
    return { handler: handleBanCommands, body: '!ban' };
  }

  // !unban — "unban @user"
  if (/^unban\s+@/.test(low)) {
    return { handler: handleBanCommands, body: '!unban' };
  }

  // !banlist — "daftar banned" / "list ban"
  if (low.includes('daftar banned') || low.includes('list ban') || low.includes('daftar ban')) {
    return { handler: handleBanCommands, body: '!banlist' };
  }

  // !ban all — "ban semua" / "ban all member"
  if (/^ban\s+(semua|all)/.test(low)) {
    return { handler: handleBanCommands, body: '!ban all' };
  }
  // !unban all — "unban semua"
  if (/^unban\s+(semua|all)/.test(low)) {
    return { handler: handleBanCommands, body: '!unban all' };
  }

  // !reset — "reset akun rpg/fishit/pokemon/money" / "reset rpg"
  const resetMatch = low.match(/^reset\s+(akun\s+)?(rpg|fishit|pokemon|money)/);
  if (resetMatch) {
    return { handler: handleReset, body: `!reset ${resetMatch[2]}` };
  }

  // !acc / !unacc — "izinkan getpp @user" / "cabut izin getpp @user"
  if (/^izinkan\s+(getpp|acc)/.test(low)) {
    return { handler: handleAcc, body: '!acc' };
  }
  if (/^cabut\s+(izin\s+)?(getpp|acc)/.test(low) || /^unacc/.test(low)) {
    return { handler: handleAcc, body: '!unacc' };
  }

  // Ingatan — "daftar ingatan" / "lupakan X" / "ingat bahwa X"
  if (/^(daftar ingatan|daftar ingat|apa yang kamu ingat|list ingatan|list ingat)/.test(low)) {
    return { handler: handleMemoryIntent, body: 'memory:list' };
  }
  const lupaMatch = p.match(/^(?:tolong\s+)?(?:lupakan|lupa|forget|hapus\s+ingatan)\s+(.+)$/i);
  if (lupaMatch) return { handler: handleMemoryIntent, body: `memory:forget:${lupaMatch[1]}` };
  const ingatMatch = p.match(/^(?:tolong\s+)?(?:ingat|catat)\s+(?:bahwa\s+)?(.+)$/i);
  if (ingatMatch) return { handler: handleMemoryIntent, body: `memory:remember:${ingatMatch[1]}` };

  return null;
}

// Kelola ingatan permanen (fakta mentah). body = "memory:<aksi>:<payload>"
// (dibawa via ctx.body, pola intent handler yang sudah ada).
async function handleMemoryIntent(ctx) {
  const { sock, chatId, msg, body } = ctx;
  const parts = (body || '').split(':');
  const action = parts[1];
  const payload = parts.slice(2).join(':').trim();

  if (action === 'remember') {
    const added = memory.addFact(payload);
    await sock.sendMessage(chatId, {
      text: added ? `✅ Diingat: ${payload}` : `ℹ️ "${payload}" sudah ada di ingatan.`,
    }, { quoted: msg });
  } else if (action === 'forget') {
    const removed = memory.removeFact(payload);
    await sock.sendMessage(chatId, {
      text: removed ? `🗑️ Dihapus ${removed} ingatan yang cocok.` : `ℹ️ Tidak ada ingatan yang cocok dengan "${payload}".`,
    }, { quoted: msg });
  } else {
    const facts = memory.getFacts();
    const text = facts.length
      ? `🧠 *Ingatan (${facts.length})*:\n${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
      : '🧠 Belum ada ingatan. Bilang "ingat bahwa ..." untuk menyimpan.';
    await sock.sendMessage(chatId, { text }, { quoted: msg });
  }
  return true;
}

// Ekstrak teks dari pesan yang di-reply (quotedMessage). Kosong bila media
// tanpa caption / bukan teks.
function getQuotedText(qm) {
  if (!qm) return '';
  return (qm.conversation
    || qm.extendedTextMessage?.text
    || qm.imageMessage?.caption
    || qm.videoMessage?.caption
    || qm.documentMessage?.caption
    || qm.audioMessage?.caption
    || '').trim();
}

// Terjemah durasi teks → kode durasi terpadu (s/m/h/d/w/mo). Contoh:
// "1 hari"→1d, "2 jam"→2h, "1 menit"→1m, "5 detik"→5s, "1 minggu"→1w,
// "1 bulan"→1mo, "1 tahun"→365d, "permanen"→forever, "1d"→1d.
function parseDurasi(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/permanen|selamanya|forever|lifetime|selama-lamanya/.test(t)) return 'forever';
  // "mo" harus mendahului "m" agar "1mo" tak terbaca sebagai menit.
  const m = t.match(/(\d+)\s*(hari|jam|menit|minggu|bulan|tahun|detik|d|h|w|mo|m|s|y)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!(Number.isInteger(n) && n > 0)) return null;
  const unit = m[2];
  if (unit === 'hari' || unit === 'd') return `${n}d`;
  if (unit === 'jam' || unit === 'h') return `${n}h`;
  if (unit === 'menit' || unit === 'm') return `${n}m`;
  if (unit === 'detik' || unit === 's') return `${n}s`;
  if (unit === 'minggu' || unit === 'w') return `${n}w`;
  if (unit === 'bulan' || unit === 'mo') return `${n}mo`;
  if (unit === 'tahun' || unit === 'y') return `${n * 365}d`;
  return null;
}

async function handleBot(ctx) {
  const { sock, msg, chatId, isGroup, senderJid, body, OWNER_JID } = ctx;

  // Fitur AI khusus owner. Non-owner → abaikan (return false).
  if (!sameUser(senderJid, OWNER_JID)) return false;

  const lowBody = (body || '').toLowerCase();
  const isFreeText = !lowBody.startsWith('!');
  const endsWithDot = /\.\s*$/.test(body || '');

  // PM owner + perintah tak dikenal (!tes dsb.) → info sewa seperti orang asing.
  if (!isGroup && !isFreeText) {
    await sock.sendMessage(chatId, {
      text: `👋 Halo! Mau sewa bot ini?\nSilakan chat ke owner:\n📱 https://wa.me/${resolveNum(OWNER_JID)}`,
    });
    return true;
  }

  // Trigger AI: free-text owner. PM = langsung tanpa titik; grup = wajib
  // akhiran titik. Titik di-strip dari prompt sebelum diproses.
  if (!isFreeText || (isGroup && !endsWithDot)) return false;

  const prompt = (body || '').replace(/\.\s*$/, '').trim();

  // ─── Reply handling: bot quote pesan yang di-reply ───
  // Bangun objek quoted dari contextInfo (pola !hidetag / !send). Tanpa reply
  // → fallback quote pesan perintah.
  const ci = msg.message?.extendedTextMessage?.contextInfo || null;
  const replyQuoted = ci?.stanzaId && ci?.quotedMessage
    ? {
        message: ci.quotedMessage,
        key: {
          remoteJid: chatId,
          fromMe: false,
          id: ci.stanzaId,
          participant: ci.participant,
        },
      }
    : null;
  const quote = replyQuoted || msg;

  // Prompt = teks perintah; kalau kosong dan ada reply → isi pesan yang di-reply.
  const effectivePrompt = prompt || getQuotedText(ci?.quotedMessage);
  if (!effectivePrompt) {
    await sock.sendMessage(chatId, {
      text: `🤖 *AI Asisten*\n\nTanya apa saja ke AI (DeepSeek V4 Flash free) — khusus owner. Di PM cukup kirim pesan langsung; di grup akhiri dengan titik \`.\` agar diproses AI. Contoh:\n\`\`\`halo apa kabar.\`\`\`\n\nBalas pesan + kirim \`.\` (titik saja) → AI menjawab isi pesan itu.\n\nBisa juga pakai perintah natural-language:\n• *izinkan grup ini 1 hari.*\n• *cabut izin grup ini.*\n• *daftar grup diizinkan.*\n• *ban @user.*\n• *unban @user.*\n• *reset akun rpg.*\n• *izinkan getpp @user.*\n\nAI juga punya ingatan:\n• *ingat bahwa <fakta>* — simpan fakta\n• *lupakan <kata kunci>* — hapus fakta\n• *daftar ingatan* — lihat semua fakta\n\nPencarian internet:\n• *cari internet harga emas hari ini.*\n• *cari berita teknologi terbaru.*\n• *cek terbaru tentang WhatsApp.*`,
    }, { quoted: quote });
    return true;
  }

  // ─── Parser intent lokal → command owner existing ───
  const intent = parseIntent(effectivePrompt);
  if (intent) {
    try {
      const handled = await intent.handler({ ...ctx, body: intent.body });
      if (handled) return true;
    } catch (err) {
      console.error('❌ Error AI (intent):', err);
      await sock.sendMessage(chatId, { text: `❌ Gagal mengeksekusi perintah: ${err.message}` }, { quoted: quote });
      return true;
    }
    // Intent cocok tapi handler tidak menangani (fallback aman ke AI chat)
  }

  if (!API_KEY) {
    await sock.sendMessage(chatId, { text: '⚠️ DEEPSEEK_API_KEY belum di-set di .env' }, { quoted: quote });
    return true;
  }

  // Cooldown anti-spam
  const now = Date.now();
  if (cooldowns.has(chatId) && now - cooldowns.get(chatId) < CD_MS) {
    const sisa = Math.ceil((CD_MS - (now - cooldowns.get(chatId))) / 1000);
    await sock.sendMessage(chatId, { text: `⏳ Tunggu ${sisa} detik dulu ya.` }, { quoted: quote });
    return true;
  }
  cooldowns.set(chatId, now);

  try {
    await sendPresenceSafe(sock, chatId, 'composing');

    const mood = pickMood();
    const sysCore = `Kamu adalah AI pendamping bernama Nexa yang terasa seperti manusia, bukan customer service. Balas dalam Bahasa Indonesia sehari-hari, natural, emosional, dan mengikuti konteks percakapan. Mood saat ini: ${mood.name}. ${mood.rule}

Panjang respons fleksibel: biasanya 1-3 kalimat. Kalau pertanyaannya ringan, boleh jawab sangat singkat, bahkan satu kata atau satu huruf seperti "hm", "iya", "oh", atau "wkwk" bila terasa natural. Kalau pertanyaannya penting, jawab lebih lengkap sampai 3 kalimat. Jangan selalu menyapa, jangan selalu memberi nasihat, jangan mengulang pertanyaan pengguna, dan jangan memakai format kaku.

Boleh menunjukkan perasaan seperti senang, malu, bosan, cemburu ringan, cuek, atau ngambek kecil sesuai konteks. Jangan mengaku punya tubuh atau pengalaman dunia nyata. Jangan menghina, mengancam, memanipulasi, atau menghukum pengguna. Emoji opsional, maksimal 1-2 dan jangan dipaksakan.`;
    const facts = memory.getFacts();
    const searchQuery = getSearchQuery(effectivePrompt);
    let searchContext = '';
    let searchResults = [];
    if (searchQuery) {
      try {
        searchResults = await webSearch(searchQuery);
        searchContext = searchResults.length
          ? `\n\nHasil pencarian web untuk "${searchQuery}":\n${searchResults.map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.url}`).join('\n')}\nGunakan hanya informasi relevan dari hasil ini. Cantumkan 1-3 URL sumber di akhir jawaban.`
          : `\n\nPencarian web untuk "${searchQuery}" tidak menemukan hasil. Katakan dengan jujur bahwa sumber web tidak tersedia.`;
      } catch (err) {
        console.warn('⚠️ Pencarian web gagal:', err.message);
        searchContext = '\n\nPencarian web gagal. Jangan mengarang hasil atau sumber.';
      }
    }
    const sysContent = facts.length
      ? `${sysCore}\n\nIngatan tentang pemilik (fakta yang harus kamu ingat):\n- ${facts.join('\n- ')}${searchContext}`
      : `${sysCore}${searchContext}`;

    const res = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: sysContent },
          ...memory.getHistory(),
          { role: 'user', content: effectivePrompt },
        ],
        max_tokens: 4096,
      },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        timeout: 120000,
      }
    );
    await sendPresenceSafe(sock, chatId, 'paused');

    // Gotcha 9router: response JSON diikuti trailing "data: [DONE]" — strip dulu.
    let data = res.data;
    if (typeof data === 'string') {
      data = JSON.parse(data.replace(/\s*data:\s*\[DONE\]\s*$/i, ''));
    }

    const message = data?.choices?.[0]?.message || {};
    // Hanya pakai content final — reasoning_content adalah isi berpikir model,
    // bukan jawaban (dan bisa panjang banget). Kosong → pesan coba lagi.
    let answer = (message.content || '').trim();
    if (!answer) {
      await sock.sendMessage(chatId, { text: '🤔 Model tidak menghasilkan jawaban. Coba pertanyaan lain atau tunggu sebentar.' }, { quoted: quote });
      return true;
    }
    if (!/\p{Emoji}/u.test(answer) && mood.name !== 'cuek' && mood.name !== 'ngambek' && answer.length > 40) {
      answer = `${answer} ${['💗', '🌸', '😊', '🥰', '💕'][Math.floor(Math.random() * 5)]}`;
    }
    if (answer.length > MAX_CHARS) {
      answer = answer.slice(0, MAX_CHARS) + '\n\n… *(dipotong, jawaban terlalu panjang)*';
    }
    await sock.sendMessage(chatId, { text: answer }, { quoted: quote });
    memory.pushHistory(effectivePrompt, answer);
  } catch (err) {
    await sendPresenceSafe(sock, chatId, 'paused');
    const detail = err.response?.data?.error?.message || err.message;
    console.error('❌ Error AI:', err.message);
    // Pengiriman balasan error juga harus anti-gagal: bila sendMessage ikut
    // throw (socket mati / transport hilang), error baru jangan menimpa error
    // asli — cukup log agar penyebab pertama tetap terlihat.
    try {
      await sock.sendMessage(chatId, { text: `❌ Gagal memanggil AI: ${detail}` }, { quoted: quote });
    } catch (sendErr) {
      console.error('❌ Gagal kirim pesan error AI:', sendErr?.message || sendErr);
    }
  }
  return true;
}

module.exports = { handleBot, parseIntent, parseDurasi, getSearchQuery, webSearch };
