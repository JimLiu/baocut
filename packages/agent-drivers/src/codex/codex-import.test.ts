import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { createFakeCodex, type FakeCodex, type FakeCodexThread } from '../testing/fake-codex.ts';
import { CodexDriver } from './codex-driver.ts';

/**
 * 导入 Codex 的本机会话（产品设计 §3.1「导入外部会话」）：对着假 codex 的 `thread/list`、`thread/read` 与 `thread/items/list`。
 * 从不启动本机真实的 codex；取完就关掉临时的 app-server。
 */

const turns: FakeCodexThread['turns'] = [
  {
    id: 'turn_1',
    items: [
      { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Make a trailer. Keep it short.' }] },
      { type: 'reasoning', id: 'r1', summary: [], content: [] },
      { type: 'commandExecution', id: 'c1', command: 'ffprobe in.mp4\n', cwd: '/work/promo', status: 'completed' },
      { type: 'fileChange', id: 'f1', changes: [{ path: 'cut.json', kind: { type: 'update' }, diff: '' }], status: 'declined' },
      { type: 'agentMessage', id: 'a1', text: 'Done.' },
    ],
  },
  {
    id: 'turn_2',
    items: [
      { type: 'userMessage', id: 'u2', content: [{ type: 'text', text: 'Again' }] },
      { type: 'webSearch', id: 'w1', query: 'trailer tips' },
    ],
  },
];

describe('Codex 的本机会话（假 codex）', () => {
  let dir: string;
  let fake: FakeCodex;
  let driver: CodexDriver;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-codex-import-'));
    fake = await createFakeCodex(path.join(dir, 'fake'), {
      threads: [
        { id: 'thr_a', cwd: '/work/promo', preview: 'Make a trailer. Keep it short.', updatedAt: 1_793_000_000, turns },
        { id: 'thr_b', preview: 'No folder', updatedAt: 1_792_000_000, turns: [] },
        { id: 'thr_c', cwd: '/work/c', name: 'Renamed', updatedAt: 1_791_000_000, historyMode: 'paginated', turns },
      ],
    });
    driver = new CodexDriver(silentLogger, { locate: fake.locate });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('翻页列出线程：第一句话、目录（没给就是 null）、更新时间', async () => {
    expect(await driver.listNativeSessions({ limit: 10 })).toEqual([
      {
        nativeId: 'thr_a',
        persistence: { driverId: 'codex', data: { threadId: 'thr_a' } },
        cwd: '/work/promo',
        title: 'Make a trailer.',
        turns: null,
        updatedAt: new Date(1_793_000_000_000).toISOString(),
      },
      {
        nativeId: 'thr_b',
        persistence: { driverId: 'codex', data: { threadId: 'thr_b' } },
        cwd: null,
        title: 'No folder',
        turns: null,
        updatedAt: new Date(1_792_000_000_000).toISOString(),
      },
      {
        nativeId: 'thr_c',
        persistence: { driverId: 'codex', data: { threadId: 'thr_c' } },
        cwd: '/work/c',
        title: 'Renamed',
        turns: null,
        updatedAt: new Date(1_791_000_000_000).toISOString(),
      },
    ]);
    expect(fake.requests('thread/list').map((r) => r.params.sortKey)).toEqual(['updated_at', 'updated_at']);
    expect(fake.log().filter((e) => e.kind === 'catalog-exit').length).toBe(1);
  });

  it('读出记录：每个用户输入一轮，命令、改文件、搜索成步骤，被拒的标失败；两种存法读出来一样', async () => {
    const legacy = await driver.readNativeSession('thr_a');
    expect(legacy.persistence).toEqual({ driverId: 'codex', data: { threadId: 'thr_a' } });
    expect(legacy.cwd).toBe('/work/promo');
    expect(legacy.turns.map((t) => [t.user, t.steps])).toEqual([
      [
        'Make a trailer. Keep it short.',
        [
          { kind: 'tool', tool: 'command', title: 'ffprobe in.mp4', detail: null, status: 'completed' },
          { kind: 'tool', tool: 'other', title: 'Edit cut.json', detail: null, status: 'failed' },
          { kind: 'message', text: 'Done.' },
        ],
      ],
      ['Again', [{ kind: 'tool', tool: 'web-search', title: 'trailer tips', detail: null, status: 'completed' }]],
    ]);
    const paged = await driver.readNativeSession('thr_c');
    expect(paged.title).toBe('Renamed');
    expect(paged.turns.map((t) => [t.user, t.steps])).toEqual(legacy.turns.map((t) => [t.user, t.steps]));
    expect(fake.requests('thread/items/list').length).toBe(4);
  });

  it('没有的线程是 not-found', async () => {
    await expect(driver.readNativeSession('thr_missing')).rejects.toMatchObject({ code: 'not-found' });
  });
});
