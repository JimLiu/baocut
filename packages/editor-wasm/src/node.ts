import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorSemantics, EditorWasmUnavailable, semanticsApi } from './semantics.ts';

export * from './semantics.ts';

const RELATIVE = path.join('generated', 'editor.wasm');
const IN_REPO = path.join('packages', 'editor-wasm', 'src', RELATIVE);

let loaded: EditorSemantics | null = null;

/**
 * 安装包先找 `web/assets/bundled-wasm.json` 指向的共享文件；普通构建找本模块旁边的 `generated/editor.wasm`；Runtime 被打进别的 bundle 时，从 bundle 往上找仓库里的
 * `packages/editor-wasm/src/generated/editor.wasm`（与找 cargo 产物同一个办法）。找不到时 null。
 */
export function locateEditorWasm(here = path.dirname(fileURLToPath(import.meta.url))): string | null {
  // Packaged desktop clients and Runtime share Web's immutable WASM binary.
  const main = path.basename(here) === 'chunks' ? path.dirname(here) : here;
  const shared = path.resolve(main, '../../../web/assets');
  const manifest = path.join(shared, 'bundled-wasm.json');
  if (existsSync(manifest)) {
    const name: unknown = JSON.parse(readFileSync(manifest, 'utf8'))['editor.wasm'];
    if (typeof name !== 'string' || !/^editor-[a-f0-9]{12}\.wasm$/.test(name)) {
      throw new Error('Invalid shared editor WASM manifest');
    }
    const file = path.join(shared, name);
    return existsSync(file) ? file : null;
  }
  const beside = path.join(here, RELATIVE);
  if (existsSync(beside)) return beside;
  // Multiple main-process entries share this module in a Rollup `chunks/` file.
  // The WASM is still shipped beside the entry points, outside that directory.
  if (path.basename(here) === 'chunks') {
    const bundled = path.join(path.dirname(here), RELATIVE);
    if (existsSync(bundled)) return bundled;
  }
  for (let dir = here; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, IN_REPO);
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

/** 载入一次，之后同步复用。没有构建时抛 `EditorWasmUnavailable`。 */
export function editorSemantics(): EditorSemantics {
  if (loaded) return loaded;
  const file = locateEditorWasm();
  if (!file) throw new EditorWasmUnavailable('generated/editor.wasm not found');
  const bytes = readFileSync(file);
  loaded = EditorSemantics.instantiate(
    new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
  );
  return loaded;
}

/** WASM 是否已经构建（测试据此跳过）。 */
export function editorWasmAvailable(): boolean {
  return locateEditorWasm() !== null;
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
  audioAnalysis,
  audioSheet,
  sfxRender,
  sfxRecipes,
  templateCatalog,
  templateNewLayer,
  templateBlank,
  templateInstance,
  templateDefinition,
  templateInfo,
  templateRatioEquivalent,
  templateBox,
  templateHit,
  captionSceneSummary,
} = semanticsApi(editorSemantics);
