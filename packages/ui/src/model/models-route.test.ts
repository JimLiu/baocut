import { describe, expect, it } from 'vitest';
import { hrefFor, parseHref } from '../state/shell-store.ts';
import { modelsNavTargets, resolveModelsRoute } from './models-route.ts';

describe('resolveModelsRoute', () => {
  it('带了属于这一类的页就用它', () => {
    expect(resolveModelsRoute('tts', 'voices', { tts: 'cloud' })).toEqual({ category: 'tts', page: 'voices' });
  });

  it('没带页时用上次停的页，再没有用第一页', () => {
    expect(resolveModelsRoute('asr', undefined, { asr: 'cloud' })).toEqual({ category: 'asr', page: 'cloud' });
    expect(resolveModelsRoute('asr', undefined, {})).toEqual({ category: 'asr', page: 'local' });
  });

  it('带的页不属于这一类（深链 models/llm/local）时落到这一类的页', () => {
    expect(resolveModelsRoute('llm', 'local', {})).toEqual({ category: 'llm', page: 'cloud' });
    expect(resolveModelsRoute('sep', 'cloud', { sep: 'voices' })).toEqual({ category: 'sep', page: 'local' });
  });
});

describe('modelsNavTargets', () => {
  it('当前这一类用解析好的页，其余用上次停的页', () => {
    const targets = modelsNavTargets({ category: 'asr', page: 'cloud' }, { asr: 'local', tts: 'voices' });
    expect(targets.map((t) => `${t.category}/${t.page}`)).toEqual(['asr/cloud', 'tts/voices', 'llm/cloud', 'image/local', 'sep/local', 'vision/local']);
  });
});

describe('模型页深链', () => {
  it('设置内模型 URL 来回换算，旧链接归入同一配置页', () => {
    for (const target of modelsNavTargets({ category: 'image', page: 'cloud' }, {})) {
      const route = { tab: 'models' as const, ...target };
      expect(hrefFor(route)).toBe(`/settings/models/${target.category}/${target.page}`);
      expect(parseHref(hrefFor(route))).toEqual(route);
      expect(parseHref(`/models/${target.category}/${target.page}`)).toEqual(route);
    }
  });
});
