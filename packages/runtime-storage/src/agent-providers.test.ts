import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentProviderStore } from './agent-providers.ts';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-agent-providers-store-'));
  file = path.join(dir, 'store', 'agent-providers.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const at = '2026-10-06T00:00:00.000Z';

describe('AgentProviderStore', () => {
  it('没有文件或文件损坏时当没有', async () => {
    expect(await new AgentProviderStore(file).load()).toEqual([]);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json');
    expect(await new AgentProviderStore(file).load()).toEqual([]);
  });

  it('丢掉不合法的条目：id 写法不对、内置 id、重名、命令为空、名字为空', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const ok = { id: 'my-agent', name: 'Mine', command: ['my-agent', '--acp'], env: { A: '1', B: 2 }, addedAt: at };
    await fs.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        providers: [
          ok,
          { ...ok, name: 'Again' },
          { ...ok, id: 'Bad_Id' },
          { ...ok, id: 'gemini' },
          { ...ok, id: 'empty', command: [] },
          { ...ok, id: 'blank', name: '  ' },
        ],
      }),
    );
    expect(await new AgentProviderStore(file).load()).toEqual([{ ...ok, env: { A: '1' } }]);
  });

  it('加与删落盘，文件权限 0600；重复的 id 抛错，删不存在的返回 false', async () => {
    const store = new AgentProviderStore(file);
    await store.load();
    await store.add({ id: 'one', name: 'One', command: ['one'], addedAt: at });
    await store.add({ id: 'two', name: 'Two', command: ['two', '--acp'], env: { KEY: 'v' }, addedAt: at });
    await expect(store.add({ id: 'one', name: 'Again', command: ['x'], addedAt: at })).rejects.toThrow();
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await new AgentProviderStore(file).load()).map((p) => p.id)).toEqual(['one', 'two']);

    expect(await store.remove('one')).toBe(true);
    expect(await store.remove('one')).toBe(false);
    expect(await new AgentProviderStore(file).load()).toEqual([
      { id: 'two', name: 'Two', command: ['two', '--acp'], env: { KEY: 'v' }, addedAt: at },
    ]);
  });
});
