// handlers/owner/ownerCommands.js
// Perintah owner & admin grup: !ban / !unban / !banlist, !allowgroup, !del, !hidetag, !sw
// - Owner (OWNER_JID) = semua perintah + ban global.
// - Admin grup WA = !ban/!unban/!banlist lokal per grup + !del + !hidetag + !sw.
const { banUser, unbanUser, getBannedList, banUserInGroup, unbanUserInGroup, getGroupBannedList } = require('../../data/db');
const { getAllowedGroups, saveAllowedGroups } = require('../../utils/groupAccess');
const { sameUser, resolveMentionedJids, getNumber, isGroupAdmin } = require('../../utils/jid');
const { setPmMode } = require('../../utils/pmMode');
const { parsePositiveAmount } = require('../../utils/amount');
const { parseDuration } = require('../../utils/duration');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

// ─── !ban / !unban / !banlist — Owner global, admin grup lokal ────
async function handleBanCommands(ctx) {
  const { sock, msg, chatId, isGroup, groupId, senderJid, body, OWNER_JID, BOT_JID } = ctx;

  const lowBody = body.toLowerCase();
  const isBanCmd =
    lowBody === '!ban' ||
    lowBody === '!ban all' ||
    lowBody.startsWith('!ban ') ||
    lowBody === '!unban' ||
    lowBody === '!unban all' ||
    lowBody.startsWith('!unban ') ||
    lowBody === '!banlist';

  if (isBanCmd) {
    const isOwner = sameUser(senderJid, OWNER_JID);
    // Cek admin grup hanya jika bukan owner (fetch metadata sekali).
    const isGrpAdmin = isOwner ? false : await isGroupAdmin(sock, chatId, senderJid);

    if (!isOwner && !isGrpAdmin) {
      await sock.sendMessage(chatId, {
        text: `🚫 Perintah ini hanya untuk owner bot atau admin grup!`,
      }, { quoted: msg });
      return true;
    }

    // ── MASS BAN GLOBAL (!ban all) — owner saja ──
    if (body.toLowerCase() === '!ban all') {
      if (!isOwner) {
        await sock.sendMessage(chatId, { text: `🚫 *!ban all* hanya untuk owner bot!` }, { quoted: msg });
        return true;
      }
      if (!isGroup) {
        await sock.sendMessage(chatId, { text: `⚠️ Fitur *!ban all* hanya bisa digunakan di dalam grup!` }, { quoted: msg });
        return true;
      }

      try {
        await sock.sendMessage(chatId, { text: `⏳ Sedang mengumpulkan data member grup dan memproses mass-ban...` }, { quoted: msg });

        // Ambil metadata grup untuk melihat semua member
        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants;

        let bannedCount = 0;
        for (const member of participants) {
          const memberJid = member.id;

          // HANYA MENGECEK: Jangan ban Owner ID dan Bot ID yang ada di env
          if (!sameUser(memberJid, OWNER_JID) && !sameUser(memberJid, BOT_JID)) {
            banUser(memberJid, senderJid);
            bannedCount++;
          }
        }

        await sock.sendMessage(chatId, {
          text: `🚫 *MASS BAN BERHASIL!* 🚫\n\nSebanyak *${bannedCount} member* di grup ini telah dibanned dari sistem`
        }, { quoted: msg });

      } catch (err) {
        console.error('❌ Error !ban all:', err);
        await sock.sendMessage(chatId, { text: `❌ Gagal mengeksekusi mass ban: ${err.message}` }, { quoted: msg });
      }
      return true;
    }

    // ── MASS UNBAN GLOBAL (!unban all) — owner saja ──
    if (body.toLowerCase() === '!unban all') {
      if (!isOwner) {
        await sock.sendMessage(chatId, { text: `🚫 *!unban all* hanya untuk owner bot!` }, { quoted: msg });
        return true;
      }
      const banned = getBannedList();
      const list   = Object.keys(banned);

      if (list.length === 0) {
        await sock.sendMessage(chatId, { text: `✅ Tidak ada user di dalam daftar banned.` }, { quoted: msg });
        return true;
      }

      let unbannedCount = 0;
      for (const jid of list) {
        unbanUser(jid);
        unbannedCount++;
      }

      await sock.sendMessage(chatId, {
        text: `✅ *MASS UNBAN BERHASIL!* \n\nBerhasil membuka blokir untuk *${unbannedCount} user* dari database database global bot.`
      }, { quoted: msg });
      return true;
    }

    // ── BANLIST — owner: global; admin grup: lokal grupnya ──
    if (body.toLowerCase() === '!banlist') {
      if (isOwner) {
        const banned = getBannedList();
        const list   = Object.keys(banned);
        if (list.length === 0) {
          await sock.sendMessage(chatId, { text: `✅ Tidak ada user yang dibanned.` }, { quoted: msg });
        } else {
          const lines = list.map((jid, i) => {
            const info = banned[jid];
            const tgl  = new Date(info.bannedAt).toLocaleString('id-ID');
            return `${i + 1}. @${getNumber(jid)} — ${tgl}`;
          });
          await sock.sendMessage(chatId, {
            text: `🚫 *DAFTAR USER BANNED* (${list.length})\n\n${lines.join('\n')}`,
            mentions: list,
          }, { quoted: msg });
        }
        return true;
      }

      // Admin grup → daftar ban lokal di grup ini
      if (!isGroup) {
        await sock.sendMessage(chatId, { text: `⚠️ *!banlist* admin grup hanya bisa digunakan di dalam grup!` }, { quoted: msg });
        return true;
      }
      const local = getGroupBannedList(groupId);
      const list  = Object.keys(local);
      if (list.length === 0) {
        await sock.sendMessage(chatId, { text: `✅ Tidak ada user yang dibanned di grup ini.` }, { quoted: msg });
      } else {
        const lines = list.map((jid, i) => {
          const info = local[jid];
          const tgl  = new Date(info.bannedAt).toLocaleString('id-ID');
          return `${i + 1}. @${getNumber(jid)} — ${tgl}`;
        });
        await sock.sendMessage(chatId, {
          text: `🚫 *DAFTAR BAN LOKAL GRUP* (${list.length})\n\n${lines.join('\n')}`,
          mentions: list,
        }, { quoted: msg });
      }
      return true;
    }

    // ── BAN / UNBAN REGULER BY TAG ──
    const mentionedJid = (await resolveMentionedJids(msg, body, sock, chatId))[0] || null;

    if (!mentionedJid) {
      await sock.sendMessage(chatId, {
        text: `⚠️ Tag user dulu!\nContoh:\n• *!ban @nama*\n• *!ban @nama 10s* (10 detik) / *5m* (5 menit) / *2h* (2 jam) / *1d* (1 hari) / *1w* (1 minggu) / *1mo* (1 bulan)\n• *!unban @nama*\n• *!ban all* (Ban semua member grup, owner)\n• *!unban all* (Unban semua user global, owner)\n\n💡 Admin grup: ban/unban hanya berlaku di grup ini.`,
      }, { quoted: msg });
      return true;
    }

    if (sameUser(mentionedJid, OWNER_JID)) {
      await sock.sendMessage(chatId, { text: `❌ Tidak bisa ban/unban owner!` }, { quoted: msg });
      return true;
    }

    // Admin grup: batasi target ke member biasa di grupnya sendiri
    if (isGrpAdmin) {
      if (!isGroup) {
        await sock.sendMessage(chatId, { text: `⚠️ Admin grup hanya bisa ban/unban di dalam grupnya!` }, { quoted: msg });
        return true;
      }
      if (sameUser(mentionedJid, BOT_JID)) {
        await sock.sendMessage(chatId, { text: `❌ Tidak bisa ban/unban bot!` }, { quoted: msg });
        return true;
      }
      // Target tidak boleh admin grup lain / member di luar grup / sesama admin
      const meta = await sock.groupMetadata(chatId);
      const participants = meta?.participants || [];
      const target = participants.find(p => sameUser(p.id, mentionedJid));
      if (!target) {
        await sock.sendMessage(chatId, { text: `❌ User yang ditag bukan member grup ini!` }, { quoted: msg });
        return true;
      }
      if (target.admin === 'admin' || target.admin === 'superadmin') {
        await sock.sendMessage(chatId, { text: `❌ Tidak bisa ban/unban admin grup lain!` }, { quoted: msg });
        return true;
      }

      if (body.startsWith('!unban')) {
        const ok = unbanUserInGroup(groupId, mentionedJid);
        await sock.sendMessage(chatId, {
          text: ok
            ? `✅ @${getNumber(mentionedJid)} di-unban dari grup ini.`
            : `❌ @${getNumber(mentionedJid)} tidak ada di daftar ban grup ini.`,
          mentions: [mentionedJid],
        }, { quoted: msg });
      } else {
        const dur = parseDuration(body);
        banUserInGroup(groupId, mentionedJid, senderJid, dur ? Date.now() + dur.ms : undefined);
        await sock.sendMessage(chatId, {
          text: dur
            ? `🚫 @${getNumber(mentionedJid)} dibanned dari grup ini selama *${dur.label}*!`
            : `🚫 @${getNumber(mentionedJid)} dibanned dari grup ini!`,
          mentions: [mentionedJid],
        }, { quoted: msg });
      }
      return true;
    }

    // Owner: ban/unban global
    if (body.startsWith('!unban')) {
      const ok = unbanUser(mentionedJid);
      await sock.sendMessage(chatId, {
        text: ok
          ? `✅ @${getNumber(mentionedJid)} berhasil di-unban.`
          : `❌ @${getNumber(mentionedJid)} tidak ada di daftar banned.`,
        mentions: [mentionedJid],
      }, { quoted: msg });
    } else {
      const dur = parseDuration(body);
      banUser(mentionedJid, senderJid, dur ? Date.now() + dur.ms : undefined);
      await sock.sendMessage(chatId, {
        text: dur
          ? `🚫 @${getNumber(mentionedJid)} berhasil dibanned selama *${dur.label}*!`
          : `🚫 @${getNumber(mentionedJid)} berhasil dibanned!`,
        mentions: [mentionedJid],
      }, { quoted: msg });
    }
    return true;
  }

  return false;
}

// ─── PERINTAH OWNER: KELOLA IZIN GRUP (!allowgroup) ───
async function handleAllowGroup(ctx) {
  const { sock, msg, chatId, isGroup, groupId, senderJid, body, OWNER_JID } = ctx;

  if (body.toLowerCase().startsWith('!allowgroup')) {
    if (!sameUser(senderJid, OWNER_JID)) {
      await sock.sendMessage(chatId, { text: `🚫 Perintah ini hanya untuk owner bot!` }, { quoted: msg });
      return true;
    }

    const args = body.trim().split(/ +/).slice(1);
    const option = args[0]?.toLowerCase();

    // Pilihan durasi dalam milidetik
    const durationMap = {
      '1m': { ms: 1 * 60 * 1000, label: '1 Menit' },
      '1w': { ms: 7 * 24 * 60 * 60 * 1000, label: '1 Minggu' },
      '14d': { ms: 14 * 24 * 60 * 60 * 1000, label: '14 Hari' },
      '28d': { ms: 28 * 24 * 60 * 60 * 1000, label: '28 Hari' },
      '1mo': { ms: 30 * 24 * 60 * 60 * 1000, label: '1 Bulan' },
      'forever':   { ms: null, label: 'Selamanya (Permanen)' },
      'permanen':  { ms: null, label: 'Selamanya (Permanen)' },
      'selamanya': { ms: null, label: 'Selamanya (Permanen)' },
      'lifetime':  { ms: null, label: 'Selamanya (Permanen)' }
    };

    // Durasi bebas: "<angka><unit>" — s/m/h/d/w/mo (detik/menit/jam/hari/minggu/bulan).
    // Contoh: 30s, 2h, 1d, 1w, 1mo. Satu-satunya parser = utils/duration.js
    // (parseDuration), sama seperti yang dipakai di !ban.
    const resolveFlexDuration = (raw) => parseDuration(raw);

    // Helper: normalisasi id grup (terima "1234" atau "1234@g.us")
    const normalizeGroupId = (raw) => {
      const id = raw.trim();
      return id.endsWith('@g.us') ? id : `${id}@g.us`;
    };

    // Helper: format sisa waktu dalam bentuk teks
    const formatRemaining = (ms) => {
      if (ms <= 0) return 'sudah kedaluwarsa';
      const days = Math.floor(ms / (24 * 60 * 60 * 1000));
      const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
      if (days > 0) return `${days} hari ${hours} jam`;
      if (hours > 0) return `${hours} jam ${minutes} menit`;
      return `${minutes} menit`;
    };

    // ─── SUBPERINTAH: LIST — tampilkan semua grup yang diizinkan ───
    if (option === 'list' || option === 'daftar') {
      const allowedGroups = getAllowedGroups();
      const ids = Object.keys(allowedGroups);
      const now = Date.now();
      let changed = false;

      if (ids.length === 0) {
        await sock.sendMessage(chatId, { text: `📭 Belum ada grup yang diizinkan.\n\n💡 Ketik *!allowgroup* di dalam grup untuk melihat panduan.` }, { quoted: msg });
        return true;
      }

      const lines = [`📋 *Daftar Grup yang Diizinkan*`, `Total: *${ids.length}* grup`, ``];
      const mentionJids = [];
      let index = 1;

      for (const id of ids) {
        const g = allowedGroups[id];
        let name = id;
        try {
          const meta = await sock.groupMetadata(id);
          if (meta && meta.subject) name = meta.subject;
        } catch (e) { /* bot tidak lagi di grup → pakai JID */ }

        const expired = g.permanent ? false : (now > g.expiredAt);
        const status = g.permanent
          ? '♾️ *PERMANEN*'
          : expired
            ? '⚠️ *KEDALUWARSA*'
            : `✅ Sisa: *${formatRemaining(g.expiredAt - now)}*`;
        const addedDate = new Date(g.addedAt).toLocaleString('id-ID');
        const expDate = g.permanent
          ? 'Permanen'
          : new Date(g.expiredAt).toLocaleString('id-ID');
        const addedBy = g.addedBy ? `\n   👤 Ditambahkan oleh: @${getNumber(g.addedBy)}` : '';
        if (g.addedBy && !mentionJids.includes(g.addedBy)) mentionJids.push(g.addedBy);

        lines.push(
          `${index}. ${name}`,
          `   📎 ID: \`${id}\``,
          `   ${status}`,
          `   📅 Ditambah: ${addedDate} | Berakhir: ${expDate}${addedBy}`
        );
        index++;

        // Bersihkan grup yang sudah kedaluwarsa dari file
        if (expired) {
          delete allowedGroups[id];
          changed = true;
        }
      }

      if (changed) {
        saveAllowedGroups(allowedGroups);
      }

      lines.push(
        ``,
        `💡 Hapus izin: *!allowgroup remove <nomor_atau_id>*`
      );
      await sock.sendMessage(chatId, { text: lines.join('\n'), mentions: mentionJids }, { quoted: msg });
      return true;
    }

    // ─── SUBPERINTAH: REMOVE — hapus izin grup tertentu (nomor urut atau ID) ───
    if (option === 'remove' || option === 'hapus' || option === 'unallow') {
      if (!args[1]) {
        await sock.sendMessage(chatId, {
          text: `⚠️ *Format Salah!*\n\nGunakan: *!allowgroup remove <nomor_atau_id>*\nContoh:\n• *!allowgroup remove 1*  (nomor urut dari list)\n• *!allowgroup remove 1203xxxxxxxx@g.us*  (ID grup)\n\n💡 Lihat nomor & id grup dari *!allowgroup list*.`
        }, { quoted: msg });
        return true;
      }

      const raw = args[1].trim();
      const allowedGroups = getAllowedGroups();
      const ids = Object.keys(allowedGroups);
      let targetId = null;

      // Jika berupa angka pendek → interpretasikan sebagai nomor urut dari list
      const asIndex = parsePositiveAmount(raw);
      if (asIndex !== null) {
        const idx = asIndex - 1;
        if (idx >= 0 && idx < ids.length) {
          targetId = ids[idx];
        } else {
          await sock.sendMessage(chatId, {
            text: `❌ Nomor urut *${asIndex}* tidak ada di daftar. Gunakan *!allowgroup list* untuk melihat nomor yang valid.`
          }, { quoted: msg });
          return true;
        }
      } else {
        // Selain itu → perlakukan sebagai ID/JID grup
        targetId = normalizeGroupId(raw);
      }

      if (!allowedGroups[targetId]) {
        await sock.sendMessage(chatId, { text: `❌ Grup \`${targetId}\` tidak ada di daftar izin. Cek dengan *!allowgroup list*.` }, { quoted: msg });
        return true;
      }

      delete allowedGroups[targetId];
      saveAllowedGroups(allowedGroups);
      await sock.sendMessage(chatId, { text: `🗑️ Izin grup \`${targetId}\` telah *dihapus*.\n\nHanya grup tersebut yang dicabut izinnya, grup lain tidak terpengaruh.` }, { quoted: msg });
      return true;
    }

    // ─── IZINKAN GRUP DI TEMPAT INI (wajib di dalam grup) ───
    if (!isGroup) {
      await sock.sendMessage(chatId, { text: `⚠️ Perintah ini hanya bisa digunakan di dalam grup yang ingin diizinkan!\n\n💡 Untuk melihat daftar izin gunakan *!allowgroup list*, untuk mencabut izin gunakan *!allowgroup remove <id_grup>*.` }, { quoted: msg });
      return true;
    }

    // Jika parameter tidak diisi atau salah, tampilkan panduan
    const selected = durationMap[option] || resolveFlexDuration(option);
    if (!option || !selected) {
      await sock.sendMessage(chatId, {
        text: [
          `⚠️ *Format Perintah Salah!*`,
          ``,
          `📌 *Sub-perintah:*`,
          `• *!allowgroup list* — Lihat semua grup yang diizinkan`,
          `• *!allowgroup remove <nomor/id>* — Hapus izin grup tertentu (nomor urut dari list atau id grup)`,
          ``,
          `📌 *Variasi durasi (di dalam grup):*`,
          `• *!allowgroup 1m* — Aktif selama 1 Menit`,
          `• *!allowgroup 1w* — Aktif selama 1 Minggu`,
          `• *!allowgroup 14d* — Aktif selama 14 Hari`,
          `• *!allowgroup 28d* — Aktif selama 28 Hari`,
          `• *!allowgroup 1mo* — Aktif selama 1 Bulan`,
          `• *!allowgroup forever* / *permanen* — Aktif selamanya`,
          `• *!allowgroup <angka><satuan>* — Durasi bebas: 30s, 5m, 2h, 1d, 1w, 1mo (detik/menit/jam/hari/minggu/bulan)`,
          ``,
          `⚠️ Izin hanya diberikan ke grup tempat perintah ini diketik, grup lain tidak terpengaruh.`
        ].join('\n')
      }, { quoted: msg });
      return true;
    }
    const allowedGroups = getAllowedGroups();
    const isPermanent = selected.ms === null;

    // Hanya tulis kunci grup ini, grup lain tidak tersentuh
    if (isPermanent) {
      allowedGroups[groupId] = {
        addedAt: Date.now(),
        permanent: true,
        addedBy: senderJid
      };
    } else {
      const expiredAt = Date.now() + selected.ms;
      allowedGroups[groupId] = {
        addedAt: Date.now(),
        expiredAt: expiredAt,
        addedBy: senderJid
      };
    }

    saveAllowedGroups(allowedGroups);

    const successText = isPermanent
      ? `✅ *Grup Ini Diizinkan!*\n\nBot akan aktif di grup ini *PERMANEN (selamanya)*.\n\n⚠️ Izin ini hanya berlaku untuk grup ini, grup lain tidak terpengaruh.`
      : `✅ *Grup Ini Diizinkan!*\n\nBot akan aktif di grup ini selama *${selected.label}*.\n📅 Berakhir pada: *${new Date(Date.now() + selected.ms).toLocaleString('id-ID')}*\n\n⚠️ Izin ini hanya berlaku untuk grup ini, grup lain tidak terpengaruh.`;

    await sock.sendMessage(chatId, {
      text: successText
    }, { quoted: msg });
    return true;
  }

  return false;
}

// ─── 5d. HIDETAG — Tag Semua Member (Owner & Admin Grup) ───
async function handleHidetag(ctx) {
  const { sock, msg, chatId, isGroup, senderJid, body, OWNER_JID, BOT_JID } = ctx;

  const lowBody = body.toLowerCase();
  if (lowBody !== '!hidetag' && !lowBody.startsWith('!hidetag ')) {
    return false;
  }

  if (!sameUser(senderJid, OWNER_JID) && !await isGroupAdmin(sock, chatId, senderJid)) {
    await sock.sendMessage(chatId, { text: '🚫 Perintah ini hanya untuk owner bot atau admin grup!' }, { quoted: msg });
    return true;
  }

  if (!isGroup) {
    await sock.sendMessage(chatId, { text: '⚠️ Perintah *!hidetag* hanya bisa digunakan di dalam grup!' }, { quoted: msg });
    return true;
  }

  try {
    const meta = await sock.groupMetadata(chatId);
    const all = (meta.participants || []).map(p => p.id).filter(j => !sameUser(j, BOT_JID));

    const arg = body.slice('!hidetag'.length).trim();
    const ci = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ci?.stanzaId && ci?.quotedMessage
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
    const text = arg || '📢 Tag Semua Member';

    await sock.sendMessage(
      chatId,
      { text, mentions: all },
      quoted ? { quoted } : {}
    );
  } catch (err) {
    console.error('❌ Error !hidetag:', err);
    await sock.sendMessage(chatId, { text: `❌ Gagal mengeksekusi !hidetag: ${err.message}` }, { quoted: msg });
  }
  return true;
}

// ─── 5e. DELETE — Hapus Pesan (Owner & Admin Grup) ───
async function handleDelete(ctx) {
  const { sock, msg, chatId, senderJid, body, OWNER_JID, BOT_JID } = ctx;

  if (body.toLowerCase() === '!del' || body.toLowerCase() === '!delete') {
    if (!sameUser(senderJid, OWNER_JID) && !await isGroupAdmin(sock, chatId, senderJid)) {
      await sock.sendMessage(chatId, { text: '🚫 Perintah ini hanya untuk owner bot atau admin grup!' }, { quoted: msg });
      return true;
    }

    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (!contextInfo || !contextInfo.stanzaId) {
      await sock.sendMessage(chatId, { text: '🗂️ Balas/reply pesan bot yang ingin dihapus dengan perintah !del' }, { quoted: msg });
      return true;
    }

    const quotedParticipant = contextInfo.participant || null;

    // 1) Hapus pesan yang di-reply.
    //    Pesan bot (participant kosong / cocok BOT_JID) → fromMe:true → selalu berhasil.
    //    Pesan member (participant ada & ≠ bot) → fromMe:false → hanya berhasil bila bot admin grup.
    try {
      await sock.sendMessage(chatId, {
        delete: {
          remoteJid: chatId,
          id: contextInfo.stanzaId,
          participant: quotedParticipant || BOT_JID,
          fromMe: !quotedParticipant || sameUser(quotedParticipant, BOT_JID)
        }
      });
    } catch (err) {
      // Gagal hapus target (mis. bot bukan admin grup saat hapus pesan member) → diam.
      console.error('❌ Error !del (target):', err.message);
    }

    // 2) Hapus pesan perintah !del — hanya berhasil bila bot admin grup. Gagal → diam.
    try {
      await sock.sendMessage(chatId, { delete: msg.key });
    } catch (err) {
      console.error('❌ Error !del (perintah):', err.message);
    }
    return true;
  }

  return false;
}

// ─── 5f. SW — Pasang Group Status (Owner & Admin Grup) ───
// Bot memposting GROUP STATUS ke dalam grup itu sendiri (via nexus:
// sock.sendGroupStatusMessage). Status muncul DI DALAM grup, bukan di nomor bot.
//   • !sw <teks>                         → status teks grup
//   • reply foto/video lalu !sw [caption] → status foto/video grup
async function handleSw(ctx) {
  const { sock, msg, chatId, isGroup, senderJid, body, OWNER_JID } = ctx;

  const lowBody = body.toLowerCase();
  if (lowBody !== '!sw' && !lowBody.startsWith('!sw ')) {
    return false;
  }

  if (!sameUser(senderJid, OWNER_JID) && !await isGroupAdmin(sock, chatId, senderJid)) {
    await sock.sendMessage(chatId, { text: '🚫 Perintah ini hanya untuk owner bot atau admin grup!' }, { quoted: msg });
    return true;
  }

  if (!isGroup) {
    await sock.sendMessage(chatId, { text: '⚠️ Perintah *!sw* hanya bisa digunakan di dalam grup!' }, { quoted: msg });
    return true;
  }

  const text = body.slice('!sw'.length).trim();

  // ── GROUP STATUS MEDIA (reply foto/video) ──
  const ci = msg.message?.extendedTextMessage?.contextInfo;
  const quotedMsg = ci?.stanzaId && ci?.quotedMessage ? ci.quotedMessage : null;
  let mediaType = null;
  if (quotedMsg?.imageMessage) mediaType = 'image';
  else if (quotedMsg?.videoMessage) mediaType = 'video';

  if (mediaType) {
    try {
      await sock.sendMessage(chatId, { text: '⏳ Sedang memproses media untuk group status...' }, { quoted: msg });

      const sourceMsg = {
        message: quotedMsg,
        key: { remoteJid: chatId, fromMe: false, id: ci.stanzaId, participant: ci.participant },
      };

      const mediaBuffer = await downloadMediaMessage(sourceMsg, 'buffer', {}, {
        logger: pino({ level: 'silent' }),
        reuploadRequest: sock.updateMediaMessage,
      });

      const caption = text || quotedMsg[`${mediaType}Message`]?.caption || '';

      if (mediaType === 'image') {
        await sock.sendGroupStatusMessage(chatId, { image: mediaBuffer, caption });
      } else {
        await sock.sendGroupStatusMessage(chatId, { video: mediaBuffer, caption });
      }

      await sock.sendMessage(chatId, { text: '✅ *Group status media berhasil dipasang!*' }, { quoted: msg });
    } catch (err) {
      console.error('❌ Error !sw media:', err);
      await sock.sendMessage(chatId, { text: `❌ Gagal memasang group status media: ${err.message}` }, { quoted: msg });
    }
    return true;
  }

  // ── GROUP STATUS TEKS ──
  if (text) {
    try {
      await sock.sendGroupStatusMessage(chatId, { text, backgroundColor: '#25D366', font: 1 });
      await sock.sendMessage(chatId, { text: '✅ *Group status teks berhasil dipasang!*' }, { quoted: msg });
    } catch (err) {
      console.error('❌ Error !sw teks:', err);
      await sock.sendMessage(chatId, { text: `❌ Gagal memasang group status: ${err.message}` }, { quoted: msg });
    }
    return true;
  }

  // ── Tidak ada teks & tidak reply media ──
  await sock.sendMessage(chatId, {
    text: '⚠️ *Cara pakai !sw:*\n• *!sw <teks>* — pasang group status teks\n• Balas foto/video lalu ketik *!sw* (bisa tambah caption)'
  }, { quoted: msg });
  return true;
}

// ─── !mode on/off — Toggle PM orang asing (Owner saja) ───
// on (default): PM orang asing dibalas "hubungi owner" & tak diproses.
// off: PM orang asing diabaikan total; hanya owner yang dilayani.
async function handleModeCommand(ctx) {
  const { sock, msg, chatId, senderJid, body, OWNER_JID } = ctx;

  const lowBody = body.toLowerCase();
  if (lowBody !== '!mode' && !lowBody.startsWith('!mode ')) return false;

  if (!sameUser(senderJid, OWNER_JID)) {
    await sock.sendMessage(chatId, { text: '🚫 Perintah ini hanya untuk owner bot!' }, { quoted: msg });
    return true;
  }

  const arg = body.trim().split(/\s+/)[1]?.toLowerCase();
  if (arg !== 'on' && arg !== 'off') {
    await sock.sendMessage(chatId, {
      text: '⚠️ *Cara pakai !mode:*\n• *!mode on* — PM orang asing dibalas "hubungi owner"\n• *!mode off* — PM orang asing diabaikan total (hanya owner dilayani)',
    }, { quoted: msg });
    return true;
  }

  const on = arg === 'on';
  setPmMode(on);
  await sock.sendMessage(chatId, {
    text: on
      ? '✅ *Mode PM aktif (on)* — orang asing yang PM akan diarahkan menghubungi owner.'
      : '✅ *Mode PM nonaktif (off)* — PM orang asing diabaikan total, hanya owner yang dilayani.',
  }, { quoted: msg });
  return true;
}

module.exports = {
  handleBanCommands,
  handleAllowGroup,
  handleDelete,
  handleHidetag,
  handleSw,
  handleModeCommand,
};
