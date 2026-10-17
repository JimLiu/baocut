/**
 * Electron 离屏宿主的主进程脚本（CommonJS 源码，作为字符串随 bundle 分发）。
 *
 * `composition-host.ts` 把它连同 `COMPOSITION_ADAPTER_SCRIPT` 写进缓存目录的 `host-<摘要>.cjs`，以 `<Electron> --composition-host <脚本>` 启动（`hostSpawnArgs`）。
 * 协议同 `JsonLineWorker`：stdin 每行一个请求 `{id, method, params}`，stdout 每行一个响应或事件；日志写 stderr。
 *
 * - 启动后（`app.whenReady()` 之后）发事件 `ready`；stdin 关闭即退出。不用顶层 await：ready 要等脚本求值结束才发。
 * - `open`：每个会话一个非持久分区、一个隐藏的离屏窗口；拦截根目录以外的 `file:` 与一切 `data:` / `blob:` / `about:` /
 *   `devtools:` 以外的请求（事件 `networkBlocked`），拒绝全部权限请求与导航、弹窗。
 * - `frame`：同一会话串行；seek → 回读校验 → `invalidate()` 等一次 `paint`（最多 500 ms）→ `capturePage()` 截图。
 *   回读容差是采样帧率下的半帧：帧率取请求里的 `fps`（取帧票据的），没有时取 `open` 的 `fps`（包的 intrinsic）。
 *   不直接用 `paint` 事件带来的图像：实测它可能是上一次提交的旧帧，`capturePage()` 才稳定反映 seek 后的画面。
 * - `open` 带 `record: true` 时，在 `ready()` 之前再注入 `CANVAS_RECORDER_SCRIPT`（要赶在 `initialize` 构造 `FontFace` 与离屏画布之前）。
 * - `record`：同一会话串行；一批时刻交给 `__baocutRecorder.record`，逐帧做同样的回读校验，再把资源的 `file:` URL 改写成包内相对路径
 *   （`/` 分隔；落在包外的判为不支持）。
 * - 页面里未捕获的异常（`Uncaught …` 级别为 error 的控制台消息）、渲染进程退出、主框架加载失败都让在途请求以
 *   `COMPOSITION_SCRIPT_ERROR` 失败。
 */

/** 宿主脚本里换成 `JSON.stringify(COMPOSITION_ADAPTER_SCRIPT)` 的占位。 */
export const ADAPTER_PLACEHOLDER = '/*__BAOCUT_ADAPTER_SOURCE__*/null';
/** 宿主脚本里换成 `JSON.stringify(CANVAS_RECORDER_SCRIPT)` 的占位。 */
export const RECORDER_PLACEHOLDER = '/*__BAOCUT_RECORDER_SOURCE__*/null';

// i18n-ignore-start: 子进程脚本源码，不是给人看的文字
export const COMPOSITION_HOST_SCRIPT = String.raw`'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { fileURLToPath } = require('url');

const ADAPTER_SOURCE = /*__BAOCUT_ADAPTER_SOURCE__*/null;
const RECORDER_SOURCE = /*__BAOCUT_RECORDER_SOURCE__*/null;
const PAINT_WAIT_MS = 500;

// GPU 合成留着，WebGL（Three.js、p5 的 WEBGL 模式）才有：关掉硬件加速后 Chromium 在 macOS 上连 SwiftShader 也不给
// （enable-unsafe-swiftshader、use-angle=swiftshader 实测都拿不到 WebGL）。Canvas 2D 与页面光栅仍留在 CPU，
// 指令烘焙的对拍样本与之前逐位相同；没有 GPU 的机器由 Chromium 自己回落软件合成。
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
if (app.dock && typeof app.dock.hide === 'function') app.dock.hide();
// 所有窗口关掉也不退出：会话结束不等于宿主结束。
app.on('window-all-closed', () => {});

const send = (message) => {
  try {
    process.stdout.write(JSON.stringify(message) + '\n');
  } catch (error) {
    process.stderr.write('[composition-host] stdout write failed: ' + error + '\n');
  }
};
const log = (line) => process.stderr.write('[composition-host] ' + line + '\n');
const fail = (code, message, details) => Object.assign(new Error(message), { code, details });

const sessions = new Map();
let nextSession = 1;
let quitting = false;

function quit() {
  if (quitting) return;
  quitting = true;
  for (const state of sessions.values()) destroy(state);
  sessions.clear();
  setImmediate(() => app.exit(0));
}

function destroy(state) {
  state.dead = true;
  if (state.win && !state.win.isDestroyed()) state.win.destroy();
}

function realOrResolved(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function allowedUrl(url, rootReal) {
  if (/^(data|blob|about|devtools):/i.test(url)) return true;
  if (!/^file:/i.test(url)) return false;
  let file;
  try {
    file = realOrResolved(fileURLToPath(url));
  } catch {
    return false;
  }
  return file === rootReal || file.startsWith(rootReal + path.sep);
}

/** 在途请求遇到页面错误时立即失败；没有在途请求时记下来，下一次请求报告。 */
function pageError(state, message) {
  log('session ' + state.id + ' page error: ' + message);
  const error = fail('COMPOSITION_SCRIPT_ERROR', message);
  if (state.inflight) state.inflight(error);
  else state.pendingErrors.push(message);
}

/** 让 promise 与页面错误赛跑。 */
function guarded(state, promise) {
  if (state.pendingErrors.length > 0) {
    const messages = state.pendingErrors.splice(0);
    return Promise.reject(fail('COMPOSITION_SCRIPT_ERROR', messages.join('\n')));
  }
  if (state.dead) return Promise.reject(fail('COMPOSITION_SCRIPT_ERROR', 'The composition page is gone'));
  return new Promise((resolve, reject) => {
    state.inflight = reject;
    promise.then(resolve, reject).finally(() => {
      if (state.inflight === reject) state.inflight = null;
    });
  });
}

async function adapterCall(state, expression) {
  const envelope = await state.win.webContents.executeJavaScript(expression, true);
  if (!envelope || typeof envelope !== 'object') throw fail('COMPOSITION_SCRIPT_ERROR', 'The adapter returned no result');
  if (!envelope.ok) throw fail(envelope.code || 'COMPOSITION_SCRIPT_ERROR', envelope.message || 'Adapter call failed');
  return envelope.value;
}

async function open(p) {
  const id = 's' + nextSession++;
  const rootReal = realOrResolved(p.root);
  const entryPath = path.join(rootReal, ...String(p.entry).split('/'));
  const partition = 'composition-' + id;
  const ses = session.fromPartition(partition, { cache: false });
  const state = { id, win: null, blocked: [], pendingErrors: [], inflight: null, chain: Promise.resolve(), dead: false, alpha: !!p.alpha, width: p.width, height: p.height, fps: p.fps, rootReal, compositionId: p.compositionId, recording: !!p.record };
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (allowedUrl(details.url, rootReal)) return callback({});
    state.blocked.push(details.url);
    send({ event: 'networkBlocked', params: { sessionId: id, url: details.url } });
    callback({ cancel: true });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  const win = new BrowserWindow({
    show: false,
    width: p.width,
    height: p.height,
    useContentSize: true,
    frame: false,
    enableLargerThanScreen: true,
    transparent: !!p.alpha,
    backgroundColor: p.alpha ? '#00000000' : '#000000',
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      partition,
    },
  });
  state.win = win;
  sessions.set(id, state);
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.on('console-message', (...args) => {
    // Electron 新版是事件对象（level 为字符串），旧版是 (event, level 数字, message)。
    const event = args[0] || {};
    const level = typeof event.level === 'string' ? event.level : args[1] === 3 ? 'error' : String(args[1]);
    const message = typeof event.message === 'string' ? event.message : String(args[2]);
    if (level !== 'error') return;
    if (/^Uncaught\b/.test(message)) pageError(state, message);
    else log('session ' + id + ' console.error: ' + message);
  });
  wc.on('render-process-gone', (_event, details) => {
    state.dead = true;
    pageError(state, 'Render process gone: ' + (details && details.reason));
  });
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    pageError(state, 'Failed to load ' + validatedURL + ': ' + errorDescription + ' (' + errorCode + ')');
  });

  try {
    await guarded(state, win.loadFile(entryPath));
    await guarded(state, wc.executeJavaScript(ADAPTER_SOURCE, true));
    if (state.recording) await guarded(state, wc.executeJavaScript(RECORDER_SOURCE, true));
    const ctx = { width: p.width, height: p.height, fps: p.fps, durationFrames: p.durationFrames };
    const expression =
      'window.__baocutAdapter.ready(' +
      [JSON.stringify(p.contract), JSON.stringify(p.compositionId), JSON.stringify(p.readyTimeoutMs), JSON.stringify(ctx)].join(',') +
      ')';
    const page = await guarded(state, adapterCall(state, expression));
    return { sessionId: id, page, blockedRequests: state.blocked.slice() };
  } catch (error) {
    sessions.delete(id);
    destroy(state);
    throw error;
  }
}

function nextPaint(wc) {
  return new Promise((resolve) => {
    const onPaint = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      wc.removeListener('paint', onPaint);
      resolve(false);
    }, PAINT_WAIT_MS);
    wc.once('paint', onPaint);
    wc.invalidate();
  });
}

/** 与 @baocut/protocol 的 seekToleranceSeconds 相同：采样帧率下的半帧，1 / (2 × fps)。 */
function seekTolerance(fps) {
  const num = Number(fps && fps.num);
  const den = Number(fps && fps.den);
  if (!(num > 0) || !(den > 0)) throw fail('COMPOSITION_SEEK_MISMATCH', 'Frame request has no valid fps');
  return den / (2 * num);
}

async function renderFrame(state, p) {
  const seconds = Number(p.seconds);
  if (!Number.isFinite(seconds)) throw fail('COMPOSITION_SEEK_MISMATCH', 'Requested time is not a finite number');
  const expression = 'window.__baocutAdapter.seek(' + JSON.stringify(seconds) + ')';
  const tolerance = seekTolerance(p.fps || state.fps);
  const seek = await guarded(state, adapterCall(state, expression));
  if (!(Math.abs(seek.sampledSeconds - seek.targetSeconds) <= tolerance)) {
    throw fail('COMPOSITION_SEEK_MISMATCH', 'Seek to ' + seconds + ' s sampled ' + seek.sampledSeconds + ' s (target ' + seek.targetSeconds + ' s)', seek);
  }
  const wc = state.win.webContents;
  const painted = await nextPaint(wc);
  const image = await guarded(state, wc.capturePage());
  const size = image.getSize();
  if (size.width !== state.width || size.height !== state.height) {
    throw fail('COMPOSITION_INTRINSIC_MISMATCH', 'Captured ' + size.width + 'x' + size.height + ', expected ' + state.width + 'x' + state.height, size);
  }
  let transparentPixels = 0;
  let translucentPixels = 0;
  if (state.alpha) {
    const bitmap = image.toBitmap();
    for (let i = 3; i < bitmap.length; i += 4) {
      const a = bitmap[i];
      if (a === 0) transparentPixels++;
      else if (a < 255) translucentPixels++;
    }
  }
  return {
    png: image.toPNG().toString('base64'),
    width: size.width,
    height: size.height,
    sampledSeconds: seek.sampledSeconds,
    targetSeconds: seek.targetSeconds,
    clamped: seek.clamped,
    captureMode: 'capturePage',
    paintObserved: painted,
    transparentPixels,
    translucentPixels,
    blockedRequests: state.blocked.slice(),
  };
}

function relativeResource(state, url) {
  let file;
  try {
    file = realOrResolved(fileURLToPath(url));
  } catch {
    return null;
  }
  if (!(file === state.rootReal || file.startsWith(state.rootReal + path.sep))) return null;
  return path.relative(state.rootReal, file).split(path.sep).join('/');
}

async function recordFrames(state, p) {
  if (!state.recording) throw fail('COMPOSITION_SCRIPT_ERROR', 'The session was not opened for recording');
  const seconds = Array.isArray(p.seconds) ? p.seconds.map(Number) : [];
  if (!seconds.every(Number.isFinite)) throw fail('COMPOSITION_SEEK_MISMATCH', 'Requested times are not finite numbers');
  const tolerance = seekTolerance(p.fps || state.fps);
  const info = { width: state.width, height: state.height, alpha: state.alpha, compositionId: state.compositionId };
  const expression = 'window.__baocutRecorder.record(' + JSON.stringify(seconds) + ',' + JSON.stringify(info) + ')';
  const value = await guarded(state, adapterCall(state, expression));
  for (const frame of value.frames) {
    if (!(Math.abs(frame.sampled - frame.target) <= tolerance)) {
      throw fail('COMPOSITION_SEEK_MISMATCH', 'Seek to ' + frame.s + ' s sampled ' + frame.sampled + ' s (target ' + frame.target + ' s)', frame);
    }
  }
  let unsupported = value.unsupported;
  for (const resource of value.resources) {
    if (typeof resource.url !== 'string') continue;
    const rel = relativeResource(state, resource.url);
    if (rel === null) unsupported = unsupported || 'resource-outside-bundle';
    resource.path = rel;
    delete resource.url;
  }
  return { frames: value.frames, resources: value.resources, background: value.background, unsupported: unsupported || null, blockedRequests: state.blocked.slice() };
}

function sessionOf(p) {
  const state = sessions.get(p && p.sessionId);
  if (!state) throw fail('COMPOSITION_SCRIPT_ERROR', 'Unknown composition session ' + (p && p.sessionId));
  return state;
}

async function handle(method, p) {
  switch (method) {
    case 'open':
      return open(p);
    case 'frame': {
      const state = sessionOf(p);
      const run = state.chain.then(() => renderFrame(state, p));
      state.chain = run.catch(() => {});
      return run;
    }
    case 'record': {
      const state = sessionOf(p);
      const run = state.chain.then(() => recordFrames(state, p));
      state.chain = run.catch(() => {});
      return run;
    }
    case 'close': {
      const state = sessions.get(p && p.sessionId);
      if (!state) return { closed: false };
      sessions.delete(state.id);
      try {
        if (!state.dead) await state.win.webContents.executeJavaScript('window.__baocutAdapter && window.__baocutAdapter.dispose()', true);
      } catch {}
      destroy(state);
      return { closed: true, blockedRequests: state.blocked.slice() };
    }
    case 'ping':
      return { electron: process.versions.electron, sessions: sessions.size };
    case 'shutdown':
      setImmediate(quit);
      return { ok: true };
    default:
      throw fail('COMPOSITION_SCRIPT_ERROR', 'Unknown method ' + method);
  }
}

function main() {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message.id !== 'number') return;
    Promise.resolve()
      .then(() => handle(message.method, message.params || {}))
      .then(
        (result) => send({ id: message.id, result: result === undefined ? null : result }),
        (error) =>
          send({
            id: message.id,
            error: {
              code: (error && error.code) || 'COMPOSITION_SCRIPT_ERROR',
              message: String((error && error.message) || error),
              ...(error && error.details !== undefined ? { details: error.details } : {}),
            },
          }),
      );
  });
  lines.on('close', quit);
  send({ event: 'ready', params: { electron: process.versions.electron, chrome: process.versions.chrome } });
}

app.whenReady().then(main, (error) => {
  log('startup failed: ' + (error && error.stack ? error.stack : error));
  app.exit(1);
});
`;
// i18n-ignore-end
