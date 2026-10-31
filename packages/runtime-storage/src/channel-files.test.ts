import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChannelFiles, MAKE_RUNS_KEPT } from './channel-files.ts';

let root: string;
let files: ChannelFiles;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-channel-files-'));
  files = new ChannelFiles(path.join(root, 'channels'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('ChannelFiles', () => {
  it('ensure 建出 files/；工作笔记路径与目录', async () => {
    const { dir, filesDir } = await files.ensure('chan_1');
    expect(dir).toBe(path.join(root, 'channels', 'chan_1'));
    expect(filesDir).toBe(path.join(dir, 'files'));
    expect((await fs.stat(filesDir)).isDirectory()).toBe(true);
    const notes = await files.ensureNotes('chan_1', 'conv_t');
    expect(notes).toBe(path.join(filesDir, '.threads', 'conv_t', 'working-notes.md'));
    expect(files.notesPath('chan_1', 'conv_t')).toBe(notes);
    expect((await fs.stat(path.dirname(notes))).isDirectory()).toBe(true);
  });

  it('频道记忆与用户级记忆：没有时为空串，写入后读回', async () => {
    expect(await files.readMemory('chan_1')).toBe('');
    expect(await files.readUserMemory()).toBe('');
    await files.writeMemory('chan_1', '# Memory\n- one\n');
    await files.writeMemory('chan_1', '# Memory\n- two\n');
    await files.writeUserMemory('- global\n');
    expect(await files.readMemory('chan_1')).toBe('# Memory\n- two\n');
    expect(await files.readUserMemory()).toBe('- global\n');
    expect(await fs.readFile(path.join(root, 'channels', 'USER.md'), 'utf8')).toBe('- global\n');
    const names = await fs.readdir(path.join(root, 'channels', 'chan_1'));
    expect(names).toEqual(['MEMORY.md']);
  });

  it('转述索引：追加并读回，坏行跳过', async () => {
    await files.appendRelayIndex('chan_1', { citedMessageId: 'm1', workItemId: 'w1', deliveryId: 'd1' });
    await fs.appendFile(path.join(root, 'channels', 'chan_1', 'relays.jsonl'), '{"broken\n');
    await files.appendRelayIndex('chan_1', { citedMessageId: 'm2', workItemId: 'w2', deliveryId: 'd2' });
    expect(await files.readRelayIndex('chan_1')).toEqual([
      { citedMessageId: 'm1', workItemId: 'w1', deliveryId: 'd1' },
      { citedMessageId: 'm2', workItemId: 'w2', deliveryId: 'd2' },
    ]);
    expect(await files.readRelayIndex('chan_2')).toEqual([]);
  });

  it('Make 的运行记录只留最近 50 条', async () => {
    await Promise.all(Array.from({ length: 60 }, (_, i) => files.appendMakeRun('chan_1', { n: i })));
    const runs = await files.readMakeRuns('chan_1');
    expect(runs).toHaveLength(MAKE_RUNS_KEPT);
    expect(runs[0]).toEqual({ n: 10 });
    expect(runs.at(-1)).toEqual({ n: 59 });
  });

  it('remove 删掉整个频道目录', async () => {
    await files.ensure('chan_1');
    await files.writeMemory('chan_1', 'x');
    await files.remove('chan_1');
    await expect(fs.stat(path.join(root, 'channels', 'chan_1'))).rejects.toThrow();
  });

  it('flush 等排着的写入都落盘', async () => {
    const writes = [files.writeQueued('ch1', 'wi1', { brief: 'a' }), files.writeHeld('ch1', 'wi2', { text: 'b' }), files.appendRelayIndex('ch1', { citedMessageId: 'm1', workItemId: 'wi1', deliveryId: 'd1' })];
    await files.flush();
    expect(await files.readQueued('ch1', 'wi1')).toEqual({ brief: 'a' });
    expect(await files.readHeld('ch1', 'wi2')).toEqual({ text: 'b' });
    expect(await files.readRelayIndex('ch1')).toHaveLength(1);
    await Promise.all(writes);
  });

  it('不安全的 id 被拒绝', async () => {
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', '../x', 'x..y']) {
      expect(() => files.dir(bad)).toThrow();
      await expect(files.readMemory(bad)).rejects.toThrow();
    }
    expect(() => files.notesPath('chan_1', '../escape')).toThrow();
    await expect(files.ensureNotes('chan_1', '')).rejects.toThrow();
  });
});
