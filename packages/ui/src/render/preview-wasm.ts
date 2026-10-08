import { R } from './render-copy.ts';
import { RenderPlanner } from './render-planner.ts';

let loading: Promise<RenderPlanner> | null = null;
/** 记下的那一次已经载入好了（`fresh` 不丢它）。 */
let loaded = false;

/**
 * 载入这么久还没有结果（成功失败都没有）：报一条开发日志，忘掉记下的这一次，之后的预览重新载入；这一次之后到了，
 * 等着它的预览照样能用。不这样的话一次卡住的载入会让之后打开的每个预览都一直停在载入中。
 */
const LOAD_STALL_MS = 30_000;

/**
 * 随渲染内核发布的字体（`npm run build:wasm` 从 `crates/render-raster/assets/fonts` 拷进来）：只取地址，用到时再读。
 * 字体有二十多 MB，不内联进 bundle。
 */
const FONT_URLS = import.meta.glob<string>('./generated/fonts/*.ttf', { query: '?url', import: 'default', eager: true });

/**
 * 预览的 WASM（`npm run build:wasm` 生成），按需载入的单独 chunk。用 glob 而不是字面的动态 import：没有构建时这里是空对象，
 * 载入时才报错，界面别的部分照常载入（字面的 import 指向不存在的文件，开发服务器与构建都会直接失败）。
 */
const WASM = import.meta.glob<string>('./generated/preview.wasm', { query: '?inline', import: 'default' });

/**
 * 载入预览的帧计划器。WASM 由 `npm run build:wasm` 生成，以 data URL 内联进 bundle：开发服务器与打包后的
 * file:// 页面走同一条路，不需要另外取文件，也不用给 CSP 加 `data:` 的 connect-src。字体按 WASM 给的次序
 * 全部读到之后一次注入，之后才交出去（每注入一份，WASM 里的渲染器都要重建）。新建文字的框也由它量，量之前等它载入
 * （`components/editor/text-measure.ts`）。只载入一次；失败了或久久没有结果（`LOAD_STALL_MS`），下次再试。
 * `fresh`（预览卡住时的「重试」）：记下的那一次还没有结果就不等它，重新载入；已经载入好的照用。
 */
export function loadRenderPlanner(options: { fresh?: boolean } = {}): Promise<RenderPlanner> {
  const wasm = WASM['./generated/preview.wasm'];
  if (!wasm) return Promise.reject(new Error(R.planner.wasmMissing));
  if (options.fresh && !loaded) loading = null;
  if (loading) return loading;
  const attempt = wasm().then(async (url) => {
    const planner = await RenderPlanner.instantiate(decodeDataUrl(url));
    planner.addFonts(await Promise.all(planner.fontFiles().map(readFont)));
    return planner;
  });
  loading = attempt;
  loaded = false;
  const timer = setTimeout(() => {
    if (loading !== attempt) return;
    console.warn(`[preview] 渲染内核载入 ${LOAD_STALL_MS / 1000} 秒还没有结果：之后的预览重新载入`); // i18n-ignore: 开发日志
    loading = null;
  }, LOAD_STALL_MS);
  attempt.then(
    () => {
      clearTimeout(timer);
      if (loading === attempt) loaded = true;
    },
    () => {
      clearTimeout(timer);
      if (loading === attempt) loading = null;
    },
  );
  return attempt;
}

async function readFont(name: string): Promise<Uint8Array> {
  const url = FONT_URLS[`./generated/fonts/${name}`];
  if (!url) throw new Error(R.fonts.notFound(name));
  // 打包后的页面在 file:// 下，fetch 不支持这个协议，改用 XHR。
  if (new URL(url, location.href).protocol === 'file:') return readWithXhr(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(R.fonts.unreadable(name, response.status));
  return new Uint8Array(await response.arrayBuffer());
}

function readWithXhr(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url);
    request.responseType = 'arraybuffer';
    request.onload = () => {
      // file:// 没有 HTTP 状态，成功时是 0（Electron 里是 200）。
      const ok = request.status === 0 || request.status === 200;
      if (ok && request.response instanceof ArrayBuffer) resolve(new Uint8Array(request.response));
      else reject(new Error(R.fonts.unreadableUrl(url)));
    };
    request.onerror = () => reject(new Error(R.fonts.unreadableUrl(url)));
    request.send();
  });
}

function decodeDataUrl(url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
