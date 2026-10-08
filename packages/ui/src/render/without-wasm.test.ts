import { EditorWasmUnavailable } from '@baocut/editor-wasm';
import { describe, expect, it, vi } from 'vitest';

/**
 * 没有构建编辑语义的 WASM 时（没装 Rust 的机器），界面照常载入：模块载入时不碰 WASM，用到它的地方才报
 * `EditorWasmUnavailable`。这里让 WASM 的每个函数一调就抛，再把界面包里的模块全部载入一遍。
 */
vi.mock('@baocut/editor-wasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@baocut/editor-wasm')>();
  const unavailable = () => {
    throw new actual.EditorWasmUnavailable('测试里当作没有构建');
  };
  return {
    ...actual,
    editorSemantics: unavailable,
    speechSentences: unavailable,
    stageBox: unavailable,
    stagePlace: unavailable,
    placeDefault: unavailable,
    engineRanges: unavailable,
    elementPresets: unavailable,
    speakerProposal: unavailable,
    applySpeakers: unavailable,
  };
});

const MODULES = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../**/*.d.ts']);

describe('没有编辑语义的 WASM', () => {
  it.for(Object.keys(MODULES))('载入 %s 不碰 WASM', async (file, context) => {
    try {
      await MODULES[file]!();
    } catch (error) {
      // 经 .tsx 引到 Spectrum 组件的模块带 .css，node 里载入不了；整页在 Electron 里实测。
      if ((error as { code?: string }).code === 'ERR_UNKNOWN_FILE_EXTENSION') return context.skip('引到带 .css 的组件');
      throw error;
    }
  });

  it('读到由 WASM 算出的常量时才报不可用', async () => {
    const { CONFETTI_STYLES, CONFETTI_RANGES } = await import('./confetti.ts');
    const { ELEMENT_TILES } = await import('../model/element-catalog.ts');
    expect(() => CONFETTI_STYLES.length).toThrow(EditorWasmUnavailable);
    expect(() => CONFETTI_RANGES.size).toThrow(EditorWasmUnavailable);
    expect(() => ELEMENT_TILES.map((tile) => tile.key)).toThrow(EditorWasmUnavailable);
  });
});
