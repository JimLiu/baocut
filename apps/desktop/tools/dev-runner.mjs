// `npm run dev` 的入口：在 dev-process-group.mjs 的监管下跑 `electron-vite dev`（命令行参数原样传过去）。关掉终端、Ctrl+C 或
// 上层按 pid 停止时 electron-vite、Electron 与 Runtime 一起收尾，卡住的强杀。

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { superviseDevProcess } from './dev-process-group.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 直接用当前的 Node 跑 electron-vite 的入口：不经 `node_modules/.bin`（Windows 上是 .cmd，要经 shell）。
const require = createRequire(import.meta.url);
const manifestPath = require.resolve('electron-vite/package.json');
const entry = path.join(path.dirname(manifestPath), require(manifestPath).bin['electron-vite']);

superviseDevProcess(process.execPath, [entry, 'dev', ...process.argv.slice(2)], { cwd: desktopDir });
