#!/usr/bin/env node
// 由 app-icon.mjs 重新生成 BaoCut 的全部图标生成物（仓库根运行）：
//   node tools/app-icon/render.mjs             写回仓库
//   node tools/app-icon/render.mjs --out DIR   只写到 DIR（预览用，不碰仓库）
// 位图在 Electron（仓库自带的 Chromium）的 canvas 里按目标像素各自绘制 SVG，不从大图缩小。
// 本文件直接用 node 运行时会以 Electron 重新拉起自己；依赖：node_modules/electron、macOS 的 iconutil。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { svg, VARIANTS } from './app-icon.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const require = createRequire(import.meta.url);

const outArg = process.argv.indexOf('--out');
const outDir = outArg > 0 ? path.resolve(process.argv[outArg + 1] ?? '') : null;
const target = (rel) => (outDir ? path.join(outDir, path.basename(rel)) : path.join(repo, rel));

const FINAL = VARIANTS.coral;
const PROTOTYPE_SVG = 'designs/baocut/assets/app-icon.svg';
const PNG_1024 = 'apps/desktop/build/icon.png';
const ICNS = 'apps/desktop/build/icon.icns';
const ICO = 'apps/desktop/build/icon.ico';

// iconutil 的 iconset 命名：逻辑尺寸 × 倍率。
const ICONSET = [16, 32, 128, 256, 512].flatMap((pt) => [
  [`icon_${pt}x${pt}.png`, pt],
  [`icon_${pt}x${pt}@2x.png`, pt * 2],
]);
// 与原 icon.ico 相同的九档，全部是 32 位 PNG 条目。
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((img) => img.data)]);
}

if (!process.versions.electron) {
  // 普通 node：换成 Electron 再跑一遍自己。
  const electron = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [url.fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env });
  process.exit(r.status ?? 1);
}

const { app, BrowserWindow } = require('electron');

// 一张页面把每个尺寸画成 PNG 的 data URL。macOS（icns、1024 PNG）带模板投影；Windows 的 ICO 不带，系统自己不画也不期待投影。
async function rasterize(jobs) {
  const html = `<!doctype html><meta charset="utf-8"><script>
    window.run = async (jobs) => {
      const out = [];
      for (const { key, svg, size } of jobs) {
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        await img.decode();
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size);
        out.push([key, c.toDataURL('image/png').split(',')[1]]);
      }
      return out;
    };
  </script>`;
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  const pairs = await win.webContents.executeJavaScript(`window.run(${JSON.stringify(jobs)})`);
  win.destroy();
  return new Map(pairs.map(([k, b64]) => [k, Buffer.from(b64, 'base64')]));
}

async function main() {
  const withShadow = svg(FINAL, { shadow: true });
  const flat = svg(FINAL, { shadow: false });
  const jobs = [
    { key: 'png1024', svg: withShadow, size: 1024 },
    ...ICONSET.map(([name, size]) => ({ key: `iconset:${name}`, svg: withShadow, size })),
    ...ICO_SIZES.map((size) => ({ key: `ico:${size}`, svg: flat, size })),
  ];
  const png = await rasterize(jobs);

  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(target(PROTOTYPE_SVG), withShadow);
  fs.writeFileSync(target(PNG_1024), png.get('png1024'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-icon-'));
  const iconset = path.join(tmp, 'icon.iconset');
  fs.mkdirSync(iconset);
  for (const [name] of ICONSET) fs.writeFileSync(path.join(iconset, name), png.get(`iconset:${name}`));
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', target(ICNS)]);
  fs.rmSync(tmp, { recursive: true, force: true });

  fs.writeFileSync(target(ICO), ico(ICO_SIZES.map((size) => ({ size, data: png.get(`ico:${size}`) }))));

  for (const rel of [PROTOTYPE_SVG, PNG_1024, ICNS, ICO]) console.log(`${target(rel)}  ${fs.statSync(target(rel)).size} B`);
}

// ESM 主进程里不能顶层 await app.whenReady()：ready 事件要等模块求值结束才发，会死锁。
app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (err) => {
      console.error(err);
      app.exit(1);
    },
  );
