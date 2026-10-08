import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorSemantics, EditorWasmUnavailable, semanticsApi } from './semantics.ts';

export * from './semantics.ts';

const RELATIVE = path.join('generated', 'editor.wasm');
const IN_REPO = path.join('packages', 'editor-wasm', 'src', RELATIVE);

let loaded: EditorSemantics | null = null;

/**
 * WASM 文件的位置：本模块旁边的 `generated/editor.wasm`；Runtime 被打进别的 bundle 时，从 bundle 往上找仓库里的
 * `packages/editor-wasm/src/generated/editor.wasm`（与找 cargo 产物同一个办法）。找不到时 null。
 */
export function locateEditorWasm(here = path.dirname(fileURLToPath(import.meta.url))): string | null {
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
} = semanticsApi(editorSemantics);
