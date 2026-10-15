import { describe, expect, it } from 'vitest';
import { capabilitySettingsHref, MODEL_SERVICE_CAPABILITIES } from '@baocut/protocol';
import { hrefFor, parseHref, type Route } from '../state/shell-store.ts';
import { modelsNavTargets, resolveModelsRoute } from './models-route.ts';

describe('resolveModelsRoute', () => {
  it('带了属于这一类的页就用它', () => {
    expect(resolveModelsRoute('tts', 'voices', { tts: 'models' })).toEqual({ category: 'tts', page: 'voices' });
  });

  it('没带页时用上次停的页，再没有用第一页', () => {
    expect(resolveModelsRoute('tts', undefined, { tts: 'voices' })).toEqual({ category: 'tts', page: 'voices' });
    expect(resolveModelsRoute('asr', undefined, {})).toEqual({ category: 'asr', page: 'models' });
  });

  it('带的页不属于这一类、或记着的是旧页签时落到能力页', () => {
    expect(resolveModelsRoute('sep', 'voices', {})).toEqual({ category: 'sep', page: 'models' });
    // 升级前记下的「上次停的页」可能还是 local / cloud。
    expect(resolveModelsRoute('asr', undefined, { asr: 'cloud' as never })).toEqual({ category: 'asr', page: 'models' });
  });
});

describe('modelsNavTargets', () => {
  it('当前这一类用解析好的页，其余用上次停的页', () => {
    const targets = modelsNavTargets({ category: 'asr', page: 'models' }, { tts: 'voices' });
    expect(targets.map((t) => `${t.category}/${t.page}`)).toEqual([
      'asr/models',
      'tts/voices',
      'llm/models',
      'image/models',
      'music/models',
      'sep/models',
      'vision/models',
    ]);
  });
});

describe('模型页深链', () => {
  it('设置内模型 URL 来回换算', () => {
    for (const target of modelsNavTargets({ category: 'image', page: 'models' }, { tts: 'voices' })) {
      const route = { tab: 'models' as const, ...target };
      expect(hrefFor(route)).toBe(`/settings/models/${target.category}/${target.page}`);
      expect(parseHref(hrefFor(route))).toEqual(route);
      expect(parseHref(`/models/${target.category}/${target.page}`)).toEqual(route);
    }
  });

  it('工具给的能力链接落到能力页', () => {
    const categories = ['asr', 'tts', 'image', 'llm', 'sep', 'music'];
    MODEL_SERVICE_CAPABILITIES.forEach((capability, i) => {
      expect(parseHref(capabilitySettingsHref(capability))).toEqual({ tab: 'models', category: categories[i] });
    });
  });

  it('旧的本地 / 云端页签与旧的设置地址归到新位置', () => {
    expect(parseHref('/settings/models/tts/cloud')).toEqual({ tab: 'models', category: 'tts' });
    expect(parseHref('/settings/models/image/local')).toEqual({ tab: 'models', category: 'image' });
    expect(parseHref('/models/asr/cloud')).toEqual({ tab: 'models', category: 'asr' });
    expect(parseHref('/settings/local')).toEqual({ tab: 'models', category: 'asr' });
    expect(parseHref('/settings/cloud')).toEqual({ tab: 'settings', section: 'providers' });
    expect(parseHref('/settings/voices')).toEqual({ tab: 'models', category: 'tts', page: 'voices' });
  });
});

describe('API 提供方与用量的地址', () => {
  it('来回换算', () => {
    const routes: Route[] = [
      { tab: 'settings', section: 'providers' },
      { tab: 'settings', section: 'providers', from: 'add' },
      { tab: 'settings', section: 'providers', from: 'custom' },
      { tab: 'settings', section: 'providers', providerId: 'google' },
      { tab: 'settings', section: 'providers', providerId: 'custom:my-vllm', from: 'add' },
      { tab: 'settings', section: 'usage' },
      { tab: 'settings', section: 'usage', providerId: 'custom:my-vllm' },
    ];
    for (const route of routes) expect(parseHref(hrefFor(route))).toEqual(route);
    expect(hrefFor({ tab: 'settings', section: 'providers', providerId: 'custom:my-vllm', from: 'add' })).toBe(
      '/settings/providers/custom%3Amy-vllm?from=add',
    );
    expect(hrefFor({ tab: 'settings', section: 'usage', providerId: 'openai' })).toBe('/settings/usage?id=openai');
  });

  it('其余分节不带提供方', () => {
    expect(hrefFor({ tab: 'settings', section: 'general', providerId: 'openai', from: 'add' })).toBe('/settings/general');
    expect(parseHref('/settings/providers?from=other')).toEqual({ tab: 'settings', section: 'providers' });
  });
});
