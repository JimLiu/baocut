import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateSummary } from '@baocut/protocol';
import { templateCatalogOf } from '../model/home-templates.ts';
import { recentOf, useHomeTemplates } from './home-templates-store.ts';

// Node 里没有可用的 localStorage：给持久化一个内存版本，先于 store 模块加载；预先放一份旧版本存下的记忆。
vi.hoisted(() => {
  const data = new Map<string, string>([
    ['baocut.homeTemplates', JSON.stringify({ state: { recent: ['tips', 7, 'vlog-edit'] }, version: 1 })],
  ]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

// 在 beforeEach 复位之前记下读出来的那份。
const hydrated = useHomeTemplates.getState().recent;

function summary(id: string): TemplateSummary {
  return {
    manifest: {
      schema: 1,
      id,
      version: '1.0.0',
      kind: 'scene',
      title: id,
      summary: '一句话',
      description: '一小段',
      language: 'zh-CN',
      category: 'marketing',
      ratio: '16:9',
      durationSeconds: 30,
      brief: '示例',
      author: 'BaoCut',
      source: 'official',
      license: 'Apache-2.0',
      tags: [],
      cover: { tone: 'blue', figure: 'bars' },
      preview: { beats: ['一', '二', '三'] },
    },
    origin: 'builtin',
    files: { cover: false, preview: false, assets: 0 },
  };
}

const catalog = templateCatalogOf(['promo-ad', 'knowledge-explainer', 'data-story', 'white-ui-launch', 'vlog-edit'].map(summary));

describe('useHomeTemplates', () => {
  beforeEach(() => useHomeTemplates.setState({ recent: [] }));

  it('读出来的记忆只留字符串，不按目录过滤（那时目录还没取到）', () => {
    expect(hydrated).toEqual(['tips', 'vlog-edit']);
    expect(recentOf({ recent: ['tips', 3, '', 'vlog-edit', null] })).toEqual(['tips', 'vlog-edit']);
    expect(recentOf({ recent: 'tips' })).toEqual([]);
    expect(recentOf(null)).toEqual([]);
  });

  it('选的时候按当时的目录重算：旧版本存的键清掉，用默认补齐，新面孔排到最前', () => {
    useHomeTemplates.setState({ recent: ['tips', 'anim'] });
    useHomeTemplates.getState().pick('white-ui-launch', catalog);
    expect(useHomeTemplates.getState().recent).toEqual(['white-ui-launch', 'promo-ad', 'knowledge-explainer', 'data-story', 'vlog-edit']);
    useHomeTemplates.getState().pick('promo-ad', catalog);
    expect(useHomeTemplates.getState().recent).toEqual(['white-ui-launch', 'promo-ad', 'knowledge-explainer', 'data-story', 'vlog-edit']);
  });
});
