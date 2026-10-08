import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, SETTING_DEFAULTS } from '@baocut/protocol';
import { SettingsStore, type SettingsChange } from './settings-store.ts';

describe('SettingsStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-settings-'));
    file = path.join(dir, 'store', 'settings.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function open(): Promise<SettingsStore> {
    const store = new SettingsStore(file);
    await store.load();
    return store;
  }

  async function rejection(promise: Promise<unknown>): Promise<RpcError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof RpcError) return error;
      throw error;
    }
    throw new Error('应该被拒绝');
  }

  async function exists(target: string): Promise<boolean> {
    return fs.stat(target).then(
      () => true,
      () => false,
    );
  }

  it('没有文件时全是默认值，来源是 default', async () => {
    const store = await open();
    expect(store.snapshotAll()).toEqual({ settings: SETTING_DEFAULTS, defaults: SETTING_DEFAULTS });
    expect(store.view(['offline.strict'])).toEqual({ settings: { 'offline.strict': false }, defaults: { 'offline.strict': false } });
    expect(store.snapshot(['agent.defaultAccessMode']).sources).toEqual({ 'agent.defaultAccessMode': 'default' });
    expect(await exists(file)).toBe(false);
  });

  it('未知的键与坏值整批拒绝，什么都不落盘', async () => {
    const store = await open();
    const unknown = await rejection(store.set({ 'offline.strict': true, 'openai.apiKey': 'sk-test' }));
    expect(unknown.code).toBe('invalid-request');
    const bad = await rejection(store.set({ 'offline.strict': true, 'agent.defaultAccessMode': 'everything' }));
    expect(bad.code).toBe('invalid-request');
    expect(await exists(file)).toBe(false);
    expect(store.get('offline.strict')).toBe(false);

    await store.set({ 'updates.autoCheck': false });
    const before = await fs.readFile(file, 'utf8');
    await rejection(store.set({ 'updates.autoCheck': true, 'captions.maxLineLength': { cjk: 1, other: 42 } }));
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(store.get('updates.autoCheck')).toBe(false);
  });

  it('改值、null 恢复默认；等于默认值的取值不另存；只在有效值变化时通知', async () => {
    const store = await open();
    const events: SettingsChange[] = [];
    store.onChange((changed) => events.push(changed));

    // 旧值 authorized 按 fullAccess 存。
    const first = await store.set({ 'agent.defaultAccessMode': 'authorized', 'captions.maxLineLength': { other: 40, cjk: 18 } });
    expect(first.changed).toEqual({ 'agent.defaultAccessMode': 'fullAccess', 'captions.maxLineLength': { cjk: 18, other: 40 } });
    expect(first.snapshot.settings['agent.defaultAccessMode']).toBe('fullAccess');
    expect(store.snapshot(['agent.defaultAccessMode']).sources['agent.defaultAccessMode']).toBe('user');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).values['agent.defaultAccessMode']).toBe('fullAccess');

    // 同样的值再设一次（新写法）：不变，不通知。
    const again = await store.set({ 'agent.defaultAccessMode': 'fullAccess' });
    expect(again.changed).toEqual({});

    const reset = await store.set({ 'agent.defaultAccessMode': null, 'captions.maxLineLength': { cjk: 16, other: 42 } });
    expect(reset.changed).toEqual({ 'agent.defaultAccessMode': 'auto', 'captions.maxLineLength': { cjk: 16, other: 42 } });
    expect(store.snapshot(['agent.defaultAccessMode']).sources['agent.defaultAccessMode']).toBe('default');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ schemaVersion: 1, values: {} });

    expect(events).toEqual([first.changed, reset.changed]);
  });

  it('重新打开后保留；文件里不认识的键原样保留，坏值按默认处理', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({ schemaVersion: 1, values: { 'future.thing': { a: 1 }, 'updates.autoCheck': 'maybe', 'offline.strict': true } }),
    );
    const store = await open();
    expect(store.get('offline.strict')).toBe(true);
    expect(store.get('updates.autoCheck')).toBe(true);
    expect(store.snapshot(['updates.autoCheck']).sources['updates.autoCheck']).toBe('default');

    await store.set({ 'downloads.directory': '/tmp/downloads' });
    const reopened = await open();
    expect(reopened.get('downloads.directory')).toBe('/tmp/downloads');
    expect(reopened.get('offline.strict')).toBe(true);
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as { values: Record<string, unknown> };
    expect(saved.values['future.thing']).toEqual({ a: 1 });
  });

  it('文件里存着旧的访问模式：读出来换成新值，仍算用户设置', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, values: { 'agent.defaultAccessMode': 'controlled' } }));
    const store = await open();
    expect(store.get('agent.defaultAccessMode')).toBe('ask');
    expect(store.snapshot(['agent.defaultAccessMode'])).toMatchObject({
      values: { 'agent.defaultAccessMode': 'ask' },
      sources: { 'agent.defaultAccessMode': 'user' },
    });

    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, values: { 'agent.defaultAccessMode': 'authorized' } }));
    expect((await open()).get('agent.defaultAccessMode')).toBe('fullAccess');
  });

  it('文件不是合法的 JSON 时打开失败', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json');
    await expect(open()).rejects.toThrow();
  });

  it('并发的修改串行执行，后一笔看得到前一笔', async () => {
    const store = await open();
    const results = await Promise.all([
      store.set({ 'offline.strict': true }),
      store.set({ 'diagnostics.enabled': true }),
      store.set({ 'offline.strict': null }),
    ]);
    expect(results.map((r) => r.changed)).toEqual([
      { 'offline.strict': true },
      { 'diagnostics.enabled': true },
      { 'offline.strict': false },
    ]);
    const reopened = await open();
    expect(reopened.snapshotAll().settings).toMatchObject({ 'offline.strict': false, 'diagnostics.enabled': true });
    const leftovers = (await fs.readdir(path.dirname(file))).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('冻结的取值是副本：之后改设置不影响它', async () => {
    const store = await open();
    await store.set({ 'captions.maxLineLength': { cjk: 20, other: 50 } });
    const frozen = store.snapshot(['captions.maxLineLength']);
    await store.set({ 'captions.maxLineLength': null });
    expect(frozen.values['captions.maxLineLength']).toEqual({ cjk: 20, other: 50 });
    frozen.values['captions.maxLineLength'].cjk = 99;
    expect(store.get('captions.maxLineLength')).toEqual({ cjk: 16, other: 42 });
  });
});
