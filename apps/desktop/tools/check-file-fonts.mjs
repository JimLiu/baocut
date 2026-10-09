// 打包产物的字体检查（`npm run check:file-fonts`）：在 Electron 里以 file:// 打开渲染进程的生产构建（`out/renderer/index.html`），
// 经产物里的自检入口（`src/renderer/kernel-check.ts`）走预览同一条载入路，核对渲染内核拿到了随产物发布的每一份字体，
// 并经内核量出一个文字框。规则见架构设计 §9.1；检查依赖什么见开发流程 §2。
//
// 同一个文件两种身份：用 node 运行时准备临时目录、启动 Electron 并看住总时限；Electron 以它为主进程时做检查。
// 检查自己的主进程只开一个隐藏窗口：不启动 Runtime（因而不碰钥匙串、不启动任何智能体），不读写真实的应用数据目录，
// 除 file:、data:、blob: 以外的请求一律拦下（不联网）。退出码：0 通过，1 不通过，2 超时或起不来。

import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --out=<Resources/app.asar/out> also checks the final packaged font layout.
const OUT = resolve(process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) ?? resolve(dirname(fileURLToPath(import.meta.url)), '../out'));
/** Electron 里的检查自己的时限；外面再多给一些，连 Electron 起不来、卡住也收得住。 */
const CHECK_TIMEOUT_MS = 60_000;
const LAUNCH_TIMEOUT_MS = 90_000;
/** 产物里的字体文件名是 `<原名>-<8 位哈希>.ttf`。 */
const HASHED_FONT = /^(.+)-[A-Za-z0-9_-]{8}\.ttf$/;

// 不在顶层 await：ESM 的主进程模块求值完之前 Electron 不发 ready，在顶层等 ready 会卡死。
(process.versions.electron ? check() : launch()).catch((error) => {
  console.error(error);
  process.exit(2);
});

/** node 一侧：临时的 Home、项目、下载与 Electron 数据目录，启动 Electron，超时就杀掉，结束后删掉临时目录。 */
async function launch() {
  for (const file of ['renderer/index.html', 'preload/index.js']) {
    // Plain Node cannot read ASAR paths; the Electron child validates them.
    if (!OUT.includes('app.asar') && !existsSync(join(OUT, file))) {
      console.error(`没有 ${join(OUT, file)}：先运行 npm run build`);
      process.exit(2);
    }
  }
  const { default: electron } = await import('electron');
  const temp = mkdtempSync(join(tmpdir(), 'baocut-file-fonts-'));
  const dirs = { home: join(temp, 'home'), projects: join(temp, 'projects'), downloads: join(temp, 'downloads') };
  for (const dir of Object.values(dirs)) mkdirSync(dir);
  const env = { ...process.env, BAOCUT_HOME: dirs.home, BAOCUT_PROJECTS_DIR: dirs.projects, BAOCUT_DOWNLOADS_DIR: dirs.downloads };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const { spawn } = await import('node:child_process');
  const child = spawn(electron, [fileURLToPath(import.meta.url), `--baocut-temp=${temp}`, `--out=${OUT}`], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const timer = setTimeout(() => {
    console.error(`Electron ${LAUNCH_TIMEOUT_MS / 1000} 秒没有结束，杀掉`);
    child.kill('SIGKILL');
  }, LAUNCH_TIMEOUT_MS);
  const code = await new Promise((done) => {
    child.on('error', (error) => {
      console.error('Electron 起不来', error);
      done(2);
    });
    child.on('exit', (exitCode, signal) => done(exitCode ?? (signal ? 2 : 1)));
  });
  clearTimeout(timer);
  rmSync(temp, { recursive: true, force: true });
  process.exit(code);
}

/** Electron 一侧：隐藏窗口以 file:// 打开产物，调自检入口，核对字体与量出来的框。 */
async function check() {
  const { app, BrowserWindow, ipcMain, session } = await import('electron');
  const temp = process.argv.find((arg) => arg.startsWith('--baocut-temp='))?.slice('--baocut-temp='.length);
  if (!temp) throw new Error('缺少 --baocut-temp：用 node 运行这个脚本');
  // Electron 自己的数据（缓存、Cookie、日志、崩溃转储）也落在临时目录。
  for (const name of ['userData', 'sessionData', 'logs', 'crashDumps']) app.setPath(name, join(temp, 'electron', name));
  app.dock?.hide();

  const notes = [];
  const finish = (code, message) => {
    if (code !== 0) for (const note of notes) console.error(note);
    (code === 0 ? console.log : console.error)(message);
    app.exit(code);
  };
  setTimeout(() => finish(2, `检查 ${CHECK_TIMEOUT_MS / 1000} 秒没有结束`), CHECK_TIMEOUT_MS).unref();
  app.on('window-all-closed', () => {});

  await app.whenReady();
  const blocked = [];
  const fontLoads = new Map();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const local = /^(file|data|blob|devtools):/.test(details.url);
    if (!local) blocked.push(details.url);
    callback({ cancel: !local });
  });
  session.defaultSession.webRequest.onCompleted({ urls: ['file://*/*'] }, (details) => {
    if (details.url.endsWith('.ttf')) fontLoads.set(basename(fileURLToPath(details.url)), details.statusCode);
  });
  // 页面照常向主进程要 Runtime 的连接与更新状态：这里不启动 Runtime、不查更新，一直不答（页面停在连接中）。
  for (const channel of ['baocut:connection', 'baocut:updates-get']) ipcMain.handle(channel, () => new Promise(() => {}));

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(OUT, 'preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', ({ level, message }) => notes.push(`[renderer:${level}] ${message}`));
  win.webContents.on('render-process-gone', (_event, details) => finish(1, `渲染进程退出：${details.reason}`));

  const assets = join(OUT, 'renderer/assets');
  let shipped = readdirSync(assets).flatMap((name) => {
    const match = HASHED_FONT.exec(name);
    return match ? [{ file: name, font: `${match[1]}.ttf` }] : [];
  });
  if (shipped.length === 0) {
    const manifest = JSON.parse(readFileSync(resolve(OUT, '../../web/assets/bundled-fonts.json'), 'utf8'));
    shipped = Object.entries(manifest).map(([font, file]) => ({ font, file }));
  }
  const entry = readdirSync(assets).find((name) => /^kernel-check-.*\.js$/.test(name));
  if (!entry) return finish(1, `${assets} 里没有自检入口 kernel-check-*.js：渲染进程的构建没有带上它`);

  try {
    await win.loadFile(join(OUT, 'renderer/index.html'));
    const page = win.webContents.getURL();
    if (!page.startsWith('file:')) return finish(1, `页面不在 file:// 下：${page}`);
    const result = await win.webContents.executeJavaScript(
      `import(${JSON.stringify(pathToFileURL(join(assets, entry)).href)}).then(() => globalThis.baocutKernelCheck())`,
      true,
    );
    const injected = [...result.fonts].sort();
    const expected = shipped.map((item) => item.font).sort();
    const problems = [];
    if (expected.length === 0) problems.push('产物里没有字体');
    if (JSON.stringify(injected) !== JSON.stringify(expected)) {
      const missing = expected.filter((name) => !injected.includes(name));
      const extra = injected.filter((name) => !expected.includes(name));
      problems.push(
        `内核注入的字体与产物里的不一致：产物有、内核没有 ${missing.join('、') || '无'}；内核要、产物没有 ${extra.join('、') || '无'}`,
      );
    }
    // 读字体的 XHR 在 file:// 下没有 HTTP 状态（0）或是 200；请求要逐份看到。
    const unread = shipped.filter((item) => ![0, 200].includes(fontLoads.get(item.file)));
    if (unread.length > 0) problems.push(`没有看到这些字体经 file:// 读成功：${unread.map((item) => item.file).join('、')}`);
    if (!(result.box.width > 0 && result.box.height > 0)) problems.push(`内核量出的框不对：${JSON.stringify(result.box)}`);
    if (problems.length > 0) return finish(1, problems.join('\n'));
    finish(
      0,
      `file:// 字体检查通过：${page}\n` +
        `  ${injected.length} 份字体经 file:// 读到并注入渲染内核，经内核量出的框 ${result.box.width}×${result.box.height}；` +
        `拦下的网络请求 ${blocked.length} 个`,
    );
  } catch (error) {
    finish(1, `渲染内核没有载入：${error instanceof Error ? error.message : String(error)}`);
  }
}
