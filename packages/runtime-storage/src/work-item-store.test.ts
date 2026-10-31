import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ThreadReport, WorkItem, WorkItemTransition } from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TRANSITIONS_KEPT_PER_ITEM, WorkItemStore } from './work-item-store.ts';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-work-items-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const CH = 'chan_1';

function item(id: string, patch: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    channelId: CH,
    title: `Item ${id}`,
    titleBy: 'user',
    description: 'desc',
    owner: 'agent',
    status: 'upNext',
    active: null,
    resolution: null,
    priority: 'medium',
    dueOn: null,
    eventOn: null,
    startAt: null,
    steps: [{ text: 'step', state: 'pending' }],
    finishedSteps: [],
    updates: [{ text: 'u', at: '2026-10-01T00:00:00.000Z', by: 'thread' }],
    outcome: null,
    question: null,
    resources: [],
    outputs: [],
    dependsOn: [],
    overrides: null,
    baseVersions: [],
    lastProgressAt: null,
    budgetWarnedAt: null,
    files: ['out/a.mp4'],
    suggestion: null,
    source: { kind: 'manual', messageId: null, scheduleId: null, runId: null },
    threadId: 'conv_t',
    threadStarts: 1,
    lastReportId: null,
    deferredStop: null,
    beforeInput: null,
    reminded: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...patch,
  };
}

function report(id: string, workItemId: string, headline = 'Done'): ThreadReport {
  return {
    id,
    workItemId,
    threadId: 'conv_t',
    taskId: 'task_1',
    stop: 'done',
    headline,
    text: 'text',
    question: null,
    outputs: [],
    userTodos: [],
    followUps: [],
    waitingFor: null,
    appliedRules: [],
    fallback: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    delivery: 'pending',
  };
}

function transition(workItemId: string, n: number): WorkItemTransition {
  return { workItemId, from: 'upNext', to: 'working', actor: 'system', cause: `test:${n}`, note: null, at: '2026-10-01T00:00:00.000Z' };
}

async function ops(channelId = CH): Promise<string[]> {
  const text = await fs.readFile(path.join(dir, `${channelId}.jsonl`), 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => (JSON.parse(l) as { op: string }).op);
}

describe('WorkItemStore', () => {
  it('追加、按 id 替换、删除，重新读回', async () => {
    const store = new WorkItemStore(dir);
    expect(await store.load(CH)).toEqual({ items: [], reports: [], transitions: [], degraded: false });
    await store.putItem(CH, item('w1'), { sync: true });
    await store.putItem(CH, item('w2'), { sync: true });
    await store.putItem(CH, item('w1', { title: 'New title' }), { sync: true });
    await store.appendReport(CH, report('r1', 'w1'));
    await store.appendReport(CH, report('r1', 'w1', 'Replaced'));
    await store.appendReport(CH, report('r2', 'w2'));
    await store.appendTransition(CH, transition('w1', 1));
    await store.appendTransition(CH, transition('w2', 2));
    await store.removeItem(CH, 'w2');
    expect(await ops()).toEqual(['header', 'item', 'item', 'item', 'report', 'report', 'report', 'transition', 'transition', 'removed']);

    const loaded = await new WorkItemStore(dir).load(CH);
    expect(loaded.items).toEqual([item('w1', { title: 'New title' })]);
    expect(loaded.reports).toEqual([report('r1', 'w1', 'Replaced')]);
    expect(loaded.transitions).toEqual([transition('w1', 1)]);
    expect(await store.load(CH)).toEqual(loaded);
  });

  it('去抖写合并同一条任务；同步写先带上挂起的去抖行，顺序不乱', async () => {
    const store = new WorkItemStore(dir);
    await store.putItem(CH, item('w1'), { sync: true });
    void store.putItem(CH, item('w2', { description: 'v1' }), { sync: false });
    void store.putItem(CH, item('w2', { description: 'v2' }), { sync: false });
    void store.putItem(CH, item('w1', { description: 'debounced' }), { sync: false });
    // 还没到 150 ms：只有第一行。
    expect(await ops()).toEqual(['header', 'item']);
    await store.appendReport(CH, report('r1', 'w2'));
    const text = await fs.readFile(path.join(dir, `${CH}.jsonl`), 'utf8');
    const rows = text
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => JSON.parse(l) as { op: string; item?: WorkItem });
    expect(rows.map((r) => r.op)).toEqual(['item', 'item', 'item', 'report']);
    expect(rows.slice(1, 3).map((r) => [r.item!.id, r.item!.description])).toEqual([
      ['w2', 'v2'],
      ['w1', 'debounced'],
    ]);
  });

  it('去抖写在 150 ms 后落盘，兑现于落盘之后；flush 立即写', async () => {
    const store = new WorkItemStore(dir);
    const started = Date.now();
    await store.putItem(CH, item('w1'), { sync: false });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(await ops()).toEqual(['header', 'item']);

    void store.putItem(CH, item('w1', { title: 'B' }), { sync: false });
    await store.flush();
    expect(await ops()).toEqual(['header', 'item', 'item']);
    expect((await new WorkItemStore(dir).load(CH)).items[0]!.title).toBe('B');
  });

  it('同步写同一条任务时丢掉它挂起的旧版本；删除后挂起的旧版本不复活', async () => {
    const store = new WorkItemStore(dir);
    void store.putItem(CH, item('w1', { title: 'stale' }), { sync: false });
    await store.putItem(CH, item('w1', { title: 'fresh' }), { sync: true });
    void store.putItem(CH, item('w2'), { sync: false });
    await store.removeItem(CH, 'w2');
    await store.flush();
    expect(await ops()).toEqual(['header', 'item', 'removed']);
    const loaded = await new WorkItemStore(dir).load(CH);
    expect(loaded.items.map((i) => i.title)).toEqual(['fresh']);
  });

  it('末尾残行与未知的 op 跳过；下次写入整份重写', async () => {
    const file = path.join(dir, `${CH}.jsonl`);
    await fs.writeFile(
      file,
      [
        JSON.stringify({ op: 'header', formatVersion: 1 }),
        JSON.stringify({ op: 'item', item: item('w1') }),
        JSON.stringify({ op: 'future-op', x: 1 }),
        JSON.stringify({ op: 'item', item: { noId: true } }),
        '{"op":"item","item":{"id":"w2"',
      ].join('\n'),
    );
    const store = new WorkItemStore(dir);
    const loaded = await store.load(CH);
    expect(loaded.items.map((i) => i.id)).toEqual(['w1']);
    expect(loaded.degraded).toBe(true);
    await store.appendTransition(CH, transition('w1', 1));
    expect(await ops()).toEqual(['header', 'snapshot']);
    const again = await new WorkItemStore(dir).load(CH);
    expect(again.items).toEqual([item('w1')]);
    expect(again.transitions).toEqual([transition('w1', 1)]);
  });

  it('更新版本写下的日志：不读、不改写，并标为没读全', async () => {
    const file = path.join(dir, `${CH}.jsonl`);
    const text = [JSON.stringify({ op: 'header', formatVersion: 99 }), JSON.stringify({ op: 'item', item: item('w1') })].join('\n') + '\n';
    await fs.writeFile(file, text);
    const store = new WorkItemStore(dir);
    const loaded = await store.load(CH);
    expect(loaded).toMatchObject({ items: [], degraded: true });
    await store.putItem(CH, item('w2'), { sync: true });
    expect(await fs.readFile(file, 'utf8')).toBe(text);
  });

  it('文件头认不出时改名保留，从空开始', async () => {
    await fs.writeFile(path.join(dir, `${CH}.jsonl`), 'not json\n');
    const loaded = await new WorkItemStore(dir).load(CH);
    expect(loaded.items).toEqual([]);
    expect(loaded.degraded).toBe(true);
    expect((await fs.readdir(dir)).some((n) => n.startsWith(`${CH}.jsonl.corrupt-`))).toBe(true);
  });

  it('行数超过阈值时自动压缩成快照，状态不变', async () => {
    const store = new WorkItemStore(dir);
    for (let i = 0; i < 80; i++) await store.putItem(CH, item('w1', { description: `v${i}` }), { sync: true });
    const written = await ops();
    expect(written[1]).toBe('snapshot');
    expect(written.length).toBeLessThan(80);
    const loaded = await new WorkItemStore(dir).load(CH);
    expect(loaded.items).toEqual([item('w1', { description: 'v79' })]);
  });

  it('压缩时每条任务只留最近 100 条转换，更早的追加到归档；久已解决的任务只留摘要', async () => {
    const store = new WorkItemStore(dir);
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const resolution = (at: string): WorkItem['resolution'] => ({ kind: 'done', by: 'user', at, evidence: null, confirmedBy: null, mergedInto: null });
    await store.putItem(CH, item('w1'), { sync: true });
    await store.putItem(CH, item('old', { status: 'resolved', outcome: 'Shipped', resolution: resolution(old) }), { sync: true });
    await store.putItem(CH, item('recent', { status: 'resolved', resolution: resolution(recent) }), { sync: true });
    await store.appendReport(CH, report('r1', 'old'));
    for (let i = 0; i < 130; i++) await store.appendTransition(CH, transition('w1', i));
    for (let i = 0; i < 5; i++) await store.appendTransition(CH, transition('recent', i));
    await store.compact(CH);
    expect(await ops()).toEqual(['header', 'snapshot']);

    const loaded = await new WorkItemStore(dir).load(CH);
    const w1 = loaded.transitions.filter((t) => t.workItemId === 'w1');
    expect(w1).toHaveLength(TRANSITIONS_KEPT_PER_ITEM);
    expect(w1[0]!.cause).toBe('test:30');
    expect(w1.at(-1)!.cause).toBe('test:129');
    expect(loaded.transitions.filter((t) => t.workItemId === 'recent')).toHaveLength(5);
    expect(loaded.reports.map((r) => r.id)).toEqual(['r1']);

    const archived = (await fs.readFile(path.join(dir, `${CH}.transitions.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { op: string; transition?: WorkItemTransition });
    expect(archived[0]).toEqual({ op: 'header', formatVersion: 1 });
    expect(archived.slice(1).map((r) => r.transition!.cause)).toEqual(Array.from({ length: 30 }, (_, i) => `test:${i}`));

    const summary = loaded.items.find((i) => i.id === 'old')!;
    expect(summary).toMatchObject({ id: 'old', title: 'Item old', status: 'resolved', outcome: 'Shipped', threadId: 'conv_t', files: ['out/a.mp4'] });
    expect(summary.resolution?.at).toBe(old);
    expect(summary.description).toBe('');
    expect(summary.steps).toEqual([]);
    expect(summary.updates).toEqual([]);
    expect(loaded.items.find((i) => i.id === 'recent')!.description).toBe('desc');
    expect(loaded.items.find((i) => i.id === 'w1')).toEqual(item('w1'));

    // 压缩之后继续追加，重放仍然正确。
    await store.appendTransition(CH, transition('w1', 130));
    const after = await new WorkItemStore(dir).load(CH);
    expect(after.transitions.filter((t) => t.workItemId === 'w1').at(-1)!.cause).toBe('test:130');
  });

  it('deleteChannel 删掉日志与归档；频道之间互不影响', async () => {
    const store = new WorkItemStore(dir);
    await store.putItem(CH, item('w1'), { sync: true });
    await store.putItem('chan_2', item('w9'), { sync: true });
    for (let i = 0; i < 101; i++) await store.appendTransition(CH, transition('w1', i));
    await store.compact(CH);
    void store.putItem(CH, item('w2'), { sync: false });
    await store.deleteChannel(CH);
    await store.flush();
    const names = await fs.readdir(dir);
    expect(names).toEqual(['chan_2.jsonl']);
    expect(await store.load(CH)).toEqual({ items: [], reports: [], transitions: [], degraded: false });
    expect((await store.load('chan_2')).items.map((i) => i.id)).toEqual(['w9']);
  });

  it('不安全的频道 id 被拒绝', async () => {
    const store = new WorkItemStore(dir);
    await expect(store.load('../x')).rejects.toThrow();
    await expect(store.putItem('a/b', item('w1'), { sync: true })).rejects.toThrow();
  });
});
