// utils/sharp.js
// Pengganti Jimp menggunakan sharp (native, cepat, mendukung WebP).
// Teks dirender via SVG dengan font default sistem (tanpa file font eksternal).
const sharp = require('sharp');

function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Baca buffer/path gambar apa pun -> instance sharp
function readImage(bufferOrPath) {
    return sharp(bufferOrPath);
}

// SVG lingkaran
function circleSvg(width, height, cx, cy, r, fill, strokeColor, strokeWidth) {
    const strokeAttr = strokeColor
        ? ` stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="${fill || 'none'}"`
        : ` fill="${fill}"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<circle cx="${cx}" cy="${cy}" r="${r}"${strokeAttr}/></svg>`;
}

// Muat gambar muat dalam kanvas transparan `size`x`size` (diposisikan tengah)
async function containOnTransparent(image, size) {
    const resized = image
        .clone()
        .ensureAlpha()
        .resize(size, size, { fit: 'inside', withoutEnlargement: false });
    // CATATAN: sharp.metadata() mengembalikan dimensi SUMBER, bukan hasil resize.
    // Ukur dari PNG hasil render agar posisi tengah benar (mencegah gambar terbuang ke luar kanvas).
    const resizedPng = await resized.png().toBuffer();
    const meta = await sharp(resizedPng).metadata();
    const left = Math.floor((size - meta.width) / 2);
    const top = Math.floor((size - meta.height) / 2);
    return sharp({
        create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{ input: resizedPng, left, top }]);
}

// Baca buffer gambar apa pun (jpeg/png/webp) -> stiker webp 512x512 gaya contain (transparan).
// Seluruh foto terlihat (fit inside, TIDAK di-crop) di tengah kanvas transparan 512x512.
async function makeWebpSticker(buffer, quality = 85) {
    const canvas = await containOnTransparent(readImage(buffer), 512);
    return await encodeWebpSafe(await canvas.png().toBuffer(), quality);
}

// Encode PNG apa pun menjadi webp dengan ukuran dipastikan <= limit (default 95KB, aman utk batas 100KB WhatsApp).
// Kualitas diturunkan bertahap (85 -> 70 -> 55 -> 40 -> 30) sampai ukuran lolos.
async function encodeWebpSafe(pngBuffer, startQuality = 85, limit = 95 * 1024) {
    const qualities = Array.from(new Set([startQuality, 85, 70, 55, 40, 30])).sort((a, b) => b - a);
    let best = null;
    for (const q of qualities) {
        const out = await readImage(pngBuffer).webp({ quality: q }).toBuffer();
        if (out.length <= limit) return out;
        best = out;
    }
    return best;
}

// Potong lingkaran penuh (alpha mask dest-in). image = instance sharp
async function maskCircle(image, size) {
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
        `<rect width="${size}" height="${size}" fill="#000"/>` +
        `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`;
    return image.ensureAlpha().composite([{ input: Buffer.from(mask), blend: 'dest-in' }]);
}

// Isi lingkaran penuh dengan warna (composite SVG)
async function fillCircle(image, cx, cy, r, hexColor) {
    const meta = await image.metadata();
    const svg = circleSvg(meta.width, meta.height, cx, cy, r, hexColor, null, null);
    return image.composite([{ input: Buffer.from(svg), left: 0, top: 0, blend: 'over' }]);
}

// Lingkaran garis (border)
async function strokeCircle(image, cx, cy, r, hexColor, lineWidth = 1) {
    const meta = await image.metadata();
    const svg = circleSvg(meta.width, meta.height, cx, cy, r, null, hexColor, lineWidth);
    return image.composite([{ input: Buffer.from(svg), left: 0, top: 0, blend: 'over' }]);
}

// Tanam metadata stiker (pack/author) ke webp via wa-sticker-formatter.
// Dipakai karena pipeline EXIF otomatis Baileys di fork ini throw
// ("Bad header not RIFF") sehingga stiker terkirim raw tanpa metadata.
// Buffer hasil inilah yg benar-benar dikirim, jadi kita tanam di sini.
const { Exif } = require('wa-sticker-formatter');
async function addStickerMeta(buffer, { pack = 'yonn kulbet', author = 'yonn kulbet' } = {}) {
    try {
        return await new Exif({ pack, author }).add(buffer);
    } catch (e) {
        return buffer;
    }
}

// ─── TEKS ────────────────────────────────────────────────────
function textSvg(size, text, color, strokeWidth) {
    const strokeAttr = strokeWidth
        ? ` stroke="#000" stroke-width="${strokeWidth}" paint-order="stroke fill"`
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg">` +
        `<text x="0" y="${size}" font-family="sans-serif" font-weight="bold" font-size="${size}" fill="${color}"${strokeAttr}>` +
        `${escapeXml(text)}</text></svg>`;
}

const _renderCache = new Map();

// Render teks menjadi buffer PNG. Mengembalikan { buffer, width, height }.
// outlineWidth = 2*value (stroke penuh di kedua sisi, sama seperti printTextOutlined).
async function renderText(size, text, outlineWidth = 0) {
    const key = `${size}|${outlineWidth}|${text}`;
    if (_renderCache.has(key)) return _renderCache.get(key);
    const svg = textSvg(size, text, '#ffffff', outlineWidth * 2);
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const meta = await sharp(buffer).metadata();
    const info = { buffer, width: meta.width, height: meta.height };
    _renderCache.set(key, info);
    return info;
}

// Ukur lebar teks (render sementara, tanpa outline)
async function measureText(font, text) {
    if (!text) return 0;
    return (await renderText(font.size, text, 0)).width;
}

// Ukur lebar teks termasuk outline (agar teks dengan outline tidak terpotong di samping)
async function measureTextOutlined(font, text, outlineWidth = 2) {
    if (!text) return 0;
    return (await renderText(font.size, text, outlineWidth)).width;
}

// Cetak teks dengan outline. `y` = posisi atas buffer teks (bukan baseline).
async function printTextOutlined(image, { size, text, x, y, outlineWidth = 2, maxWidth = null }) {
    let actualText = text;
    if (maxWidth) {
        const white = { size, color: 'white' };
        while (actualText.length > 0 && (await measureTextOutlined(white, actualText, outlineWidth)) > maxWidth) {
            actualText = actualText.slice(0, -1);
        }
    }
    if (!actualText) return image;
    const info = await renderText(size, actualText, outlineWidth);
    return image.composite([{ input: info.buffer, left: x, top: y, blend: 'over' }]);
}

module.exports = {
    readImage,
    containOnTransparent,
    makeWebpSticker,
    encodeWebpSafe,
    maskCircle,
    fillCircle,
    strokeCircle,
    measureText,
    measureTextOutlined,
    renderText,
    printTextOutlined,
    addStickerMeta,
};
