import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError } from '@baocut/protocol';
import {
  ConversationStore,
  ProjectStore,
  projectMarkerPath,
  readProjectMarker,
  resolveRuntimeHome,
  type RuntimeHome,
} from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import { Harness } from './harness.ts';
import { silentLogger } from './logger.ts';

/** 项目标记 `.bcut/project.json` 与 `openProject` 的判定顺序（架构设计 §5.1）。全部在临时目录里。 */

let dir: string;
let home: RuntimeHome;
let harness: Harness;

async function open(): Promise<Harness> {
  return Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers: new DriverRegistry(),
    log: silentLogger,
  });
}

async function markerId(project: string): Promise<string | null> {
  const read = await readProjectMarker(project);
  return read.kind === 'ok' ? read.marker.projectId : null;
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

async function mkdir(name: string): Promise<string> {
  const target = path.join(dir, name);
  await fs.mkdir(target, { recursive: true });
  return fs.realpath(target);
}

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-harness-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  harness = await open();
});

afterEach(async () => {
  await harness.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('项目标记', () => {
  it('新目录打开时写入标记，再次打开是同一个项目；新建项目也有标记', async () => {
    const work = await mkdir('作品');
    const first = await harness.openProject(work);
    const marker = JSON.parse(await fs.readFile(projectMarkerPath(work), 'utf8'));
    expect(marker).toEqual({ format: 'baocut.project', schemaVersion: 1, projectId: first.id, createdAt: first.createdAt });
    const again = await harness.openProject(path.join(work, '.'));
    expect(again.id).toBe(first.id);
    expect(harness.listProjects()).toHaveLength(1);

    const created = await harness.createProject({ name: '新片' });
    expect(await markerId(created.path)).toBe(created.id);
  });

  it('移动之后按标记认出：id 不变，路径与跟着目录的名字更新，会话仍在且工作目录跟着换', async () => {
    const a = await mkdir('旧名');
    const project = await harness.openProject(a);
    const conversation = await harness.createConversation({ projectId: project.id });
    const b = path.join(dir, '新名');
    await fs.rename(a, b);

    const moved = await harness.openProject(b);
    expect(moved).toMatchObject({ id: project.id, path: b, name: '新名', createdAt: project.createdAt });
    expect(harness.listProjects()).toHaveLength(1);
    const after = harness.getConversation(conversation.id).conversation;
    expect(after).toMatchObject({ projectId: project.id, cwd: b });

    // 用户改过的名字保留。
    await harness.updateProject({ projectId: project.id, name: '我的片子' });
    const c = path.join(dir, '再换一次');
    await fs.rename(b, c);
    expect(await harness.openProject(c)).toMatchObject({ id: project.id, path: c, name: '我的片子' });
  });

  it('复制出来的目录是新项目：副本换新标识，原项目与它的会话不受影响', async () => {
    const original = await mkdir('原片');
    const project = await harness.openProject(original);
    const conversation = await harness.createConversation({ projectId: project.id });
    const copy = path.join(dir, '原片 副本');
    await fs.cp(original, copy, { recursive: true });
    expect(await markerId(copy)).toBe(project.id);

    const opened = await harness.openProject(copy);
    expect(opened.id).not.toBe(project.id);
    expect(opened).toMatchObject({ path: copy, name: '原片 副本' });
    expect(await markerId(copy)).toBe(opened.id);
    expect(await markerId(original)).toBe(project.id);
    expect(harness.listProjects().find((p) => p.id === project.id)?.path).toBe(original);
    expect(harness.getConversation(conversation.id).conversation).toMatchObject({ projectId: project.id, cwd: original });

    // 两边再打开都各自稳定。
    expect((await harness.openProject(original)).id).toBe(project.id);
    expect((await harness.openProject(copy)).id).toBe(opened.id);
  });

  it('删掉标记：登记里有这个路径时沿用原来的 id（升级路径），没有时是新项目', async () => {
    const work = await mkdir('作品');
    const project = await harness.openProject(work);
    await fs.rm(path.join(work, '.bcut'), { recursive: true });
    expect((await harness.openProject(work)).id).toBe(project.id);
    expect(await markerId(work)).toBe(project.id);

    // 换个没登记过的位置，再删标记：新项目。
    const elsewhere = path.join(dir, '别处');
    await fs.rename(work, elsewhere);
    await fs.rm(path.join(elsewhere, '.bcut'), { recursive: true });
    const fresh = await harness.openProject(elsewhere);
    expect(fresh.id).not.toBe(project.id);
  });

  it('认不出的标记改名保留后当作没有；版本太新的拒绝打开且不改写', async () => {
    const broken = await mkdir('坏标记');
    await fs.mkdir(path.join(broken, '.bcut'));
    await fs.writeFile(projectMarkerPath(broken), '{ 不是 JSON');
    const project = await harness.openProject(broken);
    const kept = (await fs.readdir(path.join(broken, '.bcut'))).filter((name) => name.startsWith('project.json.corrupt-'));
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(broken, '.bcut', kept[0]!), 'utf8')).toBe('{ 不是 JSON');
    expect(await markerId(broken)).toBe(project.id);

    const foreign = await mkdir('别的格式');
    await fs.mkdir(path.join(foreign, '.bcut'));
    await fs.writeFile(projectMarkerPath(foreign), JSON.stringify({ format: 'other', schemaVersion: 1, projectId: 'proj_x' }));
    const other = await harness.openProject(foreign);
    expect(other.id).not.toBe('proj_x');
    expect((await fs.readdir(path.join(foreign, '.bcut'))).some((name) => name.startsWith('project.json.corrupt-'))).toBe(true);

    const future = await mkdir('未来');
    await fs.mkdir(path.join(future, '.bcut'));
    const text = JSON.stringify({
      format: 'baocut.project',
      schemaVersion: 2,
      projectId: 'proj_future',
      createdAt: '2030-01-01T00:00:00Z',
    });
    await fs.writeFile(projectMarkerPath(future), text);
    const error = await rejection(harness.openProject(future));
    expect(error.code).toBe('conflict');
    expect(error.details).toMatchObject({ code: 'PROJECT_MARKER_UNSUPPORTED', schemaVersion: 2 });
    expect(await fs.readFile(projectMarkerPath(future), 'utf8')).toBe(text);
    expect(harness.listProjects().some((p) => p.path === future)).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('目录不可写：明确报错，不登记没有标记的项目', async () => {
    const locked = await mkdir('只读');
    await fs.chmod(locked, 0o555);
    try {
      const error = await rejection(harness.openProject(locked));
      expect(error.code).toBe('forbidden');
      expect(error.details).toMatchObject({ code: 'PROJECT_DIR_READ_ONLY' });
      expect(harness.listProjects()).toHaveLength(0);
    } finally {
      await fs.chmod(locked, 0o755);
    }
  });

  it('登记丢了：按标记重建 id；启动时加载登记不写标记', async () => {
    const work = await mkdir('作品');
    const project = await harness.openProject(work);
    await harness.shutdown();
    await fs.rm(home.projectsFile);
    harness = await open();
    expect(harness.listProjects()).toHaveLength(0);
    const rebuilt = await harness.openProject(work);
    expect(rebuilt).toMatchObject({ id: project.id, createdAt: project.createdAt, path: work });

    // 升级前的登记（目录里没有标记）：加载时不写，打开时沿用登记的 id 并写入。
    const legacy = await mkdir('旧项目');
    await harness.shutdown();
    const now = new Date().toISOString();
    const entry = { id: 'proj_legacy', name: '旧项目', path: legacy, createdAt: now, lastActiveAt: now, pinned: false, archived: false };
    await fs.writeFile(home.projectsFile, JSON.stringify({ schemaVersion: 1, projects: [entry] }));
    harness = await open();
    expect(harness.listProjects().map((p) => p.id)).toEqual(['proj_legacy']);
    expect(await markerId(legacy)).toBeNull();
    expect((await harness.openProject(legacy)).id).toBe('proj_legacy');
    expect(await markerId(legacy)).toBe('proj_legacy');
  });
});
