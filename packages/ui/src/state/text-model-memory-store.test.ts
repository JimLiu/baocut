import { describe, expect, it, vi } from 'vitest';
import { textModelsOf, useTextModelMemory } from './text-model-memory-store.ts';

// Node 里没有可用的 localStorage：给持久化一个内存版本，先于 store 模块加载；预先放一份存下的记忆。
const data = vi.hoisted(() => {
  const map = new Map<string, string>([
    ['baocut.text-model-memory', JSON.stringify({ state: { models: { 'translate-tool': 'agent:codex/text-gen', 'dub-tool': 3, other: 'x' } }, version: 1 })],
  ]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
  });
  return map;
});

describe('文本模型按位置记住的上一次选择', () => {
  it('读出上次选的；不认得的位置与坏数据当没有', () => {
    expect(useTextModelMemory.getState().models).toEqual({ 'translate-tool': 'agent:codex/text-gen' });
    expect(textModelsOf(null)).toEqual({});
    expect(textModelsOf({ models: 'x' })).toEqual({});
    expect(textModelsOf({ models: { 'editor-dub': '' } })).toEqual({});
  });

  it('各处分开记，写回这台电脑', () => {
    useTextModelMemory.getState().remember('editor-translate', 'openai/gpt-5-mini');
    useTextModelMemory.getState().remember('translate-tool', 'google/gemini-2.5-flash');
    expect(useTextModelMemory.getState().models).toEqual({ 'translate-tool': 'google/gemini-2.5-flash', 'editor-translate': 'openai/gpt-5-mini' });
    expect(JSON.parse(data.get('baocut.text-model-memory')!).state.models).toEqual({
      'translate-tool': 'google/gemini-2.5-flash',
      'editor-translate': 'openai/gpt-5-mini',
    });
  });
});
