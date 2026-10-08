import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Conversation, TimelineItem } from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore, type ConversationRecord, type ConversationStoreLog } from './conversation-store.ts';

let dir: string;
let warnings: { message: string; fields?: Record<string, unknown> }[];
let log: ConversationStoreLog;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-conversations-'));
  warnings = [];
  log = { info: () => {}, warn: (message, fields) => warnings.push({ message, fields }) };
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function record(id = 'conv_1'): ConversationRecord {
  return {
    schemaVersion: 1,
    conversation: { id, title: 'T', updatedAt: '2026-01-01T00:00:00Z' } as Conversation,
    items: [],
    seq: '0',
    agent: { driverId: 'codex', persistence: null },
  };
}

function agentMessage(id: string, text: string, streaming = true): TimelineItem {
  return { id, createdAt: '2026-01-01T00:00:00Z', taskId: 'task_1', kind: 'agent-message', text, streaming };
}

async function lines(id = 'conv_1'): Promise<Record<string, unknown>[]> {
  const text = await fs.readFile(path.join(dir, `${id}.jsonl`), 'utf8');
  const [header, ...rows] = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(header).toEqual({ op: 'header', formatVersion: 2 });
  return rows;
}

async function reload(): Promise<ConversationStore> {
  const store = new ConversationStore(dir, { log });
  await store.load();
  return store;
}

/** 完整记录的 JSON 等价（去掉 undefined 等差异）。 */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('ConversationStore', () => {
  it('新会话第一行是快照；流式更新同一条 item 只追加 upsert 行；没有变化时不写', async () => {
    const store = new ConversationStore(dir, { log });
    await store.load();
    const r = record();
    store.put(r);
    await store.flush();
    expect((await lines()).map((l) => l.op)).toEqual(['snapshot']);

    const message = agentMessage('item_1', 'he') as Extract<TimelineItem, { kind: 'agent-message' }>;
    r.items.push(message);
    for (const text of ['hel', 'hell', 'hello']) {
      store.markDirty(r.conversation.id);
      await store.flush();
      message.text = text;
    }
    message.streaming = false;
    store.markDirty(r.conversation.id);
    await store.flush();

    const written = await lines();
    expect(written.map((l) => l.op)).toEqual(['snapshot', 'item', 'item', 'item', 'item']);
    expect(written.slice(1).every((l) => (l.item as TimelineItem).id === 'item_1')).toBe(true);

    const size = (await fs.stat(path.join(dir, 'conv_1.jsonl'))).size;
    store.markDirty(r.conversation.id);
    await store.flush();
    expect((await fs.stat(path.join(dir, 'conv_1.jsonl'))).size).toBe(size);

    expect(plain((await reload()).get('conv_1'))).toEqual(plain(r));
  });

  it('元数据与任务合同写成 meta 行，重放结果与内存一致', async () => {
    const store = new ConversationStore(dir, { log });
    await store.load();
    const r = record();
    r.items.push(agentMessage('item_1', 'a'), agentMessage('item_2', 'b'));
    store.put(r);
    await store.flush();

    r.seq = '5';
    r.conversation.title = 'Renamed';
    r.agent.persistence = { threadId: 'th_1' };
    r.tasks = { task_1: { revisions: [], checkResults: [] } };
    (r.items[0] as { text: string }).text = 'a2';
    r.items.push(agentMessage('item_3', 'c'));
    store.markDirty('conv_1');
    await store.flush();

    const written = await lines();
    expect(written.map((l) => l.op)).toEqual(['snapshot', 'item', 'item', 'meta']);
    expect(Object.keys(written[3]!).sort()).toEqual(['agent', 'conversation', 'op', 'seq', 'tasks']);

    r.tasks.task_2 = { revisions: [], checkResults: [] };
    store.markDirty('conv_1');
    await store.flush();
    expect((await lines()).at(-1)).toEqual({ op: 'meta', tasks: { task_2: { revisions: [], checkResults: [] } } });

    const again = await reload();
    expect(plain(again.get('conv_1'))).toEqual(plain(r));
    expect(again.get('conv_1')!.items.map((i) => i.id)).toEqual(['item_1', 'item_2', 'item_3']);

    // 重启后的第一次保存只写变化的部分。
    const loaded = again.get('conv_1')!;
    (loaded.items[1] as { text: string }).text = 'b2';
    again.markDirty('conv_1');
    await again.flush();
    expect((await lines()).map((l) => l.op)).toEqual(['snapshot', 'item', 'item', 'meta', 'meta', 'item']);
  });

  it('item 被删或换了顺序：写快照，不追加', async () => {
    const store = new ConversationStore(dir, { log });
    await store.load();
    const r = record();
    r.items.push(agentMessage('item_1', 'a'), agentMessage('item_2', 'b'), agentMessage('item_3', 'c'));
    store.put(r);
    await store.flush();
    r.items.splice(1, 1);
    store.markDirty('conv_1');
    await store.flush();
    expect((await lines()).map((l) => l.op)).toEqual(['snapshot']);
    r.items.reverse();
    store.markDirty('conv_1');
    await store.flush();
    expect((await lines()).map((l) => l.op)).toEqual(['snapshot']);
    expect((await reload()).get('conv_1')!.items.map((i) => i.id)).toEqual(['item_3', 'item_1']);
  });

  it('末尾残行跳过并记日志；中间读不了的行也跳过', async () => {
    const store = new ConversationStore(dir, { log });
    await store.load();
    const r = record();
    r.items.push(agentMessage('item_1', 'a'));
    store.put(r);
    await store.flush();
    (r.items[0] as { text: string }).text = 'ab';
    store.markDirty('conv_1');
    await store.flush();
    await fs.appendFile(path.join(dir, 'conv_1.jsonl'), '{"op":"item","item":{"id":"item_1","te');

    const again = await reload();
    expect(plain(again.get('conv_1'))).toEqual(plain(r));
    expect(warnings.map((w) => w.message)).toEqual(['Conversation log ends with a partial line; skipped it']);

    // 之后的写入不能接在残行后面：下次读入时能看到。
    const loaded = again.get('conv_1')!;
    loaded.items.push({ id: 'item_2', createdAt: '2026-01-01T00:00:01Z', taskId: 'task_1', kind: 'user-message', text: 'hi' } as TimelineItem);
    again.markDirty('conv_1');
    await again.flush();
    warnings = [];
    const third = await reload();
    expect(plain(third.get('conv_1'))).toEqual(plain(loaded));
    expect(warnings).toEqual([]);
  });

  it('认不出的文件改名为 .corrupt-<时间> 并跳过：文件头不对、没有快照、空文件', async () => {
    await fs.writeFile(path.join(dir, 'conv_bad.jsonl'), 'not json\n{"op":"item"}\n');
    await fs.writeFile(path.join(dir, 'conv_empty.jsonl'), '');
    await fs.writeFile(path.join(dir, 'conv_noheader.jsonl'), `${JSON.stringify({ op: 'snapshot', ...record('conv_noheader') })}\n`);
    await fs.writeFile(path.join(dir, 'conv_noshot.jsonl'), '{"op":"header","formatVersion":2}\n{"op":"item","item":{"id":"x"}}\n');
    const store = new ConversationStore(dir, { log });
    expect(await store.load()).toEqual([]);
    const names = await fs.readdir(dir);
    expect(names.filter((n) => n.endsWith('.jsonl'))).toEqual([]);
    for (const id of ['conv_bad', 'conv_empty', 'conv_noheader', 'conv_noshot']) {
      expect(names.some((n) => n.startsWith(`${id}.jsonl.corrupt-`))).toBe(true);
    }
    expect(warnings).toHaveLength(4);
    // 改名后的文件下次启动不再读。
    warnings = [];
    expect(await (await reload()).list()).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('不认识的 formatVersion 或 schemaVersion：记日志，不读，文件留着', async () => {
    const header = '{"op":"header","formatVersion":2}\n';
    await fs.writeFile(path.join(dir, 'conv_v2.jsonl'), `${header}${JSON.stringify({ op: 'snapshot', ...record('conv_v2'), schemaVersion: 2 })}\n`);
    await fs.writeFile(path.join(dir, 'conv_f3.jsonl'), `{"op":"header","formatVersion":3}\n${JSON.stringify({ op: 'snapshot', ...record('conv_f3') })}\n`);
    await fs.writeFile(path.join(dir, 'conv_old.json'), JSON.stringify({ ...record('conv_old'), schemaVersion: 9 }));
    expect(await (await reload()).list()).toEqual([]);
    expect(warnings.map((w) => w.fields?.formatVersion ?? w.fields?.schemaVersion).sort()).toEqual([2, 3, 9]);
    expect((await fs.readdir(dir)).sort()).toEqual(['conv_f3.jsonl', 'conv_old.json', 'conv_v2.jsonl']);
  });

  it('压缩：日志超过阈值时整份记录写成一行快照，内容等价', async () => {
    const store = new ConversationStore(dir, { log });
    await store.load();
    const r = record();
    const message = agentMessage('item_1', '') as Extract<TimelineItem, { kind: 'agent-message' }>;
    r.items.push(message);
    store.put(r);
    await store.flush();
    let sawLong = false;
    for (let i = 0; i < 200; i++) {
      message.text += 'x';
      store.markDirty('conv_1');
      await store.flush();
      if ((await lines()).length > 50) sawLong = true;
    }
    expect(sawLong).toBe(true);
    // 1 个 item：行数上限是 1 × 4 + 64，压缩过后行数回落。
    expect((await lines()).length).toBeLessThanOrEqual(69);
    expect(plain((await reload()).get('conv_1'))).toEqual(plain(r));
    expect((await fs.readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('旧的 .json 迁移成 .jsonl 快照，旧文件改名为 .json.migrated；有同名 .jsonl 时忽略旧文件', async () => {
    const legacy = record('conv_legacy');
    legacy.items.push(agentMessage('item_1', 'old', false));
    await fs.writeFile(path.join(dir, 'conv_legacy.json'), JSON.stringify(legacy, null, 2));

    const store = await reload();
    expect(plain(store.get('conv_legacy'))).toEqual(plain(legacy));
    expect((await fs.readdir(dir)).sort()).toEqual(['conv_legacy.json.migrated', 'conv_legacy.jsonl']);
    expect((await lines('conv_legacy')).map((l) => l.op)).toEqual(['snapshot']);

    // 迁移后的第一次保存只追加变化。
    const loaded = store.get('conv_legacy')!;
    loaded.items.push(agentMessage('item_2', 'new'));
    store.markDirty('conv_legacy');
    await store.flush();
    expect((await lines('conv_legacy')).map((l) => l.op)).toEqual(['snapshot', 'item']);

    await fs.writeFile(path.join(dir, 'conv_legacy.json'), JSON.stringify(record('conv_legacy')));
    const again = await reload();
    expect(again.get('conv_legacy')!.items).toHaveLength(2);
    expect(warnings.map((w) => w.message)).toEqual(['Legacy conversation file ignored: a conversation log with the same name exists']);
  });

  it('delete 删掉日志文件，挂起的写入不会再把它写回来', async () => {
    const store = new ConversationStore(dir, { log });
    await store.load();
    store.put(record());
    await store.flush();
    store.markDirty('conv_1');
    await store.delete('conv_1');
    await store.flush();
    expect(await fs.readdir(dir)).toEqual([]);
    expect(store.get('conv_1')).toBeUndefined();
  });
});
