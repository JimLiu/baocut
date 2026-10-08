import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPrefsStore } from './agent-prefs.ts';
import { AgentProbeStore } from './agent-probes.ts';
import { AgentProviderStore } from './agent-providers.ts';
import { GrantStore } from './grant-store.ts';
import { ProjectStore } from './project-store.ts';
import { SettingsStore } from './settings-store.ts';
import { SkillPrefsStore } from './skill-prefs.ts';
import { SpaceArtifactStore } from './space-artifacts.ts';
import { SpaceMarkStore } from './space-marks.ts';
import { JsonStoreFile, readJsonOrQuarantine, type StoreLog } from './store-file.ts';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-store-file-'));
  file = path.join(dir, 'store.json');
});

afterEach(async () => {
  await fs.chmod(dir, 0o700).catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
});

function spyLog() {
  return { info: vi.fn<StoreLog['info']>(), warn: vi.fn<StoreLog['warn']>() };
}

const corruptNames = async () => (await fs.readdir(dir)).filter((n) => n.startsWith(`${path.basename(file)}.corrupt-`));

describe('readJsonOrQuarantine', () => {
  const recognize = (raw: Record<string, unknown>) => (Array.isArray(raw.items) ? raw.items : null);

  it('文件不在时 missing', async () => {
    expect(await readJsonOrQuarantine(file, { recognize })).toEqual({ status: 'missing', value: null });
  });

  it('空文件（或只有空白）按没有处理，记 warn，不改名', async () => {
    await fs.writeFile(file, '  \n');
    const log = spyLog();
    expect(await readJsonOrQuarantine(file, { recognize, log })).toEqual({ status: 'empty', value: null });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(await fs.readdir(dir)).toEqual([path.basename(file)]);
  });

  it.each([
    ['不是 JSON', '{ not json'],
    ['顶层是数组', '[1, 2]'],
    ['顶层是数字', '42'],
    ['形状认不出', JSON.stringify({ schemaVersion: 1, items: 'nope' })],
  ])('%s：改名保留、记 warn', async (_label, text) => {
    await fs.writeFile(file, text);
    const log = spyLog();
    const read = await readJsonOrQuarantine(file, { recognize, log });
    expect(read.status).toBe('quarantined');
    const names = await corruptNames();
    expect(names).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, names[0]!), 'utf8')).toBe(text);
    expect(await fs.stat(file).catch(() => null)).toBeNull();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('版本高于已知：不改名，记 warn，按空处理（版本检查在形状检查之前）', async () => {
    const text = JSON.stringify({ schemaVersion: 2, entries: {} });
    await fs.writeFile(file, text);
    const log = spyLog();
    expect(await readJsonOrQuarantine(file, { recognize, log })).toEqual({ status: 'newer-version', value: null, version: 2 });
    expect(await fs.readFile(file, 'utf8')).toBe(text);
    expect(await corruptNames()).toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('没有版本字段（早期的文件）照常交给 recognize', async () => {
    await fs.writeFile(file, JSON.stringify({ items: [1] }));
    expect(await readJsonOrQuarantine(file, { recognize })).toEqual({ status: 'ok', value: [1] });
  });

  it('quarantine: false 时认不出的文件不改名', async () => {
    await fs.writeFile(file, '{ not json');
    expect(await readJsonOrQuarantine(file, { recognize, quarantine: false })).toEqual({ status: 'unrecognized', value: null });
    expect(await fs.readFile(file, 'utf8')).toBe('{ not json');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('文件系统读不了时抛出，不当作坏文件', async () => {
    await fs.writeFile(file, '{}');
    await fs.chmod(file, 0o000);
    await expect(readJsonOrQuarantine(file, { recognize })).rejects.toMatchObject({ code: 'EACCES' });
    await fs.chmod(file, 0o600);
    expect(await corruptNames()).toEqual([]);
  });
});

describe('JsonStoreFile', () => {
  it('读到更新版本的文件之后不再写它', async () => {
    const text = JSON.stringify({ schemaVersion: 9 });
    await fs.writeFile(file, text);
    const log = spyLog();
    const store = new JsonStoreFile(file, log);
    await store.read({ recognize: (raw) => raw });
    expect(store.readOnly).toBe(true);
    await store.write({ schemaVersion: 1 });
    await store.write({ schemaVersion: 1 });
    expect(await fs.readFile(file, 'utf8')).toBe(text);
    // 读的一条加上跳过写入的一条（只记一次）。
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});

/** 一类可以从空开始的 Store：坏文件改名保留、版本过高不改名也不覆盖、空文件按没有处理。 */
interface Case {
  name: string;
  /** 打开并读入；返回 Store 当前内容的摘要（空时与 `empty` 相等）。 */
  load: (file: string, log: StoreLog) => Promise<{ summary: unknown; write: () => Promise<unknown> }>;
  empty: unknown;
  versionKey?: string;
}

const cases: Case[] = [
  {
    name: 'ProjectStore',
    empty: [],
    load: async (f, log) => {
      const store = new ProjectStore(f, { log });
      const summary = await store.load();
      return {
        summary,
        write: () =>
          store.put({ id: 'p1', name: 'P', path: '/tmp/p', createdAt: 't', lastOpenedAt: 't', pinned: false, archived: false } as never),
      };
    },
  },
  {
    name: 'SpaceMarkStore',
    empty: null,
    load: async (f, log) => {
      const store = new SpaceMarkStore(f, { log });
      await store.load();
      return { summary: store.get('x').favorite ? 'marked' : null, write: () => store.put('x', { favorite: true, displayName: null, trashedAt: null }) };
    },
  },
  {
    name: 'SpaceArtifactStore',
    empty: [],
    load: async (f, log) => {
      const store = new SpaceArtifactStore(f, { log });
      await store.load();
      return { summary: store.list(), write: () => store.put([{ jobId: 'job-1' } as never]) };
    },
  },
  {
    name: 'SettingsStore',
    empty: false,
    load: async (f, log) => {
      const store = new SettingsStore(f, { log });
      await store.load();
      return { summary: store.get('offline.strict'), write: () => store.set({ 'offline.strict': true }) };
    },
  },
  {
    name: 'AgentPrefsStore',
    empty: [],
    load: async (f, log) => {
      const store = new AgentPrefsStore(f, { log });
      const prefs = await store.load();
      return { summary: prefs.rules, write: () => store.update((p) => void p.rules.push('r')) };
    },
  },
  {
    name: 'AgentProviderStore',
    empty: [],
    load: async (f, log) => {
      const store = new AgentProviderStore(f, { log });
      const list = await store.load();
      return { summary: list, write: () => store.add({ id: 'mine', name: 'Mine', command: ['mine'], addedAt: new Date(0).toISOString() } as never) };
    },
  },
  {
    name: 'AgentProbeStore',
    empty: {},
    load: async (f, log) => {
      const store = new AgentProbeStore(f, { log });
      return { summary: await store.load(), write: () => store.save({}) };
    },
  },
  {
    name: 'SkillPrefsStore',
    empty: {},
    load: async (f, log) => {
      const store = new SkillPrefsStore(f, { log });
      const prefs = await store.load();
      return { summary: prefs.enabled, write: () => store.set('my-skill', false, true) };
    },
  },
];

describe.each(cases)('$name', ({ load, empty }) => {
  it('坏文件改名保留、记 warn、从空开始；之后的写入写新文件', async () => {
    await fs.writeFile(file, '{ not json');
    const log = spyLog();
    const { summary, write } = await load(file, log);
    expect(summary).toEqual(empty);
    expect(log.warn).toHaveBeenCalled();
    const names = await corruptNames();
    expect(names).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, names[0]!), 'utf8')).toBe('{ not json');
    await write();
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({ schemaVersion: 1 });
  });

  it('顶层结构认不出时同样改名保留', async () => {
    await fs.writeFile(file, '[]');
    const { summary } = await load(file, spyLog());
    expect(summary).toEqual(empty);
    expect(await corruptNames()).toHaveLength(1);
  });

  it('版本高于已知：按空处理，不改名，之后的写入也不覆盖', async () => {
    const text = JSON.stringify({ schemaVersion: 99, future: true });
    await fs.writeFile(file, text);
    const log = spyLog();
    const { summary, write } = await load(file, log);
    expect(summary).toEqual(empty);
    await write();
    expect(await fs.readFile(file, 'utf8')).toBe(text);
    expect(await corruptNames()).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
  });

  it('空文件按没有处理，不改名', async () => {
    await fs.writeFile(file, '');
    const { summary } = await load(file, spyLog());
    expect(summary).toEqual(empty);
    expect(await corruptNames()).toEqual([]);
  });
});

describe('GrantStore（授权账本不能静默丢）', () => {
  it('坏文件：打开失败，文件原样留着、不改名', async () => {
    await fs.writeFile(file, '{ not json');
    await expect(GrantStore.open(file)).rejects.toThrow(/Malformed grants file/);
    expect(await fs.readFile(file, 'utf8')).toBe('{ not json');
    expect(await corruptNames()).toEqual([]);
  });

  it('顶层结构认不出：打开失败', async () => {
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, grants: {} }));
    await expect(GrantStore.open(file)).rejects.toThrow(/Malformed grants file/);
  });

  it('更新版本写下的：打开失败，不改写', async () => {
    const text = JSON.stringify({ schemaVersion: 2, ledger: [] });
    await fs.writeFile(file, text);
    await expect(GrantStore.open(file)).rejects.toThrow(/newer version/);
    expect(await fs.readFile(file, 'utf8')).toBe(text);
  });

  it('空文件按没有处理', async () => {
    await fs.writeFile(file, '');
    const store = await GrantStore.open(file);
    expect(store.list({ includeEnded: true })).toEqual([]);
  });
});
