import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import type { AgentDriver, AgentSession } from '@baocut/harness';
import { RpcError, type DriverProbe } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { fakeProbe } from './agent-tools/testing/fake-agent.ts';
import { createProjectFile, numberedName } from './project-file-create.ts';
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

const PAGE = '<!doctype html>\n<title>短片</title>\n';

describe('新建项目文件（projects.files.create）', () => {
  let dir: string;
  let root: string;
  const scope = { projectId: 'proj_a' };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-create-'));
    root = path.join(dir, 'project');
    await write(path.join(root, 'notes.md'));
    await write(path.join(root, 'pages', 'keep.txt'));
    await write(path.join(root, 'Intro.video', 'video.db'), 'db');
    await write(path.join(root, 'Intro.video', 'blobs', 'x.bin'));
    await write(path.join(root, '.bcut', 'project.json'));
    await write(path.join(root, 'node_modules', 'pkg', 'index.js'));
    await write(path.join(dir, 'outside', 'secret.txt'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('在根目录写入 UTF-8 文本，返回按项目定位的路径与条目', async () => {
    const result = await createProjectFile(root, scope, { name: '新网页.html', content: PAGE });
    expect(result.target).toEqual({ projectId: 'proj_a', path: '新网页.html' });
    expect(result.entry).toMatchObject({ path: '新网页.html', name: '新网页.html', isDir: false, kind: 'document' });
    expect(result.entry.size).toBe(Buffer.byteLength(PAGE));
    expect(result.entry.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await fs.readFile(path.join(root, '新网页.html'), 'utf8')).toBe(PAGE);
  });

  it('子目录：路径相对根目录，用 / 分隔；名字只取最后一段', async () => {
    const result = await createProjectFile(root, scope, { name: '../../escape/page.html', content: 'a', dir: 'pages/' });
    expect(result.target).toEqual({ projectId: 'proj_a', path: 'pages/page.html' });
    expect(await fs.readFile(path.join(root, 'pages', 'page.html'), 'utf8')).toBe('a');
    await expect(fs.stat(path.join(dir, 'escape'))).rejects.toThrow();
  });

  it('重名不覆盖：依次试「名字 2.扩展名」「名字 3.扩展名」', async () => {
    const first = await createProjectFile(root, scope, { name: 'page.html', content: '1' });
    const second = await createProjectFile(root, scope, { name: 'page.html', content: '2' });
    const third = await createProjectFile(root, scope, { name: 'page.html', content: '3' });
    expect([first, second, third].map((r) => r.entry.name)).toEqual(['page.html', 'page 2.html', 'page 3.html']);
    expect(await fs.readFile(path.join(root, 'page.html'), 'utf8')).toBe('1');
    expect(await fs.readFile(path.join(root, 'page 3.html'), 'utf8')).toBe('3');
    // 和已有目录重名也跳过。
    const dirClash = await createProjectFile(root, scope, { name: 'pages', content: 'x' });
    expect(dirClash.entry.name).toBe('pages 2');
    expect(numberedName('archive.tar.gz', 2)).toBe('archive.tar 2.gz');
    expect(numberedName('README', 3)).toBe('README 3');
  });

  it('dir 越界、绝对路径、不存在、不是目录、隐藏 / 依赖 / 视频目录：拒绝', async () => {
    const reject = async (dirParam: string) =>
      (await rejection(createProjectFile(root, scope, { name: 'a.html', content: '', dir: dirParam }))).code;
    expect(await reject('..')).toBe('invalid-request');
    expect(await reject('../outside')).toBe('invalid-request');
    expect(await reject(path.join(dir, 'outside'))).toBe('invalid-request');
    expect(await reject('.bcut')).toBe('invalid-request');
    expect(await reject('node_modules/pkg')).toBe('invalid-request');
    expect(await reject('Intro.video')).toBe('invalid-request');
    expect(await reject('Intro.video/blobs')).toBe('invalid-request');
    expect(await reject('missing')).toBe('not-found');
    expect(await reject('notes.md')).toBe('invalid-request');
    await expect(fs.stat(path.join(root, 'Intro.video', 'blobs', 'a.html'))).rejects.toThrow();
  });

  it('符号链接：指出根目录的目录不能写入，指向根目录里的照常写入', async () => {
    await fs.symlink(path.join(dir, 'outside'), path.join(root, 'out-link'));
    await fs.symlink(path.join(root, 'pages'), path.join(root, 'pages-link'));
    expect((await rejection(createProjectFile(root, scope, { name: 'a.html', content: '', dir: 'out-link' }))).code).toBe(
      'invalid-request',
    );
    const inside = await createProjectFile(root, scope, { name: 'b.html', content: 'b', dir: 'pages-link' });
    expect(inside.target).toEqual({ projectId: 'proj_a', path: 'pages-link/b.html' });
    expect(await fs.readFile(path.join(root, 'pages', 'b.html'), 'utf8')).toBe('b');
  });

  it('空名、.、..、以点开头的名字、依赖目录名、控制字符：拒绝', async () => {
    for (const name of ['', '   ', '.', '..', 'sub/..', '.env', '.bcut', 'node_modules', 'a\u0000b.html', 'a\nb.html']) {
      expect((await rejection(createProjectFile(root, scope, { name, content: '' }))).code).toBe('invalid-request');
    }
    await expect(fs.stat(path.join(root, '.env'))).rejects.toThrow();
  });

  it('根目录不存在：not-found', async () => {
    expect((await rejection(createProjectFile(path.join(dir, 'gone'), scope, { name: 'a.html', content: '' }))).code).toBe('not-found');
  });
});

describe('新建项目文件经网关（端到端）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-create-e2e-'));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [new IdleDriver()],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'cli', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('项目会话与 projectId 落在项目目录、按项目定位；无项目会话落在工作目录、按会话定位；参数严格校验', async () => {
    const projectDir = path.join(dir, 'proj');
    await fs.mkdir(projectDir, { recursive: true });
    const { project } = await client.request('projects.open', { path: projectDir });
    const { conversation } = await client.request('conversations.create', { projectId: project.id });

    const viaConversation = await client.request('projects.files.create', {
      conversationId: conversation.id,
      name: 'page.html',
      content: PAGE,
    });
    expect(viaConversation.target).toEqual({ projectId: project.id, path: 'page.html' });
    const viaProject = await client.request('projects.files.create', { projectId: project.id, name: 'page.html', content: PAGE });
    expect(viaProject.target).toEqual({ projectId: project.id, path: 'page 2.html' });
    expect(await fs.readFile(path.join(project.path, 'page 2.html'), 'utf8')).toBe(PAGE);
    const listed = await client.request('projects.files.list', { conversationId: conversation.id });
    expect(listed.entries.map((e) => e.path)).toEqual(['page 2.html', 'page.html']);

    const handle = await client.request('media.resolve', viaProject.target);
    expect(await (await fetch(handle.url)).text()).toBe(PAGE);

    const loose = await client.request('conversations.create', {});
    const scratch = await client.request('projects.files.create', {
      conversationId: loose.conversation.id,
      name: 'draft.html',
      content: 'x',
    });
    expect(scratch.target).toEqual({ conversationId: loose.conversation.id, path: 'draft.html' });
    expect(await fs.readFile(path.join(loose.conversation.cwd, 'draft.html'), 'utf8')).toBe('x');

    const both = { conversationId: conversation.id, projectId: project.id, name: 'a.html', content: '' } as never;
    expect((await rejection(client.request('projects.files.create', both))).code).toBe('invalid-request');
    const neither = { name: 'a.html', content: '' } as never;
    expect((await rejection(client.request('projects.files.create', neither))).code).toBe('invalid-request');
    expect((await rejection(client.request('projects.files.create', { projectId: project.id, name: '', content: '' }))).code).toBe(
      'invalid-request',
    );
    expect(
      (await rejection(client.request('projects.files.create', { projectId: 'proj_missing', name: 'a.html', content: '' }))).code,
    ).toBe('not-found');
    expect(
      (await rejection(client.request('projects.files.create', { conversationId: 'conv_missing', name: 'a.html', content: '' }))).code,
    ).toBe('not-found');
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
