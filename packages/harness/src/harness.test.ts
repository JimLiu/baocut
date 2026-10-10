import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcError } from '@baocut/protocol';
import { HarnessProjects as HP } from '@baocut/protocol/messages/harness';
import {
  ConversationStore,
  ProjectStore,
  projectMarkerPath,
  readProjectMarker,
  resolveRuntimeHome,
  type RuntimeHome,
} from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import { Harness, withEditorContext } from './harness.ts';
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

/** 无项目会话的视频留在工作目录里；用户要建项目或删会话时才建项目并绑定（架构设计 §3.10），以及启动时的迁移。 */
describe('无项目会话绑定项目', () => {
  /** 一个假的视频目录：只要有 `video.db` 就算视频（视频格式规范 §1）。 */
  async function fakeVideo(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'video.db'), 'db');
  }

  const exists = (p: string) =>
    fs.lstat(p).then(
      () => true,
      () => false,
    );

  it('第一次绑定建项目（没有视频时名字取标题）、换工作目录、东西搬过去；重复与并发的调用拿回同一个项目', async () => {
    const conversation = await harness.createConversation({ title: '我的片子' });
    expect(conversation.projectId).toBeNull();
    expect(conversation.cwd).toBe(path.join(home.scratchDir, conversation.id));
    await fs.writeFile(path.join(conversation.cwd, 'notes.txt'), '笔记');

    const [a, b] = await Promise.all([harness.ensureConversationProject(conversation.id), harness.ensureConversationProject(conversation.id)]);
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ name: '我的片子', path: path.join(home.projectsDir, '我的片子') });
    expect(await markerId(a.path)).toBe(a.id);
    expect(harness.getConversation(conversation.id).conversation).toMatchObject({ projectId: a.id, cwd: a.path });
    expect(await fs.readFile(path.join(a.path, 'notes.txt'), 'utf8')).toBe('笔记');
    // 没有回合在用旧工作目录：删掉。
    expect(await exists(conversation.cwd)).toBe(false);

    expect((await harness.ensureConversationProject(conversation.id)).id).toBe(a.id);
    expect(harness.listProjects()).toHaveLength(1);

    // 绑定落盘：重启后还在。
    await harness.shutdown();
    harness = await open();
    expect(harness.getConversation(conversation.id).conversation).toMatchObject({ projectId: a.id, cwd: a.path });
    expect((await harness.ensureConversationProject(conversation.id)).id).toBe(a.id);
    expect(harness.listProjects()).toHaveLength(1);

    // 没有标题用默认名。
    const untitled = await harness.createConversation({});
    expect((await harness.ensureConversationProject(untitled.id)).name).toBe(HP.untitledProject().text);
  });

  it('项目名取工作目录里最早建的视频；给了名字时用给的', async () => {
    const conversation = await harness.createConversation({ title: '帮我加字幕' });
    await fakeVideo(path.join(conversation.cwd, '访谈'));
    await new Promise((r) => setTimeout(r, 20));
    await fakeVideo(path.join(conversation.cwd, 'downloads', '花絮'));
    const project = await harness.ensureConversationProject(conversation.id);
    expect(project).toMatchObject({ name: '访谈', path: path.join(home.projectsDir, '访谈') });
    expect(await exists(path.join(project.path, '访谈', 'video.db'))).toBe(true);
    expect(await exists(path.join(project.path, 'downloads', '花絮', 'video.db'))).toBe(true);

    const named = await harness.createConversation({ title: '另一个' });
    await fakeVideo(path.join(named.cwd, '素材'));
    expect((await harness.ensureConversationProject(named.id, { name: '第 12 期' })).name).toBe('第 12 期');
  });

  it('崩溃恢复：项目目录选定之后、会话绑定之前退出，下次接着用同一个目录，不产生第二个项目', async () => {
    const conversation = await harness.createConversation({ title: '半途' });
    // 模拟上次绑定到一半：选定的目录记下了、建好并登记了，会话还没有绑定。
    const chosen = path.join(home.projectsDir, '半途');
    await fs.writeFile(path.join(conversation.cwd, '.baocut-binding.json'), JSON.stringify({ path: chosen }));
    const half = await harness.createProject({ name: '半途' });
    expect(half.path).toBe(chosen);

    const project = await harness.ensureConversationProject(conversation.id);
    expect(project.id).toBe(half.id);
    expect(harness.listProjects()).toHaveLength(1);
    expect(await exists(path.join(project.path, '.baocut-binding.json'))).toBe(false);
    expect(await exists(conversation.cwd)).toBe(false);
  });

  it('启动迁移：无项目会话的工作目录与其中的视频不动；没有会话的收进「恢复的视频」（按界面语言命名，再次启动沿用），没有视频的删掉', async () => {
    const live = await harness.createConversation({ title: '旧会话' });
    await fakeVideo(path.join(live.cwd, '旧视频'));
    await fs.writeFile(path.join(live.cwd, 'exports.txt'), 'x');
    const plain = await harness.createConversation({ title: '只聊天' });
    await fs.writeFile(path.join(plain.cwd, 'draft.txt'), 'x');
    const orphan = path.join(home.scratchDir, 'conv_gone');
    await fakeVideo(path.join(orphan, '孤儿视频'));
    await fs.writeFile(path.join(orphan, '.hidden'), 'x');
    const empty = path.join(home.scratchDir, 'conv_empty');
    await fs.mkdir(empty, { recursive: true });
    await fs.writeFile(path.join(empty, 'scrap.txt'), 'x');

    const result = await harness.migrateScratch();
    expect(result).toEqual({ moved: 0, folded: 0, recovered: 1, removed: 1 });

    // 有视频的无项目会话不建项目：视频留在它的工作目录里。
    expect(harness.getConversation(live.id).conversation).toMatchObject({ projectId: null, cwd: live.cwd });
    expect(await exists(path.join(live.cwd, '旧视频', 'video.db'))).toBe(true);
    expect(await exists(path.join(live.cwd, 'exports.txt'))).toBe(true);
    expect(harness.getConversation(plain.id).conversation).toMatchObject({ projectId: null, cwd: plain.cwd });
    expect(await exists(path.join(plain.cwd, 'draft.txt'))).toBe(true);

    const recovered = harness.listProjects().find((p) => p.name === HP.recoveredVideos().text)!;
    expect(recovered).toBeTruthy();
    expect(await exists(path.join(recovered.path, '孤儿视频', 'video.db'))).toBe(true);
    expect(await exists(path.join(recovered.path, '.hidden'))).toBe(false);
    expect(await exists(orphan)).toBe(false);
    expect(await exists(empty)).toBe(false);

    // 再来一个没有会话的：收进同一个「恢复的视频」，重名的加序号。
    const another = path.join(home.scratchDir, 'conv_gone2');
    await fakeVideo(path.join(another, '孤儿视频'));
    await harness.shutdown();
    harness = await open();
    expect(await harness.migrateScratch()).toMatchObject({ recovered: 1 });
    expect(harness.listProjects().filter((p) => p.name.startsWith(HP.recoveredVideos().text))).toHaveLength(1);
    expect(await exists(path.join(recovered.path, '孤儿视频 2', 'video.db'))).toBe(true);
  });

  it('启动迁移：属于项目的会话还留着的工作目录（回合中绑定后的链接或剩下的文件）收拾掉', async () => {
    const conversation = await harness.createConversation({ title: '收尾' });
    const project = await harness.ensureConversationProject(conversation.id);
    const scratch = path.join(home.scratchDir, conversation.id);
    await fs.mkdir(scratch, { recursive: true });
    await fs.writeFile(path.join(scratch, 'late.txt'), 'x');
    await harness.migrateScratch();
    expect(await exists(scratch)).toBe(false);
    expect(await exists(path.join(project.path, 'late.txt'))).toBe(true);

    await fs.symlink(project.path, scratch, 'dir');
    await harness.migrateScratch();
    expect(await exists(scratch)).toBe(false);
    expect(await exists(path.join(project.path, 'late.txt'))).toBe(true);
  });

  it('删除工作目录里还有视频的会话：先建以视频命名的项目搬进去再删，视频不丢；没有视频的工作目录随会话删掉', async () => {
    const legacy = await harness.createConversation({ title: '要删的' });
    await fakeVideo(path.join(legacy.cwd, '留下的视频'));
    await harness.deleteConversation(legacy.id);
    const project = harness.listProjects().find((p) => p.name === '留下的视频')!;
    expect(project).toBeTruthy();
    expect(await exists(path.join(project.path, '留下的视频', 'video.db'))).toBe(true);
    expect(await exists(legacy.cwd)).toBe(false);

    const chat = await harness.createConversation({ title: '闲聊' });
    await fs.writeFile(path.join(chat.cwd, 'a.txt'), 'x');
    await harness.deleteConversation(chat.id);
    expect(await exists(chat.cwd)).toBe(false);
    expect(harness.listProjects()).toHaveLength(1);
  });

  it('旧版本放在 Runtime Home 里的工作目录：启动时搬到新位置，会话跟着换；属于项目的与没有会话的照旧收拾', async () => {
    await harness.shutdown();
    home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home'), BAOCUT_SESSIONS_DIR: path.join(dir, 'sessions') });
    const legacyDir = home.legacyScratchDir!;
    expect(legacyDir).toBe(path.join(dir, 'home', 'scratch'));
    // 先按旧位置建会话：用一个旧布局的 Home 打开。
    const oldHome = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
    harness = await Harness.open({
      home: oldHome,
      conversations: new ConversationStore(oldHome.conversationsDir),
      projects: new ProjectStore(oldHome.projectsFile),
      drivers: new DriverRegistry(),
      log: silentLogger,
    });
    const kept = await harness.createConversation({ title: '留着' });
    await fakeVideo(path.join(kept.cwd, '旧视频'));
    const gone = await harness.createConversation({ title: '目录没了' });
    await fs.rm(gone.cwd, { recursive: true });
    const orphan = path.join(legacyDir, 'conv_gone');
    await fakeVideo(path.join(orphan, '孤儿视频'));
    await harness.shutdown();

    harness = await open();
    const result = await harness.migrateScratch();
    expect(result).toMatchObject({ moved: 2, recovered: 1 });
    const moved = harness.getConversation(kept.id).conversation;
    expect(moved).toMatchObject({ projectId: null, cwd: path.join(home.scratchDir, kept.id) });
    expect(await exists(path.join(moved.cwd, '旧视频', 'video.db'))).toBe(true);
    expect(harness.getConversation(gone.id).conversation.cwd).toBe(path.join(home.scratchDir, gone.id));
    expect(await exists(path.join(home.scratchDir, gone.id))).toBe(true);
    expect(await exists(legacyDir)).toBe(false);

    // 落盘：重启后还是新位置，再跑一遍什么也不做。
    await harness.shutdown();
    harness = await open();
    expect(harness.getConversation(kept.id).conversation.cwd).toBe(moved.cwd);
    expect(await harness.migrateScratch()).toEqual({ moved: 0, folded: 0, recovered: 0, removed: 0 });
  });

  it('打开着的视频不搬：留在工作目录里，其余照搬；关掉之后再搬', async () => {
    await harness.shutdown();
    let busy: string[] = [];
    harness = await Harness.open({
      home,
      conversations: new ConversationStore(home.conversationsDir),
      projects: new ProjectStore(home.projectsFile),
      drivers: new DriverRegistry(),
      log: silentLogger,
      openVideoDirs: () => busy,
    });
    const conversation = await harness.createConversation({ title: '开着' });
    await fakeVideo(path.join(conversation.cwd, '开着的'));
    await fs.writeFile(path.join(conversation.cwd, 'b.txt'), 'x');
    busy = [path.join(await fs.realpath(conversation.cwd), '开着的')];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const project = await harness.ensureConversationProject(conversation.id);
      expect(await exists(path.join(project.path, 'b.txt'))).toBe(true);
      expect(await exists(path.join(conversation.cwd, '开着的', 'video.db'))).toBe(true);
      // 计时器用假的，文件操作是真的：让出事件循环等它们做完。
      const until = async (done: () => boolean | Promise<boolean>) => {
        for (let i = 0; i < 5000 && !(await done()); i++) await new Promise((r) => setImmediate(r));
      };
      // 还开着：到点也不搬，再等下一次。
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      await until(() => vi.getTimerCount() === 1);
      expect(await exists(path.join(conversation.cwd, '开着的', 'video.db'))).toBe(true);
      // 视频关掉之后，过一会儿自己搬过去（不用等下次启动）。
      busy = [];
      await vi.advanceTimersByTimeAsync(30_000);
      await until(async () => !(await exists(conversation.cwd)));
      expect(await exists(conversation.cwd)).toBe(false);
      expect(await exists(path.join(project.path, '开着的', 'video.db'))).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('withEditorContext', () => {
  const base = { videoId: 'vid', videoName: '样片', videoPath: 'videos/样片', revision: '3', selection: [], playheadSeconds: 1.5 };

  it('带界面语言时在上下文块里写一行', () => {
    const text = withEditorContext('剪一下', { ...base, uiLanguage: 'zh-Hans' });
    expect(text).toContain('<baocut-editor-context>');
    expect(text).toContain('\n用户的界面语言是 zh-Hans。\n');
  });

  it('旧客户端没给界面语言时不写这一行', () => {
    expect(withEditorContext('剪一下', base)).not.toContain('界面语言');
  });
});
