import { EditorSemantics, EditorWasmUnavailable, semanticsApi } from './semantics.ts';

export * from './semantics.ts';

/**
 * 浏览器里的载入：Vite 把 `generated/editor.wasm` 以 data URL 内联进 bundle（开发服务器与打包后的 file:// 页面走同一条路，
 * 与预览的 WASM 一样）。用急切的 glob 而不是静态 import：没有构建时这里拿到空对象，调用时才报错，界面别的部分照常载入。
 * 用的 Vite 配置要把 `.wasm` 列进 `assetsInclude`。
 */
const inlined = import.meta.glob<string>('./generated/editor.wasm', { eager: true, query: '?inline', import: 'default' });

let loaded: EditorSemantics | null = null;

function dataUrl(): string | null {
  return Object.values(inlined)[0] ?? null;
}

function decodeDataUrl(url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 载入一次，之后同步复用。没有构建时抛 `EditorWasmUnavailable`。 */
export function editorSemantics(): EditorSemantics {
  if (loaded) return loaded;
  const url = dataUrl();
  if (!url) throw new EditorWasmUnavailable('generated/editor.wasm is not in the bundle');
  loaded = EditorSemantics.instantiate(decodeDataUrl(url));
  return loaded;
}

/** WASM 是否已经构建。 */
export function editorWasmAvailable(): boolean {
  return dataUrl() !== null;
}

/** 各函数见 `EditorSemantics` 的同名方法。 */
export const {
  speechSentences,
  stageBox,
  stagePlace,
  placeDefault,
  engineRanges,
  elementPresets,
  speakerProposal,
  applySpeakers,
  sourceChapters,
} = semanticsApi(editorSemantics);

/** 与 Node 一侧同名，浏览器里没有文件路径。 */
export function locateEditorWasm(): string | null {
  return null;
}
