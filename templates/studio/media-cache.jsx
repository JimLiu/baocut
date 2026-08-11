// BaoCut Subtitle Studio — 时间轴派生媒体缓存：真实缩略图（全片拼接条 + 放大后
// 单帧）与波形峰值，数据来自 bcut serve 的 __bcut/media/meta·filmstrip·thumb·
// waveform。契约移植自 designs/baocut-mac/app/media-cache.js：内存 Map +
// subscribe 通知 + 限并发请求队列。探针 404（旧服务器/无媒体）或请求连续失败
// 时整体降级——timeline 保持章节色渐变与假波形占位，不报错。
//
// 所有 URL 相对项目根（与 stage.jsx 的 __bcut/media 同基）并带媒体指纹 v：
// 服务端响应 immutable，媒体替换 → v 变 → 浏览器缓存自然失效。
(() => {
const THUMB_REQ_W = 168;      // 请求宽度 = 84 CSS px @2x
const CONCURRENCY = 3;        // 单帧客户端并发；服务端另有 ffmpeg 闸（2）
const POLL_LIMIT = 90;        // 202 轮询上限（filmstrip 2s×90 / waveform 1.5s×90）

const subs = new Set();
const notify = () => subs.forEach((fn) => { try { fn(); } catch (e) { /* 订阅者自理 */ } });

// ── meta 探针：{enabled, kind, v}；null = 探测中 ──
let meta = null;
let metaStarted = false;
function init() {
  if (metaStarted) return;
  metaStarted = true;
  fetch('__bcut/media/meta', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { meta = j && j.ok ? { enabled: true, kind: j.kind, v: j.v } : { enabled: false }; notify(); })
    .catch(() => { meta = { enabled: false }; notify(); });
}

// ── 全片拼接条（一张 sprite，后台生成，202 轮询）──
let strip = { state: 'idle' }; // idle|building|ready|unavailable (+ url, cells, w)
let stripTries = 0;
function requestStrip(dur) {
  if (!meta || !meta.enabled || meta.kind !== 'video') return;
  if (strip.state !== 'idle') return;
  const cells = Math.max(12, Math.min(60, Math.round(dur / 12)));
  strip = { state: 'building', cells };
  const url = `__bcut/filmstrip?cells=${cells}&w=${THUMB_REQ_W}&v=${meta.v}`;
  const poll = () => {
    fetch(url)
      .then((r) => {
        if (r.status === 202) {
          if (++stripTries > POLL_LIMIT) { strip = { state: 'unavailable' }; notify(); return; }
          setTimeout(poll, 2000);
          return;
        }
        if (!r.ok) { strip = { state: 'unavailable' }; notify(); return; }
        // 响应 immutable：预载确认可解码后直接把 URL 交给 CSS（走浏览器缓存）
        const img = new Image();
        img.onload = () => { strip = { state: 'ready', url, cells }; notify(); };
        img.onerror = () => { strip = { state: 'unavailable' }; notify(); };
        img.src = url;
      })
      .catch(() => { strip = { state: 'unavailable' }; notify(); });
  };
  poll();
}

// ── 单帧缩略图（放大后按需）：snap 0.5s → {state, url}，LIFO 最新可见先取 ──
const thumbs = new Map();
const queue = [];
let running = 0;
let thumbFails = 0, thumbOk = 0, thumbsDead = false;
function thumb(t) {
  if (!meta || !meta.enabled || meta.kind !== 'video' || thumbsDead) return null;
  const key = Math.round(Math.max(0, t) * 2) / 2;
  const got = thumbs.get(key);
  if (got) return got;
  const entry = { state: 'loading', url: `__bcut/thumb?t=${key}&w=${THUMB_REQ_W}&v=${meta.v}` };
  thumbs.set(key, entry);
  queue.push(key);
  pump();
  return entry;
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const entry = thumbs.get(queue.pop());
    if (!entry || entry.state !== 'loading' || entry.started) continue;
    entry.started = true;
    running++;
    const img = new Image();
    const done = () => { running--; notify(); pump(); };
    img.onload = () => { entry.state = 'ready'; thumbOk++; done(); };
    img.onerror = () => {
      entry.state = 'error';
      // 零成功前连续失败 → 判定不可用（无 ffmpeg 等），停止后续请求
      if (thumbOk === 0 && ++thumbFails >= 4) thumbsDead = true;
      done();
    };
    img.src = entry.url;
  }
}

// ── 波形峰值：BCW1 二进制 → Uint8Array ──
let wave = { state: 'idle' }; // idle|building|ready|unavailable (+ binsPerSec, peaks)
let waveTries = 0;
function requestWave() {
  if (!meta || !meta.enabled) return;
  if (wave.state !== 'idle') return;
  wave = { state: 'building' };
  const url = `__bcut/waveform?v=${meta.v}`;
  const poll = () => {
    fetch(url)
      .then((r) => {
        if (r.status === 202) {
          if (++waveTries > POLL_LIMIT) { wave = { state: 'unavailable' }; notify(); return; }
          setTimeout(poll, 1500);
          return;
        }
        if (!r.ok) { wave = { state: 'unavailable' }; notify(); return; }
        return r.arrayBuffer().then((ab) => {
          const dv = new DataView(ab);
          if (ab.byteLength < 12 || dv.getUint32(0, false) !== 0x42435731 /* "BCW1" */) {
            wave = { state: 'unavailable' }; notify(); return;
          }
          const binsPerSec = dv.getUint32(4, true);
          const count = Math.min(dv.getUint32(8, true), ab.byteLength - 12);
          wave = { state: 'ready', binsPerSec, peaks: new Uint8Array(ab, 12, count) };
          notify();
        });
      })
      .catch(() => { wave = { state: 'unavailable' }; notify(); });
  };
  poll();
}

window.VK_MEDIA = {
  status: () => meta,
  strip: (dur) => { init(); requestStrip(dur); return strip; },
  thumb: (t) => { init(); return thumb(t); },
  wave: () => { init(); requestWave(); return wave; },
  subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
};

// 订阅 → 强制重渲染（同 designs/baocut-mac/app/media.jsx 的 useMediaCache）
window.useMediaResource = () => {
  const [, bump] = React.useState(0);
  React.useEffect(() => window.VK_MEDIA.subscribe(() => bump((n) => n + 1)), []);
};
})();
