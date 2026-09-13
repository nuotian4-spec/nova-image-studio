/**
 * 从 frontend/brand-maixun.png 生成页头横标与 PWA 方标。
 * 用法: node scripts/generate-icons.js
 *
 * 源图是黑底横构图：先把近黑抠成透明并裁到图形包围盒，
 * 页头用透明横标；系统图标再放到深底正方形上。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'brand-maixun.png');
const PUBLIC = path.join(FRONTEND, 'public');
const APP = path.join(FRONTEND, 'src', 'app');
const sharp = require(require.resolve('sharp', { paths: [FRONTEND, ROOT] }));

const ICON_BG = { r: 11, g: 11, b: 11, alpha: 1 };
const BLACK_THRESHOLD = 12;
const SQUARE_PAD = 0.12;

const tasks = [
    { out: 'icon-192.png', size: 192, maskable: false },
    { out: 'icon-512.png', size: 512, maskable: false },
    { out: 'icon-maskable-512.png', size: 512, maskable: true },
    { out: 'favicon.png', size: 48, maskable: false },
];

async function extractTransparentMark(inputPath) {
    const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < width * height; i += 1) {
        const o = i * channels;
        const r = data[o];
        const g = data[o + 1];
        const b = data[o + 2];
        const a = data[o + 3];
        if (a === 0 || (r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD)) {
            data[o + 3] = 0;
            continue;
        }
        const x = i % width;
        const y = (i / width) | 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    if (maxX < minX || maxY < minY) {
        throw new Error('未能从源图中提取到非黑色图形');
    }
    const pad = 8;
    const left = Math.max(0, minX - pad);
    const top = Math.max(0, minY - pad);
    const cropW = Math.min(width - left, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(height - top, maxY - minY + 1 + pad * 2);
    return sharp(data, { raw: { width, height, channels: 4 } })
        .extract({ left, top, width: cropW, height: cropH })
        .png();
}

async function writeSquareIcon(markBuffer, dst, size, maskable) {
    const padding = Math.round(size * (maskable ? 0.1 : SQUARE_PAD));
    const inner = Math.max(1, size - padding * 2);
    const resized = await sharp(markBuffer)
        .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    const meta = await sharp(resized).metadata();
    const left = Math.round((size - (meta.width || inner)) / 2);
    const top = Math.round((size - (meta.height || inner)) / 2);
    await sharp({
        create: {
            width: size,
            height: size,
            channels: 4,
            background: ICON_BG,
        },
    })
        .composite([{ input: resized, left, top }])
        .png()
        .toFile(dst);
}

(async () => {
    if (!fs.existsSync(SRC)) {
        console.error('❌ 找不到源文件:', SRC);
        process.exit(1);
    }

    const srcMeta = await sharp(SRC).metadata();
    console.log(`📐 源图: ${srcMeta.width}x${srcMeta.height}, format=${srcMeta.format}`);

    const markPipeline = await extractTransparentMark(SRC);
    const markBuffer = await markPipeline.toBuffer();
    const markMeta = await sharp(markBuffer).metadata();
    console.log(`✂️ 横标: ${markMeta.width}x${markMeta.height}`);

    const headerHeight = 128;
    const headerWidth = Math.round((markMeta.width / markMeta.height) * headerHeight);
    const brandMarkPath = path.join(PUBLIC, 'brand-mark.png');
    await sharp(markBuffer)
        .resize(headerWidth, headerHeight, { fit: 'fill' })
        .png()
        .toFile(brandMarkPath);
    console.log(`✅ brand-mark.png (${headerWidth}x${headerHeight}, 透明横标)`);

    for (const { out, size, maskable } of tasks) {
        const dst = path.join(PUBLIC, out);
        await writeSquareIcon(markBuffer, dst, size, maskable);
        console.log(`✅ ${out} (${size}x${size}${maskable ? ', maskable' : ''})`);
    }

    fs.copyFileSync(path.join(PUBLIC, 'favicon.png'), path.join(APP, 'favicon.png'));
    console.log('📋 已同步 src/app/favicon.png');

    const crypto = require('crypto');
    const swPath = path.join(PUBLIC, 'sw.js');
    if (fs.existsSync(swPath)) {
        let sw = fs.readFileSync(swPath, 'utf-8');
        const hashed = [...tasks.map((item) => item.out), 'brand-mark.png'];
        for (const out of hashed) {
            const filePath = path.join(PUBLIC, out);
            if (!fs.existsSync(filePath)) continue;
            const hash = crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
            const url = `/${out}`;
            const re = new RegExp(`\\{url:"${url.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}",revision:"[a-f0-9]+"\\}`);
            const replacement = `{url:"${url}",revision:"${hash}"}`;
            if (re.test(sw)) {
                sw = sw.replace(re, replacement);
                console.log(`🔄 sw.js: ${url} → ${hash}`);
            }
        }
        sw = sw.replace(/\{url:"\/favicon\.jpg",revision:"[a-f0-9]+"\},?/, '');
        fs.writeFileSync(swPath, sw);
        console.log('✅ sw.js 已更新');
    }

    console.log('\n🎉 所有图标已生成完毕！');
})();
