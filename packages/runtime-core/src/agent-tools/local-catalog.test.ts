import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { MCP_INTERFACE_VERSION, RpcError, type CatalogCallResult, type ClientKind, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { LOCAL_DEFAULT_PROJECT_DIR } from './local-scope.ts';

/**
 * 端到端：CLI 连接经网关的 `catalog.list` / `catalog.call` 用 Agent 面的工具目录（架构设计 §3.5、§4.1），主体是 `LocalPrincipal`：
 * 相对路径按 cwd 解析、写入算 `user_local`、不走审批。需要 engine-host 与 ffmpeg，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!engine || !ffmpeg)('工具目录经网关给 CLI（真实引擎）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    clip = path.join(fixtures, 'clip.mp4');
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', clip],
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-test-')));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
    });
    client = await connect('cli');
    ({ project } = await client.request('projects.create', { name: '终端测试' }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function connect(kind: ClientKind): Promise<BaoCutClient> {
    const { endpoint, token } = runtime.discovery;
    const connected = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind, name: 'test', version: '0' },
      reconnect: false,
    });
    await connected.connect();
    return connected;
  }

  async function call(name: string, args: unknown, cwd: string, extra: { project?: string | null } = {}): Promise<CatalogCallResult> {
    return client.request('catalog.call', { name, args, cwd, ...extra });
  }

  /** 成功的结果对象；失败时把错误带进断言信息。 */
  async function ok(name: string, args: unknown, cwd: string): Promise<Record<string, unknown>> {
    const outcome = await call(name, args, cwd);
    if (!outcome.ok) throw new Error(`${name} 失败：${JSON.stringify(outcome.error)}`);
    return outcome.result as Record<string, unknown>;
  }

  it('catalog.list：接口版本与带 JSON Schema、风险的工具', async () => {
    const listed = await client.request('catalog.list', {});
    expect(listed.interfaceVersion).toBe(MCP_INTERFACE_VERSION);
    expect(listed.tools.length).toBeGreaterThan(0);
    for (const tool of listed.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.risk).toBe('string');
    }
    const names = listed.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['videos_create', 'videos_list', 'videos_inspect', 'edits_apply', 'export', 'videos_delete']));
    // 只给会话里的智能体的工具（surfaces 没有 cli）不在终端的目录里。
    expect(names).not.toEqual(expect.arrayContaining(['tasks_contract']));
    expect(names).not.toEqual(expect.arrayContaining(['grants_request']));
    expect(names).not.toEqual(expect.arrayContaining(['downloads_save']));
    expect(listed.tools.find((t) => t.name === 'videos_create')?.risk).toBe('edit');
  });

  it('videos_create 建在 cwd 所在的项目里；videoId、绝对与相对的视频目录指同一个视频', async () => {
    const created = await ok('videos_create', { name: '终端样片' }, project.path);
    const videoId = created.videoId as string;
    expect(videoId).toMatch(/^video_/);
    expect(created.note).toBeUndefined();
    const relPath = created.video as string;
    const videoDir = path.join(project.path, relPath);
    expect((await fs.stat(path.join(videoDir, 'video.db'))).isFile()).toBe(true);

    const listed = await ok('videos_list', {}, project.path);
    expect(listed.project).toBe(project.path);
    expect(listed.videos).toEqual(expect.arrayContaining([expect.objectContaining({ videoId, path: relPath, dir: videoDir })]));

    const byId = await ok('videos_inspect', { video: videoId }, project.path);
    const byAbsolute = await ok('videos_inspect', { video: videoDir }, os.tmpdir());
    const byRelative = await ok('videos_inspect', { video: relPath }, project.path);
    for (const inspected of [byId, byAbsolute, byRelative]) {
      expect(inspected.videoId).toBe(videoId);
      expect(inspected.name).toBe('终端样片');
    }

    // 视频关掉之后（CLI 断开），videoId 仍能在当前项目里找到并重新打开。
    client.close();
    await until(async () => !runtime.videos.ref(videoId));
    client = await connect('cli');
    expect((await ok('videos_inspect', { video: videoId }, project.path)).videoId).toBe(videoId);
  });

  it('不在项目里时新建到默认项目目录的 CLI 项目，并在结果里说明', async () => {
    const elsewhere = await fs.mkdtemp(path.join(dir, 'elsewhere-'));
    const created = await ok('videos_create', { name: '无项目' }, elsewhere);
    expect(created.note).toEqual(expect.stringContaining(LOCAL_DEFAULT_PROJECT_DIR));
    const defaultProject = path.join(runtime.info.projectsDir, LOCAL_DEFAULT_PROJECT_DIR);
    expect((await fs.stat(path.join(defaultProject, created.video as string, 'video.db'))).isFile()).toBe(true);
    const { projects } = await client.request('projects.list', {});
    expect(projects.some((p) => p.path === defaultProject)).toBe(true);
  });

  it('edits_apply 的 importAsset 相对路径按 cwd 解析；写入的操作者是 user_local', async () => {
    const media = path.join(project.path, 'media');
    await fs.mkdir(media);
    await fs.copyFile(clip, path.join(media, 'clip.mp4'));
    const created = await ok('videos_create', { name: '素材' }, project.path);
    const videoId = created.videoId as string;
    const revision = created.revision as string;
    const operations = [
      { type: 'importAsset', path: 'clip.mp4', name: '片段', ref: 'a' },
      { type: 'addItem', asset: { ref: 'a' } },
    ];

    // 项目目录里没有 clip.mp4：按 cwd 解析就找不到。
    const missing = await call('edits_apply', { video: videoId, expectedRevision: revision, label: '导入', operations }, project.path);
    expect(missing.ok).toBe(false);

    // cwd 在 media/（从这里向上找到项目）：同样的相对路径指 media/clip.mp4。
    const applied = await ok('edits_apply', { video: videoId, expectedRevision: revision, label: '导入', operations }, media);
    expect(applied.approval).toBeUndefined();
    const inspected = await ok('videos_inspect', { video: videoId }, media);
    expect(inspected.assets).toEqual([expect.objectContaining({ name: '片段', storage: 'linked' })]);

    const { entries } = await client.request('videos.history', { videoId, limit: 5 });
    expect(entries.find((e) => e.label === '导入')?.actor).toEqual({ kind: 'user', id: 'user_local' });
  });

  it('工具层的拒绝在返回值里：未知工具、参数不对、cwd 不存在', async () => {
    const unknown = await call('no_such_tool', {}, project.path);
    expect(unknown).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });

    const invalid = await call('videos_create', { width: 'wide' }, project.path);
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } });
    expect(!invalid.ok && Array.isArray(invalid.error.issues)).toBe(true);

    const notFound = await call('videos_inspect', { video: 'video_0123456789abcdef' }, project.path);
    expect(notFound).toMatchObject({ ok: false, error: { code: 'VIDEO_NOT_FOUND' } });

    const noCwd = await call('videos_list', {}, path.join(dir, 'missing'));
    expect(noCwd).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } });

    // cwd 不是绝对路径：协议层就拒绝。
    await expect(client.request('catalog.call', { name: 'videos_list', args: {}, cwd: 'relative' })).rejects.toBeInstanceOf(RpcError);
  });

  it('只给 cli 与 desktop 连接：agent 连接调用 catalog.* 被拒绝', async () => {
    const desktop = await connect('desktop');
    try {
      expect((await desktop.request('catalog.list', {})).tools.length).toBeGreaterThan(0);
    } finally {
      desktop.close();
    }
    const agent = await connect('agent');
    try {
      await expect(agent.request('catalog.list', {})).rejects.toMatchObject({ code: 'forbidden' });
      await expect(agent.request('catalog.call', { name: 'videos_list', args: {}, cwd: project.path })).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(agent.request('catalog.agentSkill', {})).rejects.toMatchObject({ code: 'forbidden' });
    } finally {
      agent.close();
    }
  });

  it('catalog.agentSkill：仓库里的说明书按 CLI 面渲染好', async () => {
    const skill = await client.request('catalog.agentSkill', {});
    expect(skill.id).toBe('baocut');
    expect(skill.interfaceVersion).toBe(MCP_INTERFACE_VERSION);
    expect(skill.sourceDir).toMatch(/agent-skills[/\\]baocut$/);
    const entry = skill.files.find((file) => file.path === 'SKILL.md');
    expect(entry?.content).toContain('`baocut videos inspect`');
    expect(entry?.content).not.toMatch(/\{\{|<!-- surface/);
    expect(skill.files.some((file) => file.path.startsWith('references/craft/') && file.path.endsWith('.md'))).toBe(true);
  });
});

async function until(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
