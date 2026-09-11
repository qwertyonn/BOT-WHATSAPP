// utils/buttons.js
// Kirim tombol interaktif (native flow) memakai proto stock Baileys.
// Prinsip: id tombol = string command (mis. "!me"). Ketuk tombol → bot
// memperlakukan id itu sebagai perintah yang diketik (bridge di index.js).
//
// Batas WhatsApp: maks 3 tombol per pesan, label quick reply ≤ 20 karakter.
// Referensi struktur proto: @whiskeysockets/baileys WAProto/WAProto.proto

const { proto, generateWAMessageFromContent, prepareWAMessageMedia } = require('@whiskeysockets/baileys');

// Node <biz> wajib ikut dikirim agar WhatsApp merender tombol native flow
// (diadopsi dari fork atexovi-baileys yang dipakai repo referensi).
function nativeFlowBizNode() {
  return {
    tag: 'biz',
    attrs: {},
    content: [
      {
        tag: 'interactive',
        attrs: { type: 'native_flow', v: '1' },
        content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
      },
    ],
  };
}

// Tombol quick reply: tap langsung jalan (id = command).
function quickReply(id, displayText) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: String(displayText), id: String(id) }),
  };
}

// Tombol dropdown / list: sections berisi rows. Row id = command.
// sections: [{ title, rows: [{ title, description?, id }] }]
function listButton(title, sections) {
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title: String(title),
      sections: sections.map(s => ({
        title: s.title,
        rows: (s.rows || []).map(r => ({
          title: r.title,
          description: r.description || '',
          id: String(r.id),
        })),
      })),
    }),
  };
}

// Bangun & kirim pesan interactive. Pakai relayMessage langsung agar bisa
// menyisipkan node <biz> (sendMessage tidak mendukung konten interactive di
// Baileys stock).
// Opsi tambahan:
// - headerImage: Buffer gambar utk header pesan (upload via prepareWAMessageMedia)
// - messageId: override id pesan (biar tombol id = id pesan bisa diketahui dulu)
async function sendNativeFlow(sock, chatId, { text, footer, title, buttons = [], quoted, userJid, mentions, headerImage, messageId } = {}) {
  let header = {};
  if (title) header.title = String(title);
  if (headerImage) {
    const { imageMessage } = await prepareWAMessageMedia(
      { image: headerImage },
      { upload: sock.waUploadToServer, mediaType: 'Image' }
    );
    header.imageMessage = imageMessage;
    header.hasMediaAttachment = true;
  }

  const interactive = proto.Message.InteractiveMessage.create({
    ...(Object.keys(header).length ? { header } : {}),
    body: { text: String(text) },
    ...(footer ? { footer: { text: String(footer) } } : {}),
    ...(mentions?.length ? { contextInfo: { mentionedJid: mentions } } : {}),
    nativeFlowMessage: {
      messageVersion: 1,
      buttons: buttons.map(b => ({ name: b.name, buttonParamsJson: b.buttonParamsJson })),
    },
  });

  const wmsg = generateWAMessageFromContent(
    chatId,
    { interactiveMessage: interactive },
    { userJid: userJid || sock.user?.id, quoted, ...(messageId ? { messageId } : {}) }
  );

  await sock.relayMessage(chatId, wmsg.message, {
    messageId: wmsg.key.id,
    additionalNodes: buttons.length ? [nativeFlowBizNode()] : [],
  });
  return wmsg.key.id;
}

// Config: BUTTON_MODE=off → matikan tombol total (selalu kirim teks biasa).
function buttonsEnabled() {
  return process.env.BUTTON_MODE !== 'off';
}

// Kirim tombol; gagal → fallback teks biasa agar menu tetap sampai ke user.
// Mengembalikan id pesan yang terkirim (dipakai utk cache sesi reply).
async function sendMenu(sock, chatId, opts = {}) {
  const fallbackSend = async () => {
    const content = opts.headerImage
      ? { image: opts.headerImage, caption: opts.text, ...(opts.mentions?.length ? { mentions: opts.mentions } : {}) }
      : { text: opts.fallbackText || opts.text, ...(opts.mentions?.length ? { mentions: opts.mentions } : {}) };
    const sent = await sock.sendMessage(chatId, content, { quoted: opts.quoted });
    return sent?.key?.id || null;
  };

  if (!opts.buttons?.length) return fallbackSend();
  if (!buttonsEnabled()) {
    console.log('🔕 BUTTON_MODE=off, kirim teks biasa:', opts.text?.slice(0, 60));
    return fallbackSend();
  }
  try {
    const msgId = await sendNativeFlow(sock, chatId, opts);
    console.log(`✅ Tombol terkirim ke ${chatId}: ${opts.buttons.length} tombol`);
    return msgId;
  } catch (err) {
    console.error('⚠️ Kirim tombol gagal, fallback teks:', err.message);
    return fallbackSend();
  }
}

// Baca id command dari respons tombol (dipakai bridge di index.js).
// Menangani beberapa format respons yang mungkin dikirim klien WhatsApp:
// - native flow (quick_reply & single_select): interactiveResponseMessage
// - list legacy: listResponseMessage.singleSelectReply.selectedRowId
// - buttons legacy: buttonsResponseMessage.selectedButtonId
// - fallback: paramsJson.response bila id kosong tapi response berupa command.
function parseButtonId(msg) {
  try {
    const m = msg?.message;
    if (!m) return null;

    // 1. Native flow (format utama yang dipakai bot ini)
    const nfr = m.interactiveResponseMessage?.nativeFlowResponseMessage;
    if (nfr?.paramsJson) {
      const p = JSON.parse(nfr.paramsJson);
      const id = typeof p?.id === 'string' && p.id.trim() ? p.id.trim() : null;
      if (id) return id;
      if (typeof p?.response === 'string' && p.response.trim().startsWith('!')) return p.response.trim();
    }

    // 2. Template button reply (legacy — format yang dikirim klien Android)
    const tplId = m.templateButtonReplyMessage?.selectedId;
    if (typeof tplId === 'string' && tplId.trim()) return tplId.trim();

    // 3. List respons (legacy)
    const rowId = m.listResponseMessage?.singleSelectReply?.selectedRowId;
    if (typeof rowId === 'string' && rowId.trim()) return rowId.trim();

    // 4. Buttons respons (legacy)
    const btnId = m.buttonsResponseMessage?.selectedButtonId;
    if (typeof btnId === 'string' && btnId.trim()) return btnId.trim();

    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { quickReply, listButton, sendNativeFlow, sendMenu, parseButtonId, buttonsEnabled };

// Self-check: encode-decode proto tombol, pastikan id tersimpan.
if (require.main === module) {
  const btns = [
    quickReply('!me', 'Profil'),
    listButton('Game', [{ title: 'Game', rows: [{ title: 'Mancing', id: '!fishit menu' }] }]),
  ];
  const interactive = proto.Message.InteractiveMessage.fromObject({
    body: { text: 'x' },
    nativeFlowMessage: {
      messageVersion: 1,
      buttons: btns.map(b => ({ name: b.name, buttonParamsJson: b.buttonParamsJson })),
    },
  });
  const back = proto.Message.InteractiveMessage.decode(
    proto.Message.InteractiveMessage.encode(interactive).finish()
  );
  const parsed = back.nativeFlowMessage.buttons.map(b => JSON.parse(b.buttonParamsJson));
  const quickIds = parsed.filter(p => p.display_text).map(p => p.id);
  const rowIds = parsed.filter(p => p.sections).flatMap(p => p.sections.flatMap(s => s.rows.map(r => r.id)));
  if (!quickIds.includes('!me') || !rowIds.includes('!fishit menu')) {
    console.error('❌ Self-check gagal:', { quickIds, rowIds });
    process.exit(1);
  }

  // Test parseButtonId untuk semua format respons tombol.
  const cases = [
    { name: 'native flow', msg: { message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: '!hit' }) } } } }, want: '!hit' },
    { name: 'native flow response-only', msg: { message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ response: '!stand' }) } } } }, want: '!stand' },
    { name: 'template reply', msg: { message: { templateButtonReplyMessage: { selectedId: '!hit' } } }, want: '!hit' },
    { name: 'list legacy', msg: { message: { listResponseMessage: { singleSelectReply: { selectedRowId: '!me' } } } }, want: '!me' },
    { name: 'buttons legacy', msg: { message: { buttonsResponseMessage: { selectedButtonId: '!claim' } } }, want: '!claim' },
    { name: 'no id', msg: { message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ response: 'kosong' }) } } } }, want: null },
  ];
  for (const c of cases) {
    const got = parseButtonId(c.msg);
    if (got !== c.want) {
      console.error(`❌ parseButtonId [${c.name}]: expected "${c.want}", got "${got}"`);
      process.exit(1);
    }
  }

  console.log('✅ buttons.js OK — quick:', quickIds.join(', '), '| list rows:', rowIds.join(', '), '| parse: 6/6 OK');
}
