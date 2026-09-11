// handlers/media/commands.js
// Fitur media & multimedia: !send, !tovid, !change, !tt (+reply), !play (+reply),
// !s / !sticker, !toaudio, !toimg, !smeme. Infrastruktur download di download.js.
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const sharp = require('sharp');
const ytSearch = require('yt-search');
const { downloadMediaMessage, generateMessageID } = require('@whiskeysockets/baileys');
const { readImage, containOnTransparent, makeWebpSticker, encodeWebpSafe, addStickerMeta } = require('../../utils/sharp');
const { sameUser } = require('../../utils/jid');
const { quickReply, sendMenu } = require('../../utils/buttons');
const {
  ffmpeg,
  TMP_DIR,
  resolveYtDlp,
  getFfmpegParam,
  execWithTimeout,
  runQueuedDownload,
  MAX_VIDEO_SIZE,
  MAX_AUDIO_SIZE,
} = require('./download');

// Cache untuk menyimpan sesi pencarian !play / !tt sementara (waktu tunggu reply)
const playCache = new Map();
const ttCache = new Map();

// Metadata stiker: WhatsApp cuma menampilkan field pack name di layar tap stiker.
// Pipeline EXIF otomatis Baileys di fork ini throw, sehingga stiker terkirim raw;
// kita tanam EXIF sendiri via addStickerMeta ke buffer sebelum dikirim.
const STICKER_META = { pack: 'yonn kulbet', author: 'yonn kulbet' };

// Header ekstra agar ekstraksi TikTok tidak di-blok anti-bot:
// - Referer wajib (patch yt-dlp #17437); tanpa ini TikTok kirim HTML challenge →
//   error "Unexpected response from webpage request".
// - User-Agent di range Chrome 139 (bukan 140-149 yang di-ban "Site Maintenance").
const TIKTOK_ARGS = [
  '--referer', 'https://www.tiktok.com/',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
];

// ─── FITUR !SEND — Mengirim Ulang Foto/Video dengan Kualitas HD ───
async function handleSend(ctx) {
    const { sock, msg, chatId, body } = ctx;
    if (body.toLowerCase() !== '!send') return false;

    const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    const isQuotedVideo = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
    const isImage = msg.message?.imageMessage;
    const isVideo = msg.message?.videoMessage;

    let sourceMsg = null;
    let mediaType = '';

    if (isImage) { sourceMsg = msg; mediaType = 'image'; }
    else if (isVideo) { sourceMsg = msg; mediaType = 'video'; }
    else if (isQuotedImage) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
        mediaType = 'image';
    } else if (isQuotedVideo) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
        mediaType = 'video';
    }

    if (!sourceMsg) {
        await sock.sendMessage(chatId, { text: '⚠️ Kirim foto/video dengan caption *!send* atau balas foto/video lama dengan mengetik *!send*' }, { quoted: msg });
        return true;
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Sedang memproses & mengoptimalkan media ke kualitas HD...' }, { quoted: msg });

        // Download buffer media asli
        const mediaBuffer = await downloadMediaMessage(sourceMsg, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage
        });

        if (mediaType === 'image') {
            await sock.sendMessage(chatId, {
                image: mediaBuffer,
                caption: 'send'
            });

        } else if (mediaType === 'video') {
            const timestamp = Date.now();
            const tmpIn = path.join(TMP_DIR, `tmp_hd_in_${timestamp}.mp4`);
            const tmpOut = path.join(TMP_DIR, `tmp_hd_out_${timestamp}.mp4`);

            fs.writeFileSync(tmpIn, mediaBuffer);

            ffmpeg(tmpIn)
                .outputOptions([
                    '-vcodec libx264',
                    '-crf 18',
                    '-preset slow',
                    '-pix_fmt yuv420p',
                    '-c:a aac',
                    '-b:a 128k',
                    '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'
                ])
                .toFormat('mp4')
                .on('end', async () => {
                    if (fs.existsSync(tmpOut)) {
                        const videoHdBuffer = fs.readFileSync(tmpOut);

                        await sock.sendMessage(chatId, {
                            video: videoHdBuffer,
                            caption: 'send',
                            mimetype: 'video/mp4'
                        });
                    }
                    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
                    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
                })
                .on('error', async (err) => {
                    console.error('❌ FFmpeg HD Encoding Error:', err);
                    await sock.sendMessage(chatId, {
                        video: mediaBuffer,
                        caption: 'send',
                        mimetype: 'video/mp4'
                    });
                    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
                })
                .save(tmpOut);
        }
    } catch (err) {
        console.error('❌ Error !send HD:', err);
        await sock.sendMessage(chatId, { text: '❌ Gagal mengirim ulang media HD. Pastikan file media tidak kedaluwarsa.' }, { quoted: msg });
    }
    return true;
}

// ─── TOVID — Mengubah Stiker Bergerak (Animasi) Menjadi Video MP4 ───
async function handleTovid(ctx) {
    const { sock, msg, chatId, body } = ctx;
    if (!body.toLowerCase().startsWith('!tovid')) return false;

    const isQuotedSticker = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
    const isSticker = msg.message?.stickerMessage;

    let sourceMsg = null;
    if (isSticker) {
        sourceMsg = msg;
    } else if (isQuotedSticker) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
    }

    if (!sourceMsg) {
        await sock.sendMessage(chatId, { text: '⚠️ Balas stiker bergerak (animasi) yang ingin diubah menjadi video dengan mengetik *!tovid*' }, { quoted: msg });
        return true;
    }

    let tmpWebp, tmpMp4;
    try {
        await sock.sendMessage(chatId, { text: '⏳ Sedang mengonversi stiker menjadi video... Mohon tunggu.' }, { quoted: msg });

        // Download buffer media dari stiker
        const mediaBuffer = await downloadMediaMessage(sourceMsg, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage
        });

        const timestamp = Date.now();
        tmpWebp = path.join(TMP_DIR, `tmp_tovid_in_${timestamp}.webp`);
        tmpMp4  = path.join(TMP_DIR, `tmp_tovid_out_${timestamp}.mp4`);

        // Tulis buffer stiker ke file webp sementara
        fs.writeFileSync(tmpWebp, mediaBuffer);

        // Helper: jalankan FFmpeg dan kembalikan Promise
        const runFfmpeg = (cmd) => new Promise((resolve, reject) => {
            cmd
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .save(tmpMp4);
        });

        // Deteksi webp animasi: flag animation (bit 0x02) di chunk VP8X / keberadaan chunk ANIM
        const isAnimatedWebp = (buf) => {
            if (!buf || buf.length < 22) return false;
            if (buf.toString('latin1', 0, 4) !== 'RIFF') return false;
            if (buf.toString('latin1', 8, 12) !== 'WEBP') return false;
            const hasAnimFlag = buf.toString('latin1', 12, 16) === 'VP8X' && (buf[20] & 0x02) === 0x02;
            const hasAnimChunk = buf.toString('latin1', 0, 64).includes('ANIM');
            return hasAnimFlag || hasAnimChunk;
        };

        const videoBuffer = await (async () => {
            if (isAnimatedWebp(mediaBuffer)) {
                // WebP animasi → mp4. FFmpeg Android/some builds dapat kekurangan decoder
                // webp (exit 69). Fallback: decode frame per frame via sharp (wasm32)
                // → PNG (decoder selalu ada) → encode ke mp4 via ffmpeg.
                const proc = ffmpeg()
                    .outputOptions(['-vcodec libx264', '-pix_fmt yuv420p', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'])
                    .toFormat('mp4');
                let viaFrames = false;
                try {
                    await new Promise((resolve, reject) => {
                        proc
                            .input(tmpWebp)
                            .on('end', () => resolve())
                            .on('error', (err) => reject(err))
                            .save(tmpMp4);
                    });
                } catch (e) {
                    viaFrames = true;
                }
                if (viaFrames) {
                    const meta = await sharp(mediaBuffer).metadata();
                    const pages = meta.pages || 1;
                    const pattern = path.join(TMP_DIR, `tmp_tovid_frame_${timestamp}_%d.png`);
                    for (let i = 0; i < pages; i++) {
                        const frame = await sharp(mediaBuffer, { page: i }).png().toBuffer();
                        fs.writeFileSync(path.join(TMP_DIR, `tmp_tovid_frame_${timestamp}_${i + 1}.png`), frame);
                    }
                    await new Promise((resolve, reject) => {
                        ffmpeg(pattern)
                            .inputOptions(['-framerate 10'])
                            .outputOptions(['-vcodec libx264', '-pix_fmt yuv420p', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'])
                            .on('end', () => resolve())
                            .on('error', (err) => reject(err))
                            .save(tmpMp4);
                    });
                    for (let i = 1; i <= pages; i++) {
                        const f = path.join(TMP_DIR, `tmp_tovid_frame_${timestamp}_${i}.png`);
                        if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch (e) { /* abaikan */ } }
                    }
                }
            } else {
                // Stiker statis: jadikan video diam berdurasi ~2 detik agar bisa diputar di WhatsApp
                await runFfmpeg(
                    ffmpeg(tmpWebp)
                        .inputOptions(['-loop 1', '-framerate 10'])
                        .outputOptions([
                            '-t 2',
                            '-vcodec libx264',
                            '-pix_fmt yuv420p',
                            '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'
                        ])
                        .toFormat('mp4')
                );
            }

            if (!fs.existsSync(tmpMp4)) throw new Error('Hasil konversi video tidak ditemukan.');
            return fs.readFileSync(tmpMp4);
        })();

        await sock.sendMessage(chatId, {
            video: videoBuffer,
            caption: '✅ Berhasil mengubah stiker menjadi video!',
            mimetype: 'video/mp4'
        }, { quoted: msg });

    } catch (err) {
        console.error('❌ Error !tovid:', err);
        await sock.sendMessage(chatId, { text: '❌ Gagal mengonversi stiker. Pastikan stiker yang Anda balas adalah stiker bergerak/animasi.' }, { quoted: msg });
    } finally {
        // Bersihkan semua file sementara
        for (const f of [tmpWebp, tmpMp4]) {
            if (f && fs.existsSync(f)) { try { fs.unlinkSync(f); } catch (e) { /* abaikan */ } }
        }
    }
    return true;
}

// ─── CHANGE RATIO — Mengubah Rasio Foto, Stiker, atau Video ───
async function handleChange(ctx) {
    const { sock, msg, chatId, body } = ctx;
    if (!body.toLowerCase().startsWith('!change')) return false;

    const args = body.slice(7).trim().split(' ');
    const ratioInput = args[0];
    const validRatios = ['1:1', '9:16', '16:9'];

    if (!ratioInput || !validRatios.includes(ratioInput)) {
        await sock.sendMessage(chatId, {
            text: [
                '⚠️ *Format Salah! Tentukan rasio pemotongan yang valid.*',
                '',
                '📌 *Opsi Rasio:*',
                '• *!change 1:1* (Kotak / Square)',
                '• *!change 9:16* (Vertikal / Story / TikTok)',
                '• *!change 16:9* (Horizontal / Landscape / YouTube)',
                '',
                '💡 *Contoh:* Balas foto/stiker/video dengan ketik *!change 1:1*'
            ].join('\n')
        }, { quoted: msg });
        return true;
    }

    const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    const isQuotedSticker = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
    const isQuotedVideo = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
    const isImage = msg.message?.imageMessage;
    const isSticker = msg.message?.stickerMessage;
    const isVideo = msg.message?.videoMessage;

    let sourceMsg = null;
    let mediaType = '';

    if (isImage) { sourceMsg = msg; mediaType = 'image'; }
    else if (isSticker) { sourceMsg = msg; mediaType = 'sticker'; }
    else if (isVideo) { sourceMsg = msg; mediaType = 'video'; }
    else if (isQuotedImage) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
        mediaType = 'image';
    } else if (isQuotedSticker) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
        mediaType = 'sticker';
    } else if (isQuotedVideo) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
        mediaType = 'video';
    }

    if (!sourceMsg) {
        await sock.sendMessage(chatId, { text: `🖼️ Balas foto, stiker, atau video yang ingin dipotong dengan perintah *!change ${ratioInput}*` }, { quoted: msg });
        return true;
    }

    try {
        await sock.sendMessage(chatId, { text: `⏳ Sedang memproses dan memotong media ke rasio ${ratioInput}...` }, { quoted: msg });

        const mediaBuffer = await downloadMediaMessage(sourceMsg, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage
        });

        // PROSES JIKA INPUT ADALAH FOTO / STIKER
        if (mediaType === 'image' || mediaType === 'sticker') {
            const imagePipeline = readImage(mediaBuffer);
            const mediaMeta = await imagePipeline.metadata();
            const mediaWidth = mediaMeta.width;
            const mediaHeight = mediaMeta.height;

            if (!mediaWidth || !mediaHeight) {
                throw new Error('Metadata gambar tidak terbaca.');
            }

            // Kalkulasi matematika untuk Center Crop sesuai aspek rasio target
            const [targetW, targetH] = ratioInput.split(':').map(Number);
            const targetRatio = targetW / targetH;
            const currentRatio = mediaWidth / mediaHeight;

            let extractW, extractH;
            if (currentRatio > targetRatio) {
                // Gambar terlalu lebar -> potong bagian kanan dan kiri
                extractH = mediaHeight;
                extractW = Math.floor(mediaHeight * targetRatio);
            } else {
                // Gambar terlalu tinggi -> potong bagian atas dan bawah
                extractW = mediaWidth;
                extractH = Math.floor(mediaWidth / targetRatio);
            }

            const left = Math.floor((mediaWidth - extractW) / 2);
            const top = Math.floor((mediaHeight - extractH) / 2);

            if (mediaType === 'image') {
                // Output berupa FOTO
                const processedBuffer = await imagePipeline
                    .extract({ left, top, width: extractW, height: extractH })
                    .jpeg({ quality: 90 })
                    .toBuffer();

                await sock.sendMessage(chatId, {
                    image: processedBuffer,
                    caption: `✅ Berhasil mengubah rasio foto menjadi *${ratioInput}*!`
                }, { quoted: msg });
            } else {
                // Output berupa STIKER (Dipad transparan ke wadah square 512x512 agar proporsional di WA)
                const cropped = imagePipeline.extract({ left, top, width: extractW, height: extractH });
                const canvas = await containOnTransparent(cropped, 512);
                const processedBuffer = await encodeWebpSafe(await canvas.png().toBuffer(), 80);

                const tagged = await addStickerMeta(processedBuffer, STICKER_META);
                await sock.sendMessage(chatId, {
                    sticker: tagged,
                    pack: STICKER_META.pack,
                    author: STICKER_META.author
                }, { quoted: msg });
            }

        // PROSES JIKA INPUT ADALAH VIDEO (MENGGUNAKAN FFMPEG)
        } else if (mediaType === 'video') {
            const timestamp = Date.now();
            const tmpIn = path.join(TMP_DIR, `tmp_chg_in_${timestamp}.mp4`);
            const tmpOut = path.join(TMP_DIR, `tmp_chg_out_${timestamp}.mp4`);

            fs.writeFileSync(tmpIn, mediaBuffer);

            // Formulasi filter ekspresi crop dinamis FFmpeg (Otomatis Center Crop)
            let cropFilter = '';
            if (ratioInput === '1:1') {
                cropFilter = "crop='min(iw,ih):min(iw,ih)'";
            } else if (ratioInput === '16:9') {
                cropFilter = "crop='if(gte(iw/ih,16/9),ih*16/9,iw):if(gte(iw/ih,16/9),ih,iw*9/16)'";
            } else if (ratioInput === '9:16') {
                cropFilter = "crop='if(gte(iw/ih,9/16),ih*9/16,iw):if(gte(iw/ih,9/16),ih,iw*16/9)'";
            }

            ffmpeg(tmpIn)
                .videoFilter(cropFilter)
                .outputOptions([
                    '-vcodec libx264',
                    '-pix_fmt yuv420p',
                    '-acodec aac'
                ])
                .toFormat('mp4')
                .on('end', async () => {
                    if (!fs.existsSync(tmpOut)) {
                        await sock.sendMessage(chatId, { text: '❌ Gagal memproses pemotongan video (hasil tidak ditemukan).' }, { quoted: msg });
                        if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
                        return;
                    }
                    const videoBuffer = fs.readFileSync(tmpOut);
                    await sock.sendMessage(chatId, {
                        video: videoBuffer,
                        caption: `✅ Berhasil mengubah rasio video menjadi *${ratioInput}*!`,
                        mimetype: 'video/mp4'
                    }, { quoted: msg });

                    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
                    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
                })
                .on('error', async (err) => {
                    console.error('❌ FFmpeg Video Crop Error:', err);
                    await sock.sendMessage(chatId, { text: '❌ Gagal memproses pemotongan video.' }, { quoted: msg });
                    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
                    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
                })
                .save(tmpOut);
        }

    } catch (err) {
        console.error('❌ Error !change ratio:', err);
        await sock.sendMessage(chatId, { text: '❌ Gagal memproses media. Pastikan file media yang dikirim/dibalas tidak rusak.' }, { quoted: msg });
    }
    return true;
}

// ─── NEW FEATURE: TIKTOK DOWNLOADER (!tt) ───
async function handleTiktok(ctx) {
    const { sock, msg, chatId, senderJid, body } = ctx;

    // ─── RESPONS REPLY MENU !tt (!ttaudio / !ttvideo) ───
    const ttLow = body.toLowerCase();
    const isTtRespon = ttLow === '!ttaudio' || ttLow === '!ttvideo' || ttLow.startsWith('!ttaudio:') || ttLow.startsWith('!ttvideo:');
    if (isTtRespon) {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const inlineMsgId = body.includes(':') ? body.split(':')[1] : null;
        const quotedMsgId = inlineMsgId || contextInfo?.stanzaId;
        const ttRawCmd    = ttLow.includes(':') ? ttLow.split(':')[0] : ttLow;

        if (!quotedMsgId || !ttCache.has(quotedMsgId)) {
            return true;
        }

        const session = ttCache.get(quotedMsgId);

        if (!sameUser(session.sender, senderJid)) {
            await sock.sendMessage(chatId, { text: '❌ Pilihan format ini hanya bisa dieksekusi oleh orang yang meminta link tersebut!' }, { quoted: msg });
            return true;
        }

        const isAudio = ttRawCmd === '!ttaudio';
        await sock.sendMessage(chatId, { text: `⏳ Menyiapkan pengunduhan ${isAudio ? 'Audio' : 'Video'} TikTok...\nMohon tunggu beberapa saat...` }, { quoted: msg });

        const timestamp = Date.now();
        const tmpFileTemplate = path.join(TMP_DIR, `tmp_dl_${timestamp}.%(ext)s`);

        const ffmpegParam = getFfmpegParam();
        const ytDlpPath = resolveYtDlp();

        let args = [];
        if (isAudio) {
            args = [...TIKTOK_ARGS, '--js-runtimes', 'node', ...ffmpegParam, '--max-filesize', MAX_AUDIO_SIZE, '-f', 'ba', '-x', '--audio-format', 'mp3', '--merge-output-format', 'mp3', '-o', tmpFileTemplate, session.url];
        } else {
            args = [...TIKTOK_ARGS, '--js-runtimes', 'node', ...ffmpegParam, '--max-filesize', MAX_VIDEO_SIZE, '-f', 'bv+ba/b', '--merge-output-format', 'mp4', '--postprocessor-args', 'Merger+ffmpeg:-c:v copy -c:a aac -ar 44100', '-o', tmpFileTemplate, session.url];
        }

        await runQueuedDownload({
            sock, msg, chatId, senderJid,
            label: `${session.title} (TikTok ${isAudio ? 'Audio' : 'Video'})`,
            bin: ytDlpPath, args, timestamp,
            retries: 2,
            resultHandler: async (downloadedFile) => {
                const actualExt = path.extname(downloadedFile).toLowerCase();
                if (isAudio) {
                    const mimetype = actualExt === '.mp3' ? 'audio/mpeg' : (actualExt === '.m4a' ? 'audio/mp4' : 'audio/mpeg');
                    await sock.sendMessage(chatId, {
                        audio: fs.readFileSync(downloadedFile),
                        mimetype: mimetype,
                        fileName: `${session.title}${actualExt || '.mp3'}`
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(chatId, {
                        video: fs.readFileSync(downloadedFile),
                        caption: `✅ Berhasil mengunduh Video TikTok:\n*${session.title}*`,
                        mimetype: actualExt === '.webm' ? 'video/webm' : 'video/mp4'
                    }, { quoted: msg });
                }
            }
        });
        ttCache.delete(quotedMsgId);
        return true;
    }

    // ─── PERINTAH !tt [link] ───
    if (!body.toLowerCase().startsWith('!tt ')) return false;

    const urlInput = body.slice(4).trim();
    if (!urlInput) {
        await sock.sendMessage(chatId, { text: '⚠️ Sertakan link TikTok yang ingin diunduh!\nContoh: *!tt https://vm.tiktok.com/xxxxxx/*' }, { quoted: msg });
        return true;
    }

    // Validasi sederhana memastikan input adalah link tiktok
    if (!urlInput.includes('tiktok.com')) {
        await sock.sendMessage(chatId, { text: '❌ Link yang kamu masukkan bukan link TikTok yang valid!' }, { quoted: msg });
        return true;
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Sedang mengambil informasi video TikTok...' }, { quoted: msg });

        // Mengambil metadata via yt-dlp secara instan (path portabel Windows & Termux)
        const ytDlpPath = resolveYtDlp();

        // Ambil judul/caption video (async — tidak memblokir event loop)
        let videoTitle = 'TikTok Video';
        try {
            const titleResult = await execWithTimeout(ytDlpPath, [...TIKTOK_ARGS, '--js-runtimes', 'node', ...getFfmpegParam(), '--get-title', urlInput], 15 * 1000);
            videoTitle = (titleResult.stdout || '').trim() || 'TikTok Video';
        } catch (e) {
            // Jika gagal fetch title, biarkan menggunakan default
        }

        const caption = [
            `🎵 *TIKTOK DOWNLOAD SYSTEM* 🎵`,
            `───────────────────`,
            `📌 *Deskripsi:* ${videoTitle}`,
            `🔗 *Link:* ${urlInput}`,
            `───────────────────`,
            `👉 *Pilih format di bawah untuk mengunduh:*`,
            `💡 _Sesi ini berlaku selama 5 menit khusus untuk pengirim perintah._`
        ].join('\n');

        // Id pesan dibuat dulu supaya tombol bisa embed id yang sama (cache lookup)
        const preId = generateMessageID();
        ttCache.set(preId, {
            url: urlInput,
            title: videoTitle,
            sender: senderJid
        });

        // Satu pesan: caption + tombol Audio/Video
        await sendMenu(sock, chatId, {
            text: caption,
            footer: '🎬 Pilih format TikTok',
            quoted: msg,
            messageId: preId,
            fallbackText: `${caption}\n\nBalas pesan ini dengan *!ttaudio* / *!ttvideo*`,
            buttons: [
                quickReply(`!ttaudio:${preId}`, '🎵 Audio'),
                quickReply(`!ttvideo:${preId}`, '🎬 Video'),
            ],
        });

        // Hapus otomatis setelah 5 menit
        setTimeout(() => {
            ttCache.delete(preId);
        }, 5 * 60 * 1000);

    } catch (err) {
        console.error('❌ Error !tt:', err);
        await sock.sendMessage(chatId, { text: `❌ Gagal memproses link TikTok: ${err.message}` }, { quoted: msg });
    }
    return true;
}

// ─── NEW FEATURE: YOUTUBE DOWNLOADER (!play) ───
async function handlePlay(ctx) {
    const { sock, msg, chatId, senderJid, body } = ctx;

    // ─── RESPONS REPLY MENU !play (!audio / !video) ───
    const playLow = body.toLowerCase();
    const isPlayRespon = playLow === '!audio' || playLow === '!video' || playLow.startsWith('!audio:') || playLow.startsWith('!video:');
    if (isPlayRespon) {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const inlineMsgId = body.includes(':') ? body.split(':')[1] : null;
        const quotedMsgId = inlineMsgId || contextInfo?.stanzaId;
        const playRawCmd  = playLow.includes(':') ? playLow.split(':')[0] : playLow;

        if (!quotedMsgId || !playCache.has(quotedMsgId)) {
            return true;
        }

        const session = playCache.get(quotedMsgId);

        if (!sameUser(session.sender, senderJid)) {
            await sock.sendMessage(chatId, { text: '❌ Pilihan format ini hanya bisa dieksekusi oleh orang yang meminta lagu tersebut!' }, { quoted: msg });
            return true;
        }

        const isAudio = playRawCmd === '!audio';
        await sock.sendMessage(chatId, { text: `⏳ Menyiapkan pengunduhan ${isAudio ? 'Audio' : 'Video'} untuk:\n*${session.title}*\n\nMohon tunggu beberapa saat...` }, { quoted: msg });

        const timestamp = Date.now();
        const tmpFileTemplate = path.join(TMP_DIR, `tmp_dl_${timestamp}.%(ext)s`);

        const ffmpegParam = getFfmpegParam();
        const ytDlpPath = resolveYtDlp();

        let args = [];
        if (isAudio) {
            args = ['--js-runtimes', 'node', ...ffmpegParam, '--max-filesize', MAX_AUDIO_SIZE, '-f', 'ba[ext=m4a]/ba', '-o', tmpFileTemplate, session.url];
        } else {
            // FILTER KETAT: Memaksa yt-dlp hanya mengambil Video H.264 (avc1) + Audio AAC (m4a) agar 100% lancar di WhatsApp.
            // Dipakai sebagai array (spawn tanpa shell) → tanda ^ tetap literal di Windows cmd maupun Termux.
            args = ['--js-runtimes', 'node', ...ffmpegParam, '--max-filesize', MAX_VIDEO_SIZE, '-f', 'bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][vcodec^=avc1]/best[height<=720]', '--merge-output-format', 'mp4', '-o', tmpFileTemplate, session.url];
        }

        await runQueuedDownload({
            sock, msg, chatId, senderJid,
            label: `${session.title} (YouTube ${isAudio ? 'Audio' : 'Video'})`,
            bin: ytDlpPath, args, timestamp,
            resultHandler: async (downloadedFile) => {
                const actualExt = path.extname(downloadedFile).toLowerCase();

                if (isAudio) {
                    let mimetype = 'audio/mp4';
                    if (actualExt === '.webm') mimetype = 'audio/webm';
                    else if (actualExt === '.ogg' || actualExt === '.opus') mimetype = 'audio/ogg';

                    await sock.sendMessage(chatId, {
                        audio: fs.readFileSync(downloadedFile),
                        mimetype: mimetype,
                        fileName: `${session.title}${actualExt}`
                    }, { quoted: msg });
                } else {
                    // Kirim video MP4 yang sudah dipastikan ber-codec aman (H.264)
                    await sock.sendMessage(chatId, {
                        video: fs.readFileSync(downloadedFile),
                        caption: `✅ Berhasil mengunduh: *${session.title}*`,
                        mimetype: 'video/mp4'
                    }, { quoted: msg });
                }
            }
        });
        playCache.delete(quotedMsgId);
        return true;
    }

    // ─── PERINTAH !play [judul] ───
    if (!body.toLowerCase().startsWith('!play ')) return false;

    const query = body.slice(6).trim();
    if (!query) {
        await sock.sendMessage(chatId, { text: '⚠️ Tuliskan judul lagu atau video yang ingin dicari!\nContoh: *!play mirror linkin park*' }, { quoted: msg });
        return true;
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Sedang mencari di YouTube...' }, { quoted: msg });

        const searchResults = await ytSearch(query);
        if (!searchResults || !searchResults.videos || searchResults.videos.length === 0) {
            await sock.sendMessage(chatId, { text: '❌ Video atau lagu tidak ditemukan. Coba gunakan kata kunci lain.' }, { quoted: msg });
            return true;
        }

        const video = searchResults.videos[0];

        const caption = [
            `🎵 *YOUTUBE PLAY SYSTEM* 🎵`,
            `───────────────────`,
            `📌 *Judul:* ${video.title}`,
            `⏱️ *Durasi:* ${video.timestamp}`,
            `👀 *Viewer:* ${video.views.toLocaleString()}`,
            `🔗 *Link:* ${video.url}`,
            `───────────────────`,
            `👉 *Pilih format di bawah untuk mengunduh:*`,
            `💡 _Sesi ini berlaku selama 5 menit khusus untuk pengirim perintah._`
        ].join('\n');

        // Id pesan dibuat dulu supaya tombol bisa embed id yang sama (cache lookup)
        const preId = generateMessageID();

        // Coba ambil thumbnail YouTube → jadi header gambar satu pesan
        let thumbnailBuffer = null;
        try {
            const thumbnailUrls = [
                `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
                `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
                `https://i.ytimg.com/vi/${video.videoId}/default.jpg`,
                video.thumbnail,
            ].filter(Boolean);
            const axios = (await import('axios')).default;
            for (const thumbUrl of thumbnailUrls) {
                try {
                    const res = await axios.get(thumbUrl, {
                        responseType: 'arraybuffer',
                        timeout: 8000,
                        validateStatus: (status) => status === 200
                    });
                    thumbnailBuffer = Buffer.from(res.data);
                    break;
                } catch { /* lanjut URL berikutnya */ }
            }
        } catch (thumbErr) {
            console.warn('⚠️ Gagal ambil thumbnail, kirim tanpa gambar:', thumbErr.message);
        }

        playCache.set(preId, {
            url: video.url,
            title: video.title,
            sender: senderJid
        });

        // Satu pesan: thumbnail (jika ada) + caption + tombol Audio/Video
        await sendMenu(sock, chatId, {
            text: caption,
            footer: '🎬 Pilih format',
            quoted: msg,
            headerImage: thumbnailBuffer || undefined,
            messageId: preId,
            fallbackText: `${caption}\n\nBalas pesan ini dengan *!audio* / *!video*`,
            buttons: [
                quickReply(`!audio:${preId}`, '🎵 Audio'),
                quickReply(`!video:${preId}`, '🎬 Video'),
            ],
        });

        setTimeout(() => {
            playCache.delete(preId);
        }, 5 * 60 * 1000);

    } catch (err) {
        console.error('❌ Error !play:', err);
        await sock.sendMessage(chatId, { text: `❌ Gagal mencari konten: ${err.message}` }, { quoted: msg });
    }
    return true;
}

// ─── VIDEO -> STIKER ANIMASI — helper & guard ukuran ───
const STICKER_Q_LADDER = [32, 26, 20, 14];
const STICKER_MAX_BYTES = 950 * 1024;

function webpFromVideo(tmpIn, tmpOut, q, fps = 12) {
    return new Promise((resolve, reject) => {
        ffmpeg(tmpIn)
            .outputOptions([
                '-t', '10',
                '-vf', `fps=${fps},scale=512:512:force_original_aspect_ratio=increase,crop=512:512`,
                '-vcodec', 'libwebp',
                '-lossless', '0',
                '-compression_level', '5',
                '-q:v', String(q),
                '-loop', '0',
                '-pix_fmt', 'rgba',
            ])
            .toFormat('webp')
            .on('end', () => { try { resolve(fs.readFileSync(tmpOut)); } catch (e) { reject(e); } })
            .on('error', reject)
            .save(tmpOut);
    });
}

// ─── STICKER — prefix !s / !sticker (Support Gambar & Video) ───
async function handleSticker(ctx) {
    const { sock, msg, chatId, body } = ctx;
    if (body.toLowerCase() !== '!s' && body.toLowerCase() !== '!sticker') return false;

    const isQuotedVideo = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
    const isVideo = msg.message?.videoMessage;
    const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    const isImage = msg.message?.imageMessage;

    let sourceMsg;
    if (isImage || isVideo) {
        sourceMsg = msg;
    } else if (isQuotedImage || isQuotedVideo) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
    }

    if (!sourceMsg) {
        await sock.sendMessage(chatId, { text: '🖼️ Balas gambar atau video dengan *!s*' }, { quoted: msg });
        return true;
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Sedang memproses...' }, { quoted: msg });

        const mediaBuffer = await downloadMediaMessage(sourceMsg, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage
        });

        const isVideoContent = isVideo || isQuotedVideo;

        if (isVideoContent) {
            const timestamp = Date.now();
            const tmpIn = path.join(TMP_DIR, `tmp_sticker_${timestamp}.mp4`);
            const tmpOut = path.join(TMP_DIR, `tmp_sticker_${timestamp}.webp`);
            fs.writeFileSync(tmpIn, mediaBuffer);

            try {
                // Video -> WEBP animasi via ffmpeg. Guard ukuran: mulai q=32 lalu
                // turun bertahap bila webp > 950 KB, supaya selalu < 1 MB dan
                // jalur no-re-encode di fork Baileys tetap aktif.
                let stickerBuffer = null;
                for (const q of STICKER_Q_LADDER) {
                    stickerBuffer = await webpFromVideo(tmpIn, tmpOut, q);
                    if (stickerBuffer.length <= STICKER_MAX_BYTES) break;
                }
                if (stickerBuffer.length > STICKER_MAX_BYTES) {
                    stickerBuffer = await webpFromVideo(tmpIn, tmpOut, STICKER_Q_LADDER[STICKER_Q_LADDER.length - 1], 8);
                }
                const tagged = await addStickerMeta(stickerBuffer, STICKER_META);
                await sock.sendMessage(chatId, { sticker: tagged, pack: STICKER_META.pack, author: STICKER_META.author }, { quoted: msg });
            } catch (convErr) {
                console.error('❌ Gagal membuat stiker video:', convErr);
                await sock.sendMessage(chatId, { text: '❌ Gagal mengonversi video ke stiker.' }, { quoted: msg });
            } finally {
                for (const f of [tmpIn, tmpOut]) if (fs.existsSync(f)) fs.unlinkSync(f);
            }
        } else {
            const stickerBuffer = await makeWebpSticker(mediaBuffer, 80);
            const tagged = await addStickerMeta(stickerBuffer, STICKER_META);
            await sock.sendMessage(chatId, { sticker: tagged, pack: STICKER_META.pack, author: STICKER_META.author }, { quoted: msg });
        }

    } catch (err) {
        console.error('❌ Error:', err);
        await sock.sendMessage(chatId, { text: '❌ Terjadi kesalahan teknis.' }, { quoted: msg });
    }
    return true;
}

// ─── TOAUDIO — Mengubah Video Menjadi Audio (M4A/MP4 Audio) ───
async function handleToaudio(ctx) {
    const { sock, msg, chatId, body } = ctx;
    if (body.toLowerCase() !== '!toaudio') return false;

    const isQuotedVideo = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
    const isVideo = msg.message?.videoMessage;

    let sourceMsg = null;
    if (isVideo) {
        sourceMsg = msg;
    } else if (isQuotedVideo) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
    }

    if (!sourceMsg) {
        await sock.sendMessage(chatId, { text: '⚠️ Balas video yang ingin diambil audionya dengan mengetik *!toaudio*' }, { quoted: msg });
        return true;
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Sedang mengekstrak audio dari video... Mohon tunggu.' }, { quoted: msg });

        // Download buffer media dari video
        const mediaBuffer = await downloadMediaMessage(sourceMsg, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage
        });

        const timestamp = Date.now();
        const tmpIn = path.join(TMP_DIR, `tmp_toaudio_in_${timestamp}.mp4`);
        const tmpOut = path.join(TMP_DIR, `tmp_toaudio_out_${timestamp}.m4a`);

        // Tulis buffer video ke file sementara
        fs.writeFileSync(tmpIn, mediaBuffer);

        // Proses ekstraksi audio menggunakan FFmpeg (Hanya menyalin audio ke wadah m4a)
        ffmpeg(tmpIn)
            .outputOptions([
                '-vn',
                '-c:a aac',
                '-b:a 128k'
            ])
            .on('end', async () => {
                if (fs.existsSync(tmpOut)) {
                    const audioBuffer = fs.readFileSync(tmpOut);

                    await sock.sendMessage(chatId, {
                        audio: audioBuffer,
                        mimetype: 'audio/mp4',
                        fileName: `Audio_${timestamp}.m4a`
                    }, { quoted: msg });
                } else {
                    throw new Error('Hasil ekstraksi audio tidak ditemukan.');
                }

                if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
                if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
            })
            .on('error', async (err) => {
                console.error('❌ FFmpeg Toaudio Error:', err);
                await sock.sendMessage(chatId, { text: '❌ Gagal mengekstrak audio. Pastikan file video tidak rusak.' }, { quoted: msg });

                if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
                if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
            })
            .save(tmpOut);

    } catch (err) {
        console.error('❌ Error !toaudio:', err);
        await sock.sendMessage(chatId, { text: '❌ Terjadi kesalahan internal saat memproses media.' }, { quoted: msg });
    }
    return true;
}

// ─── TOIMAGE — prefix !toimg (Mengubah Stiker ke Foto) ───
async function handleToimg(ctx) {
    const { sock, msg, chatId, body } = ctx;
    if (body.toLowerCase() !== '!toimg' && body.toLowerCase() !== '!toimage') return false;

    const isQuotedSticker = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
    const isSticker = msg.message?.stickerMessage;

    let sourceMsg;
    if (isSticker) {
        sourceMsg = msg;
    } else if (isQuotedSticker) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
    }

    if (!sourceMsg) {
        await sock.sendMessage(chatId, { text: '🗂️ Balas/quote stiker yang ingin diubah menjadi foto dengan perintah *!toimg*' }, { quoted: msg });
        return true;
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Mengonversi stiker menjadi foto...' }, { quoted: msg });

        const mediaBuffer = await downloadMediaMessage(sourceMsg, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage
        });

        const imageBuffer = await readImage(mediaBuffer).png().toBuffer();

        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: '✅ Berhasil mengubah stiker menjadi foto!'
        }, { quoted: msg });

    } catch (err) {
        console.error('❌ Error !toimg:', err);
        await sock.sendMessage(chatId, { text: '❌ Gagal mengonversi stiker. Pastikan media yang di-quote adalah stiker valid.' }, { quoted: msg });
    }
    return true;
}

// ─── SMEME — Sticker Meme Teks Permanen ───
async function handleSmeme(ctx) {
    const { sock, msg, chatId, body } = ctx;
    if (!body.toLowerCase().startsWith('!smeme')) return false;

    const memeText = body.slice(6).trim();
    if (!memeText) {
        await sock.sendMessage(chatId, { text: '🖼️ Tulis teks memenya setelah perintah!\nContoh: Balas gambar/stiker dengan ketik *!smeme teks bawah*' }, { quoted: msg });
        return true;
    }

    const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    const isQuotedSticker = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
    const isImage = msg.message?.imageMessage;

    let sourceMsg;
    if (isImage) {
        sourceMsg = msg;
    } else if (isQuotedImage || isQuotedSticker) {
        sourceMsg = {
            message: msg.message.extendedTextMessage.contextInfo.quotedMessage,
            key: {
                remoteJid: chatId,
                fromMe: false,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            }
        };
    }

    if (!sourceMsg) {
        await sock.sendMessage(chatId, { text: '🖼️ Balas gambar atau stiker yang ingin diberi teks meme dengan *!smeme [teks]*' }, { quoted: msg });
        return true;
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Sedang membuat sticker meme...' }, { quoted: msg });

        const mediaBuffer = await downloadMediaMessage(sourceMsg, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage
        });

        const words = memeText.toUpperCase().split(/\s+/);
        let line1 = '';
        let line2 = '';

        if (words.length > 1 && memeText.length > 10) {
            const half = Math.ceil(words.length / 2);
            line1 = words.slice(0, half).join(' ');
            line2 = words.slice(half).join(' ');
        } else {
            line1 = words.join(' ');
        }

        const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const longestLine = line2.length > line1.length ? line2 : line1;
        let fontSize = 75;

        if (longestLine.length > 8) {
            if (longestLine.length <= 14) fontSize = 50;
            else if (longestLine.length <= 20) fontSize = 36;
            else fontSize = 26;
        }

        let posY = line2 ? 420 : 455;
        const lineHeight = fontSize + 5;

        const lengthAttr1 = (line1.length > 0 && line1.length <= 8) ? 'textLength="480" lengthAdjust="spacingAndGlyphs"' : '';
        const lengthAttr2 = (line2.length > 0 && line2.length <= 8) ? 'textLength="480" lengthAdjust="spacingAndGlyphs"' : '';

        const svgText = `
        <svg width="512" height="512">
            <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="2.5" dy="2.5" stdDeviation="1.5" flood-color="black" flood-opacity="0.85"/>
                </filter>
            </defs>
            <style>
                .meme-text {
                    fill: white;
                    stroke: #000000;
                    stroke-width: 3.5;
                    stroke-linejoin: round;
                    font-size: ${fontSize}px;
                    font-weight: 900;
                    font-family: sans-serif;
                    filter: url(#shadow);
                }
            </style>
            <text x="50%" y="${posY}" text-anchor="middle" class="meme-text">
                <tspan x="50%" ${lengthAttr1}>${escapeXml(line1)}</tspan>
                ${line2 ? `<tspan x="50%" dy="${lineHeight}" ${lengthAttr2}>${escapeXml(line2)}</tspan>` : ''}
            </text>
        </svg>
        `;

        const pngBuffer = await sharp(mediaBuffer)
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .composite([{
                input: Buffer.from(svgText),
                top: 0,
                left: 0
            }])
            .png()
            .toBuffer();

        const stickerBuffer = await encodeWebpSafe(pngBuffer, 80);
        const tagged = await addStickerMeta(stickerBuffer, STICKER_META);

        await sock.sendMessage(chatId, { sticker: tagged, pack: STICKER_META.pack, author: STICKER_META.author }, { quoted: msg });

    } catch (err) {
        console.error('❌ Error !smeme:', err);
        await sock.sendMessage(chatId, { text: '❌ Terjadi kesalahan saat memproses sticker meme.' }, { quoted: msg });
    }
    return true;
}

// ─── PLAY LIRIK — Cari Lagu + Lirik, Kirim Card Player & Audio (!playlirik) ───
const { renderPlayerCard } = require('./playerRenderer');

async function handlePlayLirik(ctx) {
    const { sock, msg, chatId, senderJid, body } = ctx;
    if (!body.toLowerCase().startsWith('!playlirik ')) return false;

    const query = body.slice(11).trim();
    if (!query) {
        await sock.sendMessage(chatId, { text: '⚠️ Tuliskan judul lagu yang ingin dicari!\nContoh: *!playlirik would you fall in love with me again*' }, { quoted: msg });
        return true;
    }

    await sock.sendMessage(chatId, { text: '⏳ Mencari lagu, lirik, dan menyiapkan audio... Mohon tunggu.' }, { quoted: msg });

    // 1. Cari lagu di YouTube
    let video;
    try {
        const searchResults = await ytSearch(query);
        if (!searchResults || !searchResults.videos || searchResults.videos.length === 0) {
            await sock.sendMessage(chatId, { text: '❌ Lagu tidak ditemukan. Coba gunakan kata kunci lain.' }, { quoted: msg });
            return true;
        }
        video = searchResults.videos[0];
    } catch (err) {
        console.error('❌ Error !playlirik search:', err);
        await sock.sendMessage(chatId, { text: `❌ Gagal mencari lagu: ${err.message}` }, { quoted: msg });
        return true;
    }

    const title = video.title;
    const artist = (video.author && video.author.name) || 'Unknown Artist';
    const duration = video.timestamp || '0:00';
    const videoId = video.videoId;
    const videoUrl = video.url;

    // 2. Ambil lirik via Genius (non-blok; kalau gagal, lanjut tanpa lirik)
    let lyrics = null;
    try {
        const { Client } = require('genius-lyrics');
        const genius = new Client();
        const results = await genius.songs.search(`${artist} ${title}`);
        if (results && results.length) {
            lyrics = await results[0].lyrics();
        }
    } catch (err) {
        console.warn('⚠️ Gagal ambil lirik:', err.message);
    }
    // Bersihkan noise Genius (header kontributor/terjemahan, penanda ad-lib [..])
    if (lyrics) {
        lyrics = lyrics
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !/(Contributors|Translations|Lyrics$|^\[)/.test(l))
            .join('\n');
    }

    // 3. Unduh cover art (YouTube thumbnail HQ) → base64 untuk card
    let coverBase64 = null;
    try {
        const axios = (await import('axios')).default;
        const thumbUrls = [
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            video.thumbnail,
        ].filter(Boolean);
        for (const u of thumbUrls) {
            try {
                const res = await axios.get(u, { responseType: 'arraybuffer', timeout: 8000, validateStatus: (s) => s === 200 });
                coverBase64 = Buffer.from(res.data).toString('base64');
                break;
            } catch { /* lanjut URL berikut */ }
        }
    } catch (err) {
        console.warn('⚠️ Gagal ambil cover art:', err.message);
    }

    // 4. Render card player → gambar (bila gagal, fallback teks)
    const captionCore = `🎵 *${title}*\n🎤 ${artist}\n⏱ ${duration}\n\n▶️ *YT MUSIC AUDIO*`;
    const cardImg = await renderPlayerCard({ title, artist, duration, coverBase64, lyrics });
    if (cardImg) {
        await sock.sendMessage(chatId, {
            image: cardImg,
            mimetype: 'image/png',
            caption: captionCore,
        }, { quoted: msg });
    } else {
        const lyText = lyrics
            ? lyrics.split('\n').slice(0, 12).join('\n')
            : '_(Lirik tidak tersedia)_';
        await sock.sendMessage(chatId, {
            text: `${captionCore}\n━━━━━━━━━━━━━\n*📝 LIRIK*\n${lyText}\n━━━━━━━━━━━━━`,
        }, { quoted: msg });
    }

    // 5. Unduh audio (reuse infrastruktur queue/download) & kirim sebagai file audio
    const timestamp = Date.now();
    const tmpFileTemplate = path.join(TMP_DIR, `tmp_dl_${timestamp}.%(ext)s`);
    const args = ['--js-runtimes', 'node', ...getFfmpegParam(), '--max-filesize', MAX_AUDIO_SIZE, '-f', 'ba[ext=m4a]/ba', '-o', tmpFileTemplate, videoUrl];
    await runQueuedDownload({
        sock, msg, chatId, senderJid,
        label: `${title} (Audio)`,
        bin: resolveYtDlp(), args, timestamp,
        resultHandler: async (downloadedFile) => {
            const actualExt = path.extname(downloadedFile).toLowerCase();
            let mimetype = 'audio/mp4';
            if (actualExt === '.webm') mimetype = 'audio/webm';
            else if (actualExt === '.ogg' || actualExt === '.opus') mimetype = 'audio/ogg';
            await sock.sendMessage(chatId, {
                audio: fs.readFileSync(downloadedFile),
                mimetype: mimetype,
                fileName: `${title}${actualExt}`
            }, { quoted: msg });
        }
    });

    return true;
}

module.exports = {
    handleSend,
    handleTovid,
    handleChange,
    handleTiktok,
    handlePlay,
    handlePlayLirik,
    handleSticker,
    handleToaudio,
    handleToimg,
    handleSmeme,
};