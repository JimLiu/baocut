import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyFile, entryIdOf, scanDirectory } from './space-catalog.ts';
import { parseRange } from './media.ts';

describe('Space 扫描', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-space-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function touch(rel: string, content = 'x') {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  it('按扩展名分类，认不出的不收', () => {
    expect(classifyFile('A.MP4')).toBe('video-file');
    expect(classifyFile('cover.jpeg')).toBe('image');
    expect(classifyFile('voice.m4a')).toBe('audio');
    expect(classifyFile('zh.srt')).toBe('subtitle');
    expect(classifyFile('script.md')).toBe('document');
    expect(classifyFile('main.ts')).toBeNull();
    expect(classifyFile('Makefile')).toBeNull();
  });

  it('跳过隐藏目录与依赖目录，不跟随符号链接', async () => {
    await touch('a.mp4');
    await touch('sub/b.png');
    await touch('.git/c.png');
    await touch('.baocut/d.png');
    // 项目标记目录：既不是条目，也不往里走。
    await touch('.bcut/project.json', '{}');
    await touch('.bcut/f.png');
    await touch('node_modules/e.png');
    await touch('.hidden.mp4');
    await fs.symlink(path.join(root, 'sub'), path.join(root, 'linked'));
    const result = await scanDirectory(root);
    expect(result.issue).toBeNull();
    expect(result.files.map((f) => f.relPath).sort()).toEqual(['a.mp4', 'sub/b.png']);
  });

  it('深度与数量有上限，超出时如实报告', async () => {
    await touch('1/2/3/deep.mp4');
    await touch('1/shallow.mp4');
    const shallow = await scanDirectory(root, { maxDepth: 1, maxFiles: 100, maxVisited: 100 });
    expect(shallow.files.map((f) => f.relPath)).toEqual(['1/shallow.mp4']);

    for (let i = 0; i < 5; i++) await touch(`many/${i}.png`);
    const capped = await scanDirectory(root, { maxDepth: 6, maxFiles: 3, maxVisited: 100 });
    expect(capped.files).toHaveLength(3);
    expect(capped.issue?.kind).toBe('truncated');
  });

  it('含 video.db 的目录是一个视频条目；改名之前只有 movie.db 的目录也算，等引擎打开时升级', async () => {
    await touch('新/video.db', 'db');
    await touch('新/blobs/x.mp4');
    await touch('旧/movie.db', 'db');
    await touch('旧/movie.db-wal', 'wal');
    const result = await scanDirectory(root);
    expect(result.files.map((f) => [f.kind, f.relPath, f.size])).toEqual([
      ['video', '新', 3],
      ['video', '旧', 5],
    ]);
  });

  it('目录不存在算空，不算问题', async () => {
    expect(await scanDirectory(path.join(root, 'missing'))).toEqual({ files: [], issue: null });
  });

  it('条目 id 只由来源与相对路径决定', () => {
    expect(entryIdOf('project:p1', 'a.mp4')).toBe(entryIdOf('project:p1', 'a.mp4'));
    expect(entryIdOf('project:p1', 'a.mp4')).not.toBe(entryIdOf('project:p2', 'a.mp4'));
  });
});

describe('Range 解析', () => {
  it('单段范围', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=0-', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseRange('bytes=8-100', 10)).toEqual({ start: 8, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=-30', 10)).toEqual({ start: 0, end: 9 });
  });

  it('越界与看不懂的范围', () => {
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-2', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseRange('items=0-1', 10)).toBeNull();
  });
});
