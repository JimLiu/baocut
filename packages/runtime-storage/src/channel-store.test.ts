import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOT_LIMITS, DEFAULT_BOT_SETTINGS, type Channel } from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChannelStore } from './channel-store.ts';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-channels-'));
  file = path.join(dir, 'store', 'channels.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function channel(id: string, patch: Partial<Channel> = {}): Channel {
  return {
    id,
    kind: 'topic',
    name: 'Clips',
    purpose: 'Short clips',
    icon: null,
    color: null,
    groupId: null,
    conversationId: `conv_${id}`,
    driverId: 'claude',
    model: null,
    effort: null,
    defaultAccessMode: null,
    maxAccessMode: 'auto',
    templateId: null,
    pinned: false,
    archived: false,
    archivedAt: null,
    limits: { concurrentThreads: 2, dailyBudget: { amount: '1.00', currency: 'USD' }, monthlyBudget: null },
    outputLanguage: null,
    private: false,
    muted: false,
    stallMinutes: null,
    lastSeen: null,
    memoryVersion: 3,
    seedPending: null,
    unwantedKinds: ['tidy'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...patch,
  };
}

describe('ChannelStore', () => {
  it('缺文件时为空；写入后重新读回一样', async () => {
    const store = new ChannelStore(file);
    await store.load();
    expect(store.list()).toEqual([]);
    expect(store.degraded).toBe(false);
    expect(store.settings()).toEqual(DEFAULT_BOT_SETTINGS);
    expect(store.userMemoryVersion()).toBe(0);

    await store.put(channel('chan_main', { kind: 'main' }));
    await store.put(channel('chan_2'));
    await store.put(channel('chan_2', { name: 'Renamed' }));
    await store.setSettings({ ...DEFAULT_BOT_SETTINGS, stallMinutes: 45, timeZone: 'Asia/Shanghai' });
    await store.setUserMemoryVersion(7);
    await store.put(channel('chan_3'));
    await store.remove('chan_3');
    await store.flush();

    const again = new ChannelStore(file);
    await again.load();
    expect(again.list()).toEqual([channel('chan_main', { kind: 'main' }), channel('chan_2', { name: 'Renamed' })]);
    expect(again.get('chan_2')?.name).toBe('Renamed');
    expect(again.get('chan_3')).toBeUndefined();
    expect(again.settings()).toEqual({ ...DEFAULT_BOT_SETTINGS, stallMinutes: 45, timeZone: 'Asia/Shanghai' });
    expect(again.userMemoryVersion()).toBe(7);
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(1);
  });

  it('手改坏的文件：认不出的频道丢掉，缺的字段补默认值，设置合并在默认值上', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        channels: [
          { id: 'chan_a', conversationId: 'conv_a', driverId: 'codex', name: 'A', archived: 'yes', limits: { concurrentThreads: -1 } },
          { id: 'chan_b', driverId: 'codex' },
          { conversationId: 'conv_c', driverId: 'codex' },
          'garbage',
          null,
        ],
        settings: { stallMinutes: 'x', quietHours: { enabled: false }, background: false },
        userMemoryVersion: 'nope',
      }),
    );
    const store = new ChannelStore(file);
    await store.load();
    const list = store.list();
    expect(list.map((c) => c.id)).toEqual(['chan_a']);
    // 有频道被丢掉：列表可能不全，调用方不能拿「找不到频道」当作不存在。
    expect(store.degraded).toBe(true);
    const a = list[0]!;
    expect(a).toMatchObject({
      kind: 'topic',
      name: 'A',
      purpose: '',
      archived: false,
      private: false,
      muted: false,
      pinned: false,
      memoryVersion: 0,
      seedPending: null,
      lastSeen: null,
      stallMinutes: null,
      outputLanguage: null,
      maxAccessMode: null,
      defaultAccessMode: null,
      unwantedKinds: [],
      limits: { concurrentThreads: BOT_LIMITS.concurrentThreads, dailyBudget: null, monthlyBudget: null },
    });
    expect(Number.isNaN(Date.parse(a.createdAt))).toBe(false);
    expect(store.settings()).toEqual({
      ...DEFAULT_BOT_SETTINGS,
      quietHours: { ...DEFAULT_BOT_SETTINGS.quietHours, enabled: false },
      background: false,
    });
    expect(store.userMemoryVersion()).toBe(0);
  });

  it('图标、颜色、分组与分组列表写入后读回一样；删分组时组里的频道一起回到没分组', async () => {
    const store = new ChannelStore(file);
    await store.load();
    expect(store.groups()).toEqual([]);
    const tutorials = { id: 'grp_tut', name: 'Tutorials', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' };
    const misc = { id: 'grp_misc', name: 'Misc', createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z' };
    await store.put(channel('chan_a', { icon: 'Video', color: 'purple' }));
    await store.putGroup(tutorials, [
      channel('chan_a', { icon: 'Video', color: 'purple', groupId: 'grp_tut' }),
      channel('chan_b', { groupId: 'grp_tut' }),
    ]);
    await store.putGroup(misc);
    await store.flush();

    const again = new ChannelStore(file);
    await again.load();
    expect(again.groups()).toEqual([tutorials, misc]);
    expect(again.group('grp_tut')).toEqual(tutorials);
    expect(again.get('chan_a')).toEqual(channel('chan_a', { icon: 'Video', color: 'purple', groupId: 'grp_tut' }));
    expect(again.get('chan_b')?.groupId).toBe('grp_tut');
    expect(again.degraded).toBe(false);

    const changed = await again.removeGroup('grp_tut', '2026-10-05T00:00:00.000Z');
    expect(changed.map((c) => [c.id, c.groupId, c.updatedAt])).toEqual([
      ['chan_a', null, '2026-10-05T00:00:00.000Z'],
      ['chan_b', null, '2026-10-05T00:00:00.000Z'],
    ]);
    const third = new ChannelStore(file);
    await third.load();
    expect(third.groups()).toEqual([misc]);
    expect(third.list().map((c) => c.groupId)).toEqual([null, null]);
    expect(third.get('chan_a')?.icon).toBe('Video');
  });

  it('旧文件没有图标、颜色与分组：读成 null 与空列表；认不出的图标与颜色、指向不存在分组的频道、主频道的这三样都按没有算', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const legacy = { id: 'chan_old', conversationId: 'conv_old', driverId: 'claude', name: 'Old' };
    await fs.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        channels: [
          legacy,
          { ...legacy, id: 'chan_bad', icon: 'Rocket', color: '#ff0000', groupId: 'grp_gone' },
          { ...legacy, id: 'chan_ok', icon: 'Microphone', color: 'blue', groupId: 'grp_ok' },
          { ...legacy, id: 'chan_main', kind: 'main', icon: 'Video', color: 'red', groupId: 'grp_ok' },
        ],
        groups: [{ id: 'grp_ok', name: 'Kept' }, { name: 'no id' }, 'garbage'],
      }),
    );
    const store = new ChannelStore(file);
    await store.load();
    // 丢掉的是分组，不是频道：频道列表是全的。
    expect(store.degraded).toBe(false);
    const look = (id: string) => {
      const c = store.get(id)!;
      return { icon: c.icon, color: c.color, groupId: c.groupId };
    };
    expect(look('chan_old')).toEqual({ icon: null, color: null, groupId: null });
    expect(look('chan_bad')).toEqual({ icon: null, color: null, groupId: null });
    expect(look('chan_ok')).toEqual({ icon: 'Microphone', color: 'blue', groupId: 'grp_ok' });
    expect(look('chan_main')).toEqual({ icon: null, color: null, groupId: null });
    const groups = store.groups();
    expect(groups.map((g) => [g.id, g.name])).toEqual([['grp_ok', 'Kept']]);
    expect(Number.isNaN(Date.parse(groups[0]!.createdAt))).toBe(false);
    expect(groups[0]!.updatedAt).toBe(groups[0]!.createdAt);

    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, channels: [legacy] }));
    const plain = new ChannelStore(file);
    await plain.load();
    expect(plain.groups()).toEqual([]);
    expect(plain.get('chan_old')).toMatchObject({ icon: null, color: null, groupId: null });
  });

  it('不是 JSON 的文件改名保留，从空开始', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json');
    const store = new ChannelStore(file);
    await store.load();
    expect(store.list()).toEqual([]);
    expect(store.degraded).toBe(true);
    const names = await fs.readdir(path.dirname(file));
    expect(names.some((n) => n.startsWith('channels.json.corrupt-'))).toBe(true);
  });

  it('返回的是副本：改动不经 put 不会影响 Store', async () => {
    const store = new ChannelStore(file);
    await store.load();
    await store.put(channel('chan_1'));
    store.get('chan_1')!.name = 'Changed';
    store.settings().stallMinutes = 1;
    expect(store.get('chan_1')!.name).toBe('Clips');
    expect(store.settings().stallMinutes).toBe(DEFAULT_BOT_SETTINGS.stallMinutes);
  });

  it('withLock 串行执行：并发的先查后建只建出一个；前一个失败不拦住后一个', async () => {
    const store = new ChannelStore(file);
    await store.load();
    const order: string[] = [];
    const ensure = (tag: string): Promise<string> =>
      store.withLock(async () => {
        order.push(`${tag}:start`);
        const existing = store.get('chan_main');
        await new Promise((r) => setTimeout(r, 10));
        if (!existing) await store.put(channel('chan_main', { kind: 'main', name: tag }));
        order.push(`${tag}:end`);
        return store.get('chan_main')!.name;
      });
    const failing = store.withLock(async () => {
      throw new Error('boom');
    });
    const results = await Promise.all([ensure('first'), failing.catch((e: Error) => e.message), ensure('second')]);
    expect(results).toEqual(['first', 'boom', 'first']);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    expect(store.list()).toHaveLength(1);
  });

  it('删除频道先记一笔：频道拿掉、id 记下，重新读回还在；清完去掉', async () => {
    const store = new ChannelStore(file);
    await store.load();
    await store.put(channel('chan_a'));
    await store.put(channel('chan_b'));
    await store.markDeleted('chan_a');
    expect(store.list().map((c) => c.id)).toEqual(['chan_b']);
    expect(store.tombstones()).toEqual(['chan_a']);

    const again = new ChannelStore(file);
    await again.load();
    expect(again.list().map((c) => c.id)).toEqual(['chan_b']);
    expect(again.tombstones()).toEqual(['chan_a']);
    await again.clearTombstone('chan_a');

    const third = new ChannelStore(file);
    await third.load();
    expect(third.tombstones()).toEqual([]);
    expect(third.degraded).toBe(false);
  });
});
