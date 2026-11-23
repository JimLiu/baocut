import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import type { AgentDriver, AgentSession } from '@baocut/harness';
import { RpcError, type DriverProbe } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { fakeProbe } from './agent-tools/testing/fake-agent.ts';
import { DEFAULT_PROJECT_FILES_LIMITS, listProjectFiles } from './project-files.ts';
import { startRuntime, type RunningRuntime } from './runtime.ts';

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('应该被拒绝');
}

async function write(file: string, content = 'x'): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

describe('项目文件浏览（projects.files.list）', () => {
  let dir: string;
  let root: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-files-'));
    root = path.join(dir, 'project');
    await write(path.join(root, 'notes.md'), 'hello');
    await write(path.join(root, 'clip 10.mp4'), '0123456789');
    await write(path.join(root, 'clip 9.mp4'));
    await write(path.join(root, 'assets', 'logo.png'));
    await write(path.join(root, 'assets', 'deep', 'clip-logo.svg'));
    await write(path.join(root, 'Intro.video', 'video.db'), 'db');
    await write(path.join(root, 'Intro.video', 'blobs', 'clip-inside.mp4'));
    await write(path.join(root, '.git', 'clip-config'));
    await write(path.join(root, '.baocut', 'state.json'));
    await write(path.join(root, 'node_modules', 'pkg', 'clip.js'));
    await write(path.join(root, 'data.bin'));
    await write(path.join(dir, 'outside', 'secret-clip.txt'), 'secret');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('列一层：目录在前，名字按数字排序，跳过隐藏与依赖目录，认出视频目录与文件类型', async () => {
    const result = await listProjectFiles(root, {});
    expect(result.root).toBe(root);
    expect(result.truncated).toBe(false);
    expect(result.entries.map((e) => e.path)).toEqual(['assets', 'Intro.video', 'clip 9.mp4', 'clip 10.mp4', 'data.bin', 'notes.md']);
    const byPath = Object.fromEntries(result.entries.map((e) => [e.path, e]));
    expect(byPath['assets']).toMatchObject({ name: 'assets', isDir: true, size: null, kind: null });
    expect(byPath['Intro.video']).toMatchObject({ isDir: true, size: null, kind: 'video' });
    expect(byPath['clip 10.mp4']).toMatchObject({ isDir: false, size: 10, kind: 'video-file' });
    expect(byPath['notes.md']).toMatchObject({ size: 5, kind: 'document' });
    expect(byPath['data.bin']?.kind).toBeNull();
    expect(byPath['notes.md']?.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('列子目录：路径相对根目录，用 / 分隔', async () => {
    const result = await listProjectFiles(root, { dir: 'assets' });
    expect(result.entries.map((e) => e.path)).toEqual(['assets/deep', 'assets/logo.png']);
    const deeper = await listProjectFiles(root, { dir: 'assets/deep/' });
    expect(deeper.entries.map((e) => e.path)).toEqual(['assets/deep/clip-logo.svg']);
    expect((await listProjectFiles(root, { dir: '.' })).entries).toHaveLength(6);
    expect((await listProjectFiles(root, { dir: 'assets/../assets' })).entries).toHaveLength(2);
  });

  it('目录越界、隐藏目录、绝对路径、不是目录：拒绝', async () => {
    expect((await rejection(listProjectFiles(root, { dir: '..' }))).code).toBe('invalid-request');
    expect((await rejection(listProjectFiles(root, { dir: '../outside' }))).code).toBe('invalid-request');
    expect((await rejection(listProjectFiles(root, { dir: path.join(dir, 'outside') }))).code).toBe('invalid-request');
    expect((await rejection(listProjectFiles(root, { dir: '.git' }))).code).toBe('invalid-request');
    expect((await rejection(listProjectFiles(root, { dir: 'node_modules/pkg' }))).code).toBe('invalid-request');
    expect((await rejection(listProjectFiles(root, { dir: 'notes.md' }))).code).toBe('invalid-request');
    expect((await rejection(listProjectFiles(root, { dir: 'missing' }))).code).toBe('not-found');
    expect((await rejection(listProjectFiles(path.join(dir, 'gone'), {}))).code).toBe('not-found');
  });

  it('符号链接：指出根目录的、悬空的不列；指向根目录里的照常列出；指出根目录的目录链接不能进入', async () => {
    await fs.symlink(path.join(dir, 'outside', 'secret-clip.txt'), path.join(root, 'leak.txt'));
    await fs.symlink(path.join(dir, 'outside'), path.join(root, 'leak-dir'));
    await fs.symlink(path.join(root, 'missing.txt'), path.join(root, 'dangling.txt'));
    await fs.symlink(path.join(root, 'notes.md'), path.join(root, 'alias.md'));
    await fs.symlink(path.join(root, 'assets'), path.join(root, 'assets-link'));

    const result = await listProjectFiles(root, {});
    const paths = result.entries.map((e) => e.path);
    expect(paths).not.toContain('leak.txt');
    expect(paths).not.toContain('leak-dir');
    expect(paths).not.toContain('dangling.txt');
    expect(result.entries.find((e) => e.path === 'alias.md')).toMatchObject({ isDir: false, size: 5, kind: 'document' });
    expect(result.entries.find((e) => e.path === 'assets-link')).toMatchObject({ isDir: true });

    // 根目录里的目录链接可以进入，路径仍按逻辑路径拼。
    const linked = await listProjectFiles(root, { dir: 'assets-link' });
    expect(linked.entries.map((e) => e.path)).toEqual(['assets-link/deep', 'assets-link/logo.png']);
    expect((await rejection(listProjectFiles(root, { dir: 'leak-dir' }))).code).toBe('invalid-request');

    // 查找也不列越界的链接，不进入目录链接（不会重复列出 assets-link 下的文件）。
    const found = await listProjectFiles(root, { query: 'clip' });
    expect(found.entries.map((e) => e.path)).not.toContain('leak-dir');
    expect(found.entries.some((e) => e.path.startsWith('assets-link/'))).toBe(false);
    expect((await listProjectFiles(root, { query: 'leak' })).entries).toEqual([]);
  });

  it('查找：在 dir 下递归按名字匹配，完全相同 > 开头相同 > 包含，再按深度；不进入视频目录与隐藏目录', async () => {
    const result = await listProjectFiles(root, { query: ' CLIP ' });
    expect(result.entries.map((e) => e.path)).toEqual(['clip 9.mp4', 'clip 10.mp4', 'assets/deep/clip-logo.svg']);
    expect(result.truncated).toBe(false);

    const logo = await listProjectFiles(root, { query: 'logo' });
    expect(logo.entries.map((e) => e.path)).toEqual(['assets/logo.png', 'assets/deep/clip-logo.svg']);

    const exact = await listProjectFiles(root, { query: 'logo.png' });
    expect(exact.entries[0]?.path).toBe('assets/logo.png');

    const scoped = await listProjectFiles(root, { dir: 'assets/deep', query: 'logo' });
    expect(scoped.entries.map((e) => e.path)).toEqual(['assets/deep/clip-logo.svg']);

    const video = await listProjectFiles(root, { query: 'intro' });
    expect(video.entries).toMatchObject([{ path: 'Intro.video', isDir: true, kind: 'video' }]);

    // 空白的 query 等于不给：列一层。
    expect((await listProjectFiles(root, { query: '   ' })).entries).toHaveLength(6);
  });

  it('截断：超过 limit、看过的目录项或候选超过上限时标出 truncated', async () => {
    const listed = await listProjectFiles(root, { limit: 2 });
    expect(listed.entries.map((e) => e.path)).toEqual(['assets', 'Intro.video']);
    expect(listed.truncated).toBe(true);

    const searched = await listProjectFiles(root, { query: 'clip', limit: 1 });
    expect(searched.entries.map((e) => e.path)).toEqual(['clip 9.mp4']);
    expect(searched.truncated).toBe(true);

    const visited = await listProjectFiles(root, { query: 'clip' }, { ...DEFAULT_PROJECT_FILES_LIMITS, maxVisited: 3 });
    expect(visited.truncated).toBe(true);

    const candidates = await listProjectFiles(root, { query: 'clip' }, { ...DEFAULT_PROJECT_FILES_LIMITS, maxCandidates: 1 });
    expect(candidates.entries).toHaveLength(1);
    expect(candidates.truncated).toBe(true);

    const shallow = await listProjectFiles(root, { query: 'clip-logo' }, { ...DEFAULT_PROJECT_FILES_LIMITS, maxDepth: 1 });
    expect(shallow.entries).toEqual([]);
  });
});

class IdleDriver implements AgentDriver {
  readonly id = 'codex' as const;

  async probe(): Promise<DriverProbe> {
    return fakeProbe();
  }

  async createSession(): Promise<AgentSession> {
    throw new Error('这个测试不开会话');
  }
}

describe('项目文件浏览经网关（端到端）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-files-e2e-'));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [new IdleDriver()],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({ resolve: async () => ({ endpoint, token }), client: { kind: 'cli', name: 'test', version: '0' }, reconnect: false });
    await client.connect();
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('项目会话列项目目录，无项目会话列工作目录；参数严格校验；列出的路径能交给 media.resolve', async () => {
    const projectDir = path.join(dir, 'proj');
    await write(path.join(projectDir, 'scenes', 'a.mp4'), 'aaaa');
    await write(path.join(projectDir, 'readme.md'));
    const { project } = await client.request('projects.open', { path: projectDir });
    const { conversation } = await client.request('conversations.create', { projectId: project.id });

    const top = await client.request('projects.files.list', { conversationId: conversation.id });
    expect(top.root).toBe(project.path);
    expect(top.entries.map((e) => e.path)).toEqual(['scenes', 'readme.md']);
    const found = await client.request('projects.files.list', { conversationId: conversation.id, query: 'a.mp4' });
    expect(found.entries).toMatchObject([{ path: 'scenes/a.mp4', size: 4, kind: 'video-file' }]);

    const handle = await client.request('media.resolve', { conversationId: conversation.id, path: found.entries[0]!.path });
    expect(await (await fetch(handle.url)).text()).toBe('aaaa');

    const loose = await client.request('conversations.create', {});
    await write(path.join(loose.conversation.cwd, 'draft.txt'));
    const scratch = await client.request('projects.files.list', { conversationId: loose.conversation.id });
    expect(scratch.root).toBe(loose.conversation.cwd);
    expect(scratch.entries.map((e) => e.path)).toEqual(['draft.txt']);

    expect((await rejection(client.request('projects.files.list', { conversationId: conversation.id, dir: '../' }))).code).toBe('invalid-request');
    expect((await rejection(client.request('projects.files.list', { conversationId: conversation.id, limit: 0 }))).code).toBe('invalid-request');
    const extra = { conversationId: conversation.id, recursive: true } as never;
    expect((await rejection(client.request('projects.files.list', extra))).code).toBe('invalid-request');
    expect((await rejection(client.request('projects.files.list', { conversationId: 'conv_missing' }))).code).toBe('not-found');
  });
});
