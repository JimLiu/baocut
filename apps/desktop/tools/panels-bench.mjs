// 面板的端到端基准（`npm run bench:panels`，开发流程 §2 的可选检查；验收与测试 §4 的 M12 基线用它量）：真正的界面
// （`electron-vite build` 出的渲染进程生产构建，原样由本地 HTTP 服务提供）在无头 Chrome 里连上隔离的 Runtime，打开程序化合成的
// 大、小两档视频，量字幕、译文、文稿列表与时间线的挂载数、连续滚动的帧间隔、页签切换、时间线缩放一步与整片入镜、字幕全部替换与撤销。
//
// 准备：临时目录（Home、项目、下载、素材、Chrome 的用户目录）建在系统临时目录里，结束时（含失败与信号）删掉，仓库里不留东西。
// 素材由 ffmpeg 生成（纯色小画面 + 静音，时长按档位定，与 M12 基线的夹具同长、不短于转写）；隔离的 Runtime
// （`panels-bench-runtime.mts`：不注册智能体、不碰钥匙串、不发现局域网节点，网关只放行本地 HTTP 服务这一个来源）建好每档的项目与视频。
// 宿主桥与量具由 CDP 在页面脚本之前注入（`panels-bench-page.mjs`）；Typekit 一律拦下，别的非本机请求只记下来报出。
// 每档按次数新载入（同一个 Chrome 里重新导航），每次载入前等 1 分钟负载降到 3 以下（每 10 秒看一次，最多等 3 分钟，等不到照测），
// 跑完整套测量。最后报环境、每档规模，以及一张行与验收规格 §4 M12 基线一一对应的表（各次新载入的范围）。
//
// 用法：node apps/desktop/tools/panels-bench.mjs [--tier small|big]...（缺省两档，小档在前）[--runs 3] [--window 1440x900]
//       [--json <输出文件>]（每次的原始结果与环境）
// 环境：BAOCUT_ENGINE_HOST（缺省是 CARGO_TARGET_DIR 或仓库 target 下的 debug/engine-host），BAOCUT_FFMPEG / BAOCUT_FFPROBE，
//       BAOCUT_CHROME（缺省是 /Applications 下的 Google Chrome，再找 PATH 上的 google-chrome、chromium）。
// 退出码：0 跑完，1 有一次没跑完，2 超时或起不来。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, loadavg, platform, release, tmpdir, totalmem, type } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hostBridgeSource, installHelpers, runSuite } from './panels-bench-page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = resolve(HERE, '../out/renderer');
const ROOT = resolve(HERE, '../../..');
/** 一次新载入（打开视频到整套测量完）的时限。 */
const RUN_TIMEOUT_MS = 20 * 60_000;
/** 载入前等负载降下来：阈值、间隔、上限。 */
const LOAD_LIMIT = 3;
const LOAD_POLL_MS = 10_000;
const LOAD_WAIT_MS = 3 * 60_000;

/**
 * 两档的规模：字幕句数、时间线上的视频片段数（剪口数加一）、配音块数，以及素材时长（秒）。
 * 素材比转写长（转写约 35:55 与 2:59:35），与 M12 基线的夹具一样：剪掉剪口之后片长 44:00 与 3:40:00。
 * 片长决定 100% 时的时间线宽度与配音块的间距，挂载数也就跟着它，改了就和基线对不上。
 */
const TIERS = {
  small: { label: '小档', cues: 1000, clips: 200, dubs: 200, mediaSeconds: 45 * 60 },
  big: { label: '大档', cues: 5000, clips: 1000, dubs: 1000, mediaSeconds: 3 * 3600 + 45 * 60 },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function parseOptions(argv) {
  const options = { tiers: [], runs: 3, window: { width: 1440, height: 900 }, json: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tier') {
      const tier = argv[++i];
      if (!TIERS[tier]) throw new Error(`--tier 只能是 ${Object.keys(TIERS).join(' 或 ')}`);
      if (!options.tiers.includes(tier)) options.tiers.push(tier);
    } else if (arg === '--runs') options.runs = Number(argv[++i]);
    else if (arg === '--window') {
      const [width, height] = argv[++i].split('x').map(Number);
      options.window = { width, height };
    } else if (arg === '--json') options.json = resolve(argv[++i]);
    else throw new Error(`不认识的参数 ${arg}`);
  }
  if (options.tiers.length === 0) options.tiers = ['small', 'big'];
  else options.tiers.sort((a, b) => Object.keys(TIERS).indexOf(a) - Object.keys(TIERS).indexOf(b));
  if (!(options.runs >= 1)) throw new Error('--runs 至少是 1');
  return options;
}

/** 转写的长度（秒）：与 `panels-bench-runtime.mts` 的造法同一个算法（句长 3–10 词循环，每词 0.27 秒，句间 0.4 秒，从 0.3 秒起）。 */
function transcriptSeconds(cues) {
  let t = 0.3;
  for (let s = 0; s < cues; s++) t += (3 + ((s * 7) % 8)) * 0.27 + 0.4;
  return t;
}

const options = (() => {
  try {
    return parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
})();

// —— 清理：临时目录、Chrome、Runtime、HTTP 服务，任何出口都走一遍 ——
const children = [];
let temp = null;
let server = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  server?.close();
  server?.closeAllConnections?.();
  if (temp) {
    // Runtime 与 Chrome 收到信号之后还会写几下：先等它们退出，删到一半目录又不空就再删。
    const deadline = Date.now() + 5000;
    while (children.some((c) => c.exitCode === null && c.signalCode === null) && Date.now() < deadline) spawnSync('sleep', ['0.1']);
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
function exit(code) {
  cleanup();
  process.exit(code);
}
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => exit(2));
process.on('unhandledRejection', (error) => {
  console.error(error);
  exit(2);
});

main().catch((error) => {
  console.error(error);
  exit(2);
});

async function main() {
  if (!existsSync(join(RENDERER, 'index.html'))) {
    console.error(`没有 ${join(RENDERER, 'index.html')}：先运行 npm run build`);
    exit(2);
  }
  const engineHost = process.env.BAOCUT_ENGINE_HOST || join(process.env.CARGO_TARGET_DIR || join(ROOT, 'target'), 'debug/engine-host');
  if (!existsSync(engineHost)) {
    console.error(`没有 ${engineHost}：先 cargo build -p engine-host，或用 BAOCUT_ENGINE_HOST 指定`);
    exit(2);
  }
  const chromeBinary = findChrome();
  if (!chromeBinary) {
    console.error('找不到 Chrome：装 Google Chrome，或用 BAOCUT_CHROME 指定可执行文件');
    exit(2);
  }
  const ffmpeg = process.env.BAOCUT_FFMPEG || 'ffmpeg';
  const ffprobe = process.env.BAOCUT_FFPROBE || 'ffprobe';

  temp = mkdtempSync(join(tmpdir(), 'baocut-panels-bench-'));
  const dirs = {
    home: join(temp, 'home'),
    projects: join(temp, 'projects'),
    downloads: join(temp, 'downloads'),
    media: join(temp, 'media'),
    chrome: join(temp, 'chrome-profile'),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir);

  // 素材：纯色小画面 + 静音，时长按档位（不短于转写）。生成后用 ffprobe 核对时长够不够。
  const tiers = [];
  for (const key of options.tiers) {
    const tier = TIERS[key];
    const need = transcriptSeconds(tier.cues);
    const seconds = tier.mediaSeconds;
    if (seconds < need) throw new Error(`${tier.label}素材 ${seconds} 秒，短于转写的 ${need.toFixed(1)} 秒`);
    const file = join(dirs.media, `panels-${key}.mp4`);
    const started = Date.now();
    const made = spawnSync(ffmpeg, [
      ...['-v', 'error', '-f', 'lavfi', '-i', `color=c=0x303840:s=160x90:r=30:d=${seconds}`],
      ...['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${seconds}`],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file],
    ]);
    if (made.error || made.status !== 0) throw new Error(`ffmpeg 生成${tier.label}素材失败：${made.error?.message ?? made.stderr}`);
    const probed = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    const duration = Number(probed.stdout.trim());
    if (probed.status !== 0 || !(duration >= need)) {
      throw new Error(`${tier.label}素材时长 ${probed.stdout.trim() || probed.stderr} 秒，不够转写的 ${need.toFixed(1)} 秒`);
    }
    console.error(
      `${tier.label}素材 ${duration.toFixed(1)} 秒（转写 ${need.toFixed(1)} 秒），生成用了 ${((Date.now() - started) / 1000).toFixed(1)} 秒`,
    );
    tiers.push({ key, ...tier, media: file, mediaSeconds: duration });
  }

  // 本地 HTTP 服务先起：Runtime 的网关要知道放行的来源（端口）。
  server = createServer((request, response) => {
    const rel = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    const file = resolve(RENDERER, `.${rel === '/' ? '/index.html' : rel}`);
    if (!file.startsWith(RENDERER + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise((done, fail) => server.once('error', fail).listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const env = {
    ...process.env,
    BAOCUT_HOME: dirs.home,
    BAOCUT_PROJECTS_DIR: dirs.projects,
    BAOCUT_DOWNLOADS_DIR: dirs.downloads,
    BAOCUT_ENGINE_HOST: engineHost,
    // 不经登录 shell 找 PATH（不跑 shell 配置）：ffprobe / ffmpeg 用当前 PATH 或 BAOCUT_FFPROBE / BAOCUT_FFMPEG。
    SHELL: '/usr/bin/false',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const spec = tiers.map((t) => ({
    tier: t.key,
    project: `panels-${t.key}`,
    video: t.label,
    media: t.media,
    cues: t.cues,
    clips: t.clips,
    dubs: t.dubs,
  }));
  const runtime = spawn(process.execPath, [join(HERE, 'panels-bench-runtime.mts'), '--tiers', JSON.stringify(spec), '--origin', origin], {
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(runtime);
  const started = Date.now();
  const ready = await new Promise((done) => {
    const timer = setTimeout(() => done(null), 10 * 60_000);
    runtime.on('exit', () => done(null));
    createInterface({ input: runtime.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line);
        if (message.type === 'ready') {
          clearTimeout(timer);
          done(message);
        }
      } catch {
        // 不是就绪消息，忽略。
      }
    });
  });
  if (!ready) {
    console.error('隔离的 Runtime 没有起来');
    exit(2);
  }
  console.error(`Runtime 就绪，造夹具用了 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
  for (const t of tiers) t.scale = ready.tiers.find((s) => s.tier === t.key);
  const discovery = JSON.parse(readFileSync(join(dirs.home, 'runtime.json'), 'utf8'));

  // 无头 Chrome：调试端口由 Chrome 自己挑（写进用户目录的 DevToolsActivePort），不占固定端口。
  const chrome = spawn(
    chromeBinary,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${dirs.chrome}`,
      `--window-size=${options.window.width},${options.window.height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--lang=zh-CN',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  children.push(chrome);
  const portFile = join(dirs.chrome, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !(existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n')); i++) await sleep(100);
  if (!existsSync(portFile)) {
    console.error('Chrome 没有起来（没有 DevToolsActivePort）');
    exit(2);
  }
  const debugPort = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const target = targets.find((t) => t.type === 'page');
  if (!target) {
    console.error('Chrome 里没有页面');
    exit(2);
  }
  const page = await connect(target.webSocketDebuggerUrl);
  const version = await page.send('Browser.getVersion');

  // 非本机的请求：Typekit 拦下，其余记下来报出（页面本该只连本机）。
  const external = new Set();
  let typekit = 0;
  page.on('Network.requestWillBeSent', ({ request }) => {
    if (/^(data|blob):/.test(request.url) || /^(https?|wss?):\/\/127\.0\.0\.1[:/]/.test(request.url)) return;
    if (/typekit/.test(request.url)) typekit++;
    else external.add(request.url);
  });
  await page.send('Network.enable');
  await page.send('Network.setBlockedURLs', { urls: ['*typekit*'] });
  await page.send('Page.enable');
  await page.send('Emulation.setLocaleOverride', { locale: 'zh-CN' });
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `${hostBridgeSource({ endpoint: discovery.endpoint, token: discovery.token }, platform())}\n(${installHelpers.toString()})();`,
  });

  const env0 = environment(version.product, options.window);
  printEnvironment(env0);
  let failed = 0;
  let timedOut = 0;
  for (const tier of tiers) {
    tier.runs = [];
    for (let n = 1; n <= options.runs; n++) {
      const loadBefore = await waitForLoad();
      console.error(`== ${tier.label} 第 ${n}/${options.runs} 次新载入，1 分钟负载 ${loadBefore.toFixed(2)}`);
      await page.send('Page.navigate', { url: `${origin}/` });
      const runStarted = Date.now();
      let timer;
      try {
        const suite = runSuite(page, {
          video: tier.label,
          log: (step) => console.error(`  ${step} 完（${((Date.now() - runStarted) / 1000).toFixed(0)} 秒）`),
        });
        // 超时之后这一套还挂在页面里：下一次导航会让它报错，不能当成未处理的拒绝。
        suite.catch(() => {});
        const result = await Promise.race([
          suite,
          new Promise((_, fail) => {
            timer = setTimeout(
              () => fail(Object.assign(new Error(`${RUN_TIMEOUT_MS / 60_000} 分钟没有跑完`), { timeout: true })),
              RUN_TIMEOUT_MS,
            );
          }),
        ]);
        tier.runs.push({ run: n, loadBefore, loadAfter: loadavg()[0], seconds: Math.round((Date.now() - runStarted) / 1000), ...result });
      } catch (error) {
        if (error?.timeout) timedOut++;
        else failed++;
        const message = error instanceof Error ? error.message : String(error);
        tier.runs.push({ run: n, loadBefore, loadAfter: loadavg()[0], error: message });
        console.error(`${tier.label} 第 ${n} 次：${message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  page.close();

  console.log('');
  printEnvironment(env0, tiers, console.log);
  for (const tier of tiers) console.log(scaleLine(tier));
  console.log('');
  console.log(table(tiers));
  console.log(
    `\n拦下 Typekit 的请求 ${typekit} 个；其他非本机的请求 ${external.size} 个${external.size > 0 ? `：${[...external].slice(0, 5).join('、')}` : ''}`,
  );
  // 素材路径在临时目录里，结束就删了，不写进结果。
  if (options.json)
    writeFileSync(options.json, JSON.stringify({ env: env0, tiers: tiers.map(({ media: _media, ...tier }) => tier) }, null, 1));
  exit(timedOut > 0 ? 2 : failed > 0 ? 1 : 0);
}

function findChrome() {
  if (process.env.BAOCUT_CHROME) return existsSync(process.env.BAOCUT_CHROME) ? process.env.BAOCUT_CHROME : null;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 载入前等 1 分钟负载降到阈值以下；最多等 LOAD_WAIT_MS，等不到照测。返回开测时的负载。 */
async function waitForLoad() {
  const deadline = Date.now() + LOAD_WAIT_MS;
  while (loadavg()[0] >= LOAD_LIMIT && Date.now() < deadline) await sleep(LOAD_POLL_MS);
  return loadavg()[0];
}

/** 极简的 CDP 客户端（Node 自带的 WebSocket）：send 发命令，on 收事件，ev 在页面里求值一段 async 函数体并取回结果。 */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((done, fail) => {
    ws.addEventListener('open', done, { once: true });
    ws.addEventListener('error', () => fail(new Error(`连不上 ${url}`)), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { done, fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(`${message.error.message}${message.error.data ? `：${message.error.data}` : ''}`));
      else done(message.result);
    } else if (message.method) handlers.get(message.method)?.(message.params);
  });
  ws.addEventListener('close', () => {
    for (const { fail } of pending.values()) fail(new Error('与 Chrome 的连接断了'));
    pending.clear();
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const i = ++id;
      pending.set(i, { done, fail });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (body) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails)
      throw new Error(`页面里出错：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`.slice(0, 1500));
    return r.result?.value;
  };
  return { send, ev, sleep, on: (method, fn) => handlers.set(method, fn), close: () => ws.close() };
}

function environment(chrome, window) {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() ?? '';
  const macos = process.platform === 'darwin' ? spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout?.trim() : '';
  return {
    cpu: cpus()[0]?.model ?? '?',
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: macos ? `macOS ${macos}` : `${type()} ${release()}`,
    chrome,
    commit: git(['rev-parse', '--short', 'HEAD']),
    dirty: git(['status', '--porcelain', '--untracked-files=no']) !== '',
    window,
  };
}

function printEnvironment(env, tiers = null, print = console.error) {
  const loads = tiers
    ? tiers.map((t) => `${t.label} ${t.runs.map((r) => `${r.loadBefore.toFixed(1)}→${r.loadAfter.toFixed(1)}`).join('、')}`).join('；')
    : null;
  const inner = tiers?.flatMap((t) => t.runs).find((r) => r.window)?.window;
  print(
    `环境：${env.cpu}（${env.cores} 核）、${env.memoryGB} GB、${env.os}；commit ${env.commit}${env.dirty ? '（有未提交的改动）' : ''}；` +
      `${env.chrome}（无头），窗口 ${env.window.width}×${env.window.height}${inner ? `，页面 ${inner.innerW}×${inner.innerH}` : ''}，屏蔽 Typekit` +
      (loads ? `；1 分钟负载（开测→测完）：${loads}` : ''),
  );
}

function clock(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function scaleLine(tier) {
  const s = tier.scale;
  const ok = tier.runs.filter((r) => !r.error);
  const paragraphs = spread(ok.map((r) => r.lists.transcript.mounted.setsize));
  const bands = spread(ok.map((r) => r.timeline.fit[0]?.bands));
  const items = Object.values(s.items).reduce((a, b) => a + b, 0);
  const parts = [`${s.items.video ?? 0} 个视频片段`, `${s.items.audio ?? 0} 个配音块`, `${s.items.caption ?? 0} 条字幕`];
  return (
    `${tier.label}：${s.cues} 句字幕、${s.words} 词转写（${paragraphs || '?'} 段）、${s.translations} 句译文，` +
    `时间线 ${items} 件（${parts.join('、')}）与 ${bands || s.cuts} 条剪口带（剪口 ${s.cuts} 个），片长 ${clock(s.seconds)}（转写 ${clock(s.transcriptSeconds)}）`
  );
}

/** 一组数的范围：都一样写一个，否则「最小–最大」。 */
function spread(values, unit = '') {
  const v = values.filter((x) => typeof x === 'number');
  if (v.length === 0) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`;
}

/** 一组最长任务（longtask 只报 ≥ 50 ms，没有记 0）：都没有、都有、或「N 次里 k 次」。 */
function longest(values) {
  if (values.length === 0) return '—';
  const hit = values.filter((v) => v > 0);
  if (hit.length === 0) return '没有 ≥ 50 ms 的任务';
  if (hit.length === values.length) return spread(hit, ' ms');
  return `${values.length} 次里 ${hit.length} 次 ${spread(hit, ' ms')}`;
}

/** 行与验收规格 §4 的 M12 基线表一一对应；每格是这一档各次新载入的范围，大档与小档相同时写「同左」。 */
function table(tiers) {
  const runsOf = (tier) => tier.runs.filter((r) => !r.error);
  const all = (fn) => tiers.flatMap((t) => runsOf(t).map(fn));
  const viewport = (fn) => spread(all(fn), ' px') || '?';
  const isEnter = (name) => name.endsWith('-to-translation');
  const rows = [
    [
      `字幕列表挂载（滚到中段，视口高 ${viewport((r) => r.lists.captions.mounted.viewportH)}）：行 / 元素`,
      (runs) =>
        mounts(
          runs.map((r) => r.lists.captions.mounted),
          ['rows', 'elements'],
        ),
    ],
    [
      `译文列表挂载（视口高 ${viewport((r) => r.lists.translation.mounted.viewportH)}）：行 / 元素`,
      (runs) =>
        mounts(
          runs.map((r) => r.lists.translation.mounted),
          ['rows', 'elements'],
        ),
    ],
    [
      `文稿挂载（视口高 ${viewport((r) => r.lists.transcript.mounted.viewportH)}）：段 / 元素`,
      (runs) =>
        mounts(
          runs.map((r) => r.lists.transcript.mounted),
          ['rows', 'elements'],
        ),
    ],
    [
      `时间线 100% 挂载（视口宽 ${viewport((r) => r.timeline['scroll 100%'].mounted.viewportW)}）：件 / 剪口带 / 元素`,
      (runs) =>
        mounts(
          runs.map((r) => r.timeline['scroll 100%'].mounted),
          ['clips', 'bands', 'elements'],
        ),
    ],
    [
      '时间线最大缩放挂载：件 / 剪口带 / 元素',
      (runs) =>
        mounts(
          runs.map((r) => r.timeline['scroll max'].mounted),
          ['clips', 'bands', 'elements'],
        ),
    ],
    [
      '列表与时间线（100%、最大缩放）连续滚动的帧间隔 P95',
      (runs) => {
        const series = runs.flatMap((r) => [...Object.values(r.lists), r.timeline['scroll 100%'], r.timeline['scroll max']]);
        const p95 = spread(
          series.flatMap((s) => [s.scroll.p95, s.fast.p95]),
          ' ms',
        );
        const over = series.reduce((a, s) => a + s.scroll.over50 + s.fast.over50, 0);
        return `${p95}，${over === 0 ? '没有超过 50 ms 的帧' : `${series.length * 2} 段里共 ${over} 帧超过 50 ms`}`;
      },
    ],
    [
      '时间线缩放一步（100% 与相邻一级之间）',
      (runs) => longest(runs.flatMap((r) => [...r.timeline.zoomIn, ...r.timeline.zoomOut].map((x) => x.longest))),
    ],
    ['整片入镜（件全部挂上）', (runs) => longest(runs.flatMap((r) => r.timeline.fit.map((x) => x.longest)))],
    [
      '页签切换：文稿、字幕、元素之间',
      (runs) =>
        longest(
          runs.flatMap((r) =>
            Object.entries(r.tabs)
              .filter(([name]) => !isEnter(name))
              .flatMap(([, xs]) => xs.map((x) => x.longest)),
          ),
        ),
    ],
    [
      '页签切换：进入译文（原文＋译文）',
      (runs) =>
        longest(
          runs.flatMap((r) =>
            Object.entries(r.tabs)
              .filter(([name]) => isEnter(name))
              .flatMap(([, xs]) => xs.map((x) => x.longest)),
          ),
        ),
    ],
    [
      '字幕全部替换 / 撤销',
      (runs) => {
        const reps = runs.flatMap((r) => r.replace);
        const hits = spread(reps.map((x) => x.hits));
        const bad = reps.filter((x) => x.hitsAfterReplace !== 0 || x.hitsAfterUndo !== x.hits).length;
        return (
          `${hits} 处命中：${longest(reps.map((x) => x.replaceAll.longest))} / ${longest(reps.map((x) => x.undo.longest))}` +
          (bad > 0 ? `（${bad} 次核对不符：替换后仍有命中或撤销后没回到原数）` : '')
        );
      },
    ],
  ];
  const out = [`| 项目 | ${tiers.map((t) => t.label).join(' | ')} |`, `| --- | ${tiers.map(() => '---').join(' | ')} |`];
  const runsByTier = tiers.map(runsOf);
  for (const [label, cell] of rows) {
    const cells = runsByTier.map((runs) => {
      if (runs.length === 0) return '没跑完';
      try {
        return cell(runs);
      } catch {
        return '?';
      }
    });
    for (let i = cells.length - 1; i > 0; i--) if (runsByTier[i].length > 0 && cells[i] === cells[i - 1]) cells[i] = '同左';
    out.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  out.push('');
  out.push(
    '说明：挂载取各次新载入滚到中段（时间线 100% 与最大缩放各在 50% 处）的数；滚动含每帧 40 px 与 200 px 两种，各 240 帧；' +
      '操作格是最长任务（longtask，只报 ≥ 50 ms 的任务）在各次里的范围，「N 次里 k 次」表示其余各次没有 ≥ 50 ms 的任务；' +
      '「文稿、字幕、元素之间」含离开译文的三对，「进入译文」是从文稿、字幕、元素进入原文＋译文的三对，各两轮。',
  );
  return out.join('\n');
}

function mounts(list, keys) {
  return keys.map((key) => spread(list.map((m) => m[key]))).join(' / ');
}
