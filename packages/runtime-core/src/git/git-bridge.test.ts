import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type ExternalToolStatus, type Project } from '@baocut/protocol';
import { silentLogger } from '@baocut/harness';
import type { VideoChanged, VideoClosed } from '../videos/video-service.ts';
import { GitRunner, gitEnv } from './git-command.ts';
import { ATTRIBUTES_BLOCK, BLOCK_END, BLOCK_START, EXCLUDE_BLOCK, ensureInfoBlocks, withBlock } from './git-repo.ts';
import { LocalConfigGate, isGatedKey, isStandardLfs, parseConfigList } from './git-local-config.ts';
import { commitMessage, lastCommittedVersion, parseVersionHead } from './git-commit.ts';
import { initRefusal } from './git-init.ts';
import { ProjectGitService, type ProjectGitSettings } from './project-git-service.ts';

/**
 * git 桥（版本记录设计 §5）用真实的 git 在临时仓库里测：全局与系统配置隔离（临时 HOME、`GIT_CONFIG_NOSYSTEM`），
 * 开发机上的 LFS、签名、钩子目录与模板不会混进来。没有 git 的机器上跳过。
 */

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const posix = process.platform !== 'win32';

let scratch: string;
let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-git-')));
  home = path.join(scratch, 'home');
  await fs.mkdir(home, { recursive: true });
  env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  await fs.writeFile(path.join(home, '.gitconfig'), '[init]\n\tdefaultBranch = main\n');
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

/** 测试自己准备仓库用的 git（不带 BaoCut 的安全参数）。 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: { ...env, GIT_AUTHOR_DATE: '', GIT_COMMITTER_DATE: '' }, encoding: 'utf8' });
}

function runner(): GitRunner {
  return new GitRunner({ git: 'git', env, hooksDir: path.join(scratch, 'baocut-home', 'git', 'hooks') });
}

async function write(file: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

/** 一部视频：快照、一份文档、一个版本文件、一个小素材，外加不能提交的库与锁。 */
async function makeVideo(dir: string, options: { videoId?: string; name?: string; summary?: string; seq?: number } = {}): Promise<void> {
  const snapshot = path.join(dir, '.bcut-snapshot');
  const seq = options.seq ?? 1;
  const video = { videoId: options.videoId ?? 'vid_1', video: { name: options.name ?? 'Episode 1' }, revision: seq };
  await write(path.join(snapshot, 'video.json'), `${JSON.stringify(video, null, 2)}\n`);
  await write(path.join(snapshot, 'documents', 'doc_1.json'), '{\n  "text": "hello"\n}\n');
  await write(
    path.join(snapshot, 'history', `${String(seq).padStart(6, '0')}.patch`),
    [
      `BaoCut-Version: ${seq}`,
      'Kind: segment',
      `Started-At: ${new Date().toISOString()}`,
      `Updated-At: ${new Date().toISOString()}`,
      'Revisions: 1..2',
      `Summary: ${options.summary ?? 'Trimmed the intro'}`,
      'Action: user | Trim | 2',
      '',
      'diff --git a/video.json b/video.json',
      '',
    ].join('\n'),
  );
  await write(path.join(dir, 'blobs', 'abc.png'), 'png');
  await write(path.join(dir, 'video.db'), 'sqlite');
  await write(path.join(dir, 'video.lock'), '');
}

const toolStatus = (gitPath: string | null): ExternalToolStatus => ({
  name: 'git',
  label: 'git',
  purpose: '',
  state: gitPath ? 'installed' : 'missing',
  reason: gitPath ? null : 'missing',
  path: gitPath,
  version: gitPath ? '2.40.0' : null,
  source: gitPath ? 'system' : null,
  minVersion: '2.30',
  installable: false,
  offer: null,
  consentRequired: false,
  consent: null,
  managed: null,
  userPath: null,
  installJobId: null,
  update: null,
  updateJobId: null,
  platform: process.platform,
  remedy: gitPath ? null : 'install git',
});

interface Harness {
  service: ProjectGitService;
  project: Project;
  settings: ProjectGitSettings;
  changed: (change: Partial<VideoChanged>) => void;
  closed: (closed: Partial<VideoClosed>) => void;
  open: { count: number };
  flushed: string[];
}

function service(projectDir: string, options: { gitPath?: string | null; settings?: Partial<ProjectGitSettings>; quietMs?: number } = {}): Harness {
  const project = { id: 'prj_1', name: 'Show', path: projectDir } as Project;
  const settings: ProjectGitSettings = { autoCommit: false, maxFileMiB: 1, ...options.settings };
  const changeListeners: Array<(change: VideoChanged) => void> = [];
  const closeListeners: Array<(closed: VideoClosed) => void> = [];
  const open = { count: 0 };
  const flushed: string[] = [];
  const instance = new ProjectGitService({
    log: silentLogger,
    tools: { status: async () => toolStatus(options.gitPath === undefined ? 'git' : options.gitPath) },
    env: async () => env,
    dir: path.join(scratch, 'baocut-home', 'git'),
    storeFile: path.join(scratch, 'baocut-home', 'store', 'git-local-config.json'),
    projects: () => [project],
    videos: {
      flushProjectSnapshots: async (projectId) => {
        flushed.push(projectId);
      },
      onChange: (listener) => {
        changeListeners.push(listener);
        return () => {};
      },
      onClosed: (listener) => {
        closeListeners.push(listener);
        return () => {};
      },
      onProjectOpened: () => () => {},
      openProjectVideoCount: () => open.count,
    },
    settings: () => settings,
    quietMs: options.quietMs ?? 60_000,
    lockRetries: 2,
    lockDelayMs: 10,
    home,
  });
  return {
    service: instance,
    project,
    settings,
    open,
    flushed,
    changed: (change) => changeListeners.forEach((listener) => listener({ videoId: 'vid_1', path: '', revision: 'r', projectId: project.id, ...change })),
    closed: (closed) => closeListeners.forEach((listener) => listener({ videoId: 'vid_1', path: '', projectId: project.id, reason: 'closed', ...closed })),
  };
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

const committedFiles = (repo: string) => git(repo, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').filter(Boolean).sort();

describe('git 的运行环境', () => {
  it('去掉会把命令指到别处的 GIT_* 与 EMAIL，留下用户选的全局配置位置', () => {
    const result = gitEnv({ PATH: '/bin', GIT_DIR: '/x', git_work_tree: '/y', GIT_CONFIG_COUNT: '1', GIT_CONFIG_GLOBAL: '/g', EMAIL: 'a@b', HOME: '/h' });
    expect(result).toMatchObject({ PATH: '/bin', HOME: '/h', GIT_CONFIG_GLOBAL: '/g', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
    for (const key of ['GIT_DIR', 'git_work_tree', 'GIT_CONFIG_COUNT', 'EMAIL']) expect(result).not.toHaveProperty(key);
  });

  it('每次都带固定的安全参数与空的钩子目录', () => {
    const argv = new GitRunner({ git: 'git', env: {}, hooksDir: '/hooks' }).argv(['status'], { literal: true });
    expect(argv.slice(0, 2)).toEqual(['--no-pager', '--literal-pathspecs']);
    for (const entry of ['core.hooksPath=/hooks', 'core.fsmonitor=false', 'commit.gpgSign=false', 'maintenance.auto=false', 'gc.auto=0']) {
      expect(argv).toContain(entry);
    }
    expect(argv.at(-1)).toBe('status');
  });
});

describe('info/* 的块', () => {
  it('追加、替换，块外的内容一字不动', () => {
    expect(withBlock('', ['a'])).toBe(`${BLOCK_START}\na\n${BLOCK_END}\n`);
    expect(withBlock('*.log', ['a'])).toBe(`*.log\n${BLOCK_START}\na\n${BLOCK_END}\n`);
    const before = `# mine\n${BLOCK_START}\nold\n${BLOCK_END}\n*.tmp\n`;
    expect(withBlock(before, ['new'])).toBe(`# mine\n${BLOCK_START}\nnew\n${BLOCK_END}\n*.tmp\n`);
    expect(withBlock('a\r\nb\r\n', ['x'])).toBe(`a\r\nb\r\n${BLOCK_START}\r\nx\r\n${BLOCK_END}\r\n`);
    // 已经是这样时不变（不重写文件）。
    const same = withBlock('a\n', ['x']);
    expect(withBlock(same, ['x'])).toBe(same);
  });

  it.skipIf(!hasGit)('仓库里写 exclude 与 attributes；video.db、锁与版本文件因此不进 git', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    await write(path.join(repo, '.git', 'info', 'exclude'), '# user rule\n*.bak\n');
    await makeVideo(path.join(repo, 'ep1'));
    expect(await ensureInfoBlocks(runner(), path.join(repo, 'ep1'))).toBe(repo);
    const exclude = await fs.readFile(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.startsWith('# user rule\n*.bak\n')).toBe(true);
    expect(exclude).toContain(EXCLUDE_BLOCK.join('\n'));
    expect(await fs.readFile(path.join(repo, '.git', 'info', 'attributes'), 'utf8')).toContain(ATTRIBUTES_BLOCK[0]);
    const untracked = git(repo, 'ls-files', '--others', '--exclude-standard').trim().split('\n').sort();
    expect(untracked).toEqual(['ep1/.bcut-snapshot/documents/doc_1.json', 'ep1/.bcut-snapshot/video.json', 'ep1/blobs/abc.png']);
    expect(git(repo, 'check-attr', 'eol', 'merge', '--', 'ep1/.bcut-snapshot/video.json')).toContain('eol: lf');
  });

  it.skipIf(!hasGit)('worktree 里按 --git-path 写到共用的 info/；没有 git 时遇到 .git 文件跳过', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    const worktree = path.join(scratch, 'wt');
    git(repo, 'worktree', 'add', '-q', worktree);
    expect(await ensureInfoBlocks(null, worktree)).toBeNull();
    expect(existsSync(path.join(repo, '.git', 'info', 'attributes'))).toBe(false);
    expect(await ensureInfoBlocks(runner(), worktree)).toBe(worktree);
    expect(await fs.readFile(path.join(repo, '.git', 'info', 'attributes'), 'utf8')).toContain(BLOCK_START);
  });

  it.skipIf(!hasGit)('core.autocrlf=true 时快照仍按 LF 检出与提交', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    git(repo, 'config', 'core.autocrlf', 'true');
    await makeVideo(path.join(repo, 'ep1'));
    const { service: bridge, project } = service(repo);
    project.path = repo;
    const result = await bridge.commit(project.id);
    expect(result.committed).toBe(true);
    expect(git(repo, 'ls-files', '--eol', '--', 'ep1/.bcut-snapshot/video.json')).toMatch(/^i\/lf\s+w\/lf\s+attr\/text eol=lf/);
  });
});

describe('本地过滤器的闸门', () => {
  it('只认要执行程序或包含文件的键，git-lfs 只认逐字的值', () => {
    expect(isGatedKey('filter.crypt.clean')).toBe(true);
    expect(isGatedKey('filter.Crypt.process')).toBe(true);
    expect(isGatedKey('filter.crypt.required')).toBe(false);
    expect(isGatedKey('include.path')).toBe(true);
    expect(isGatedKey('includeif.gitdir:~/work/.path')).toBe(true);
    expect(isGatedKey('user.name')).toBe(false);
    expect(isStandardLfs('filter.lfs.clean', 'git-lfs clean -- %f')).toBe(true);
    expect(isStandardLfs('filter.lfs.smudge', 'git-lfs smudge --skip -- %f')).toBe(true);
    expect(isStandardLfs('filter.lfs.process', 'git-lfs filter-process --skip')).toBe(true);
    expect(isStandardLfs('filter.lfs.clean', 'git-lfs clean -- %f; rm -rf ~')).toBe(false);
    expect(isStandardLfs('filter.lfs.clean', '/tmp/git-lfs clean -- %f')).toBe(false);
  });

  it('解析 --show-scope --show-origin -z 的输出', () => {
    const output = Buffer.from('local\0file:.git/config\0filter.x.clean\ncat\0command\0command line:\0core.bare\0');
    expect(parseConfigList(output, '/repo')).toEqual([
      { scope: 'local', file: path.resolve('/repo', '.git/config'), key: 'filter.x.clean', value: 'cat' },
      { scope: 'command', file: null, key: 'core.bare', value: '' },
    ]);
  });

  it.skipIf(!hasGit)('启用之后改 user.name 不重新暂停，改过滤器的命令或被包含的文件会', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    const found = { root: repo, gitDir: path.join(repo, '.git'), commonDir: path.join(repo, '.git'), prefix: '' };
    const gate = new LocalConfigGate(path.join(scratch, 'store.json'));
    expect((await gate.check(runner(), found)).allowed).toBe(true);

    // git lfs install --local 写下的值不暂停。
    git(repo, 'config', 'filter.lfs.clean', 'git-lfs clean -- %f');
    git(repo, 'config', 'filter.lfs.smudge', 'git-lfs smudge -- %f');
    git(repo, 'config', 'filter.lfs.process', 'git-lfs filter-process');
    git(repo, 'config', 'filter.lfs.required', 'true');
    expect(await gate.check(runner(), found)).toMatchObject({ allowed: true, entries: [] });

    git(repo, 'config', 'filter.crypt.clean', 'crypt-tool encrypt');
    await write(path.join(repo, '.git', 'extra.cfg'), '[user]\n\temail = a@b\n');
    git(repo, 'config', 'include.path', 'extra.cfg');
    const first = await gate.check(runner(), found);
    expect(first.allowed).toBe(false);
    expect(first.changed).toBe(false);
    expect(first.entries.map((entry) => `${entry.key}=${entry.value}`)).toEqual(['filter.crypt.clean=crypt-tool encrypt', 'include.path=extra.cfg']);
    await gate.allow(found, first.digest!);
    expect((await gate.check(runner(), found)).allowed).toBe(true);

    git(repo, 'config', 'user.name', 'Someone Else');
    expect((await gate.check(runner(), found)).allowed).toBe(true);

    await write(path.join(repo, '.git', 'extra.cfg'), '[filter "sneaky"]\n\tsmudge = evil\n');
    const included = await gate.check(runner(), found);
    expect(included).toMatchObject({ allowed: false, changed: true });
    await gate.allow(found, included.digest!);

    git(repo, 'config', 'filter.crypt.clean', 'crypt-tool encrypt --other');
    expect(await gate.check(runner(), found)).toMatchObject({ allowed: false, changed: true });
  });

  it.skipIf(!hasGit || !posix)('暂停期间状态与提交都不运行过滤器；允许之后才运行', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    const marker = path.join(scratch, 'filter-ran');
    git(repo, 'config', 'filter.mark.clean', `sh -c 'touch "${marker}"; cat'`);
    await write(path.join(repo, '.gitattributes'), '*.json filter=mark\n');
    await makeVideo(path.join(repo, 'ep1'));
    // 已跟踪、又改过的文件：status 会对它运行 clean 过滤器。
    git(repo, '-c', 'filter.mark.clean=cat', 'add', 'ep1/.bcut-snapshot/video.json');
    git(repo, '-c', 'filter.mark.clean=cat', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed');
    await write(path.join(repo, 'ep1', '.bcut-snapshot', 'video.json'), '{"videoId":"vid_1","video":{"name":"Changed"}}\n');
    const { service: bridge, project } = service(repo);

    const status = await bridge.status(project.id);
    expect(status.state).toBe('paused');
    expect(status.pause?.reason).toBe('local-config');
    expect(status.pause?.localConfig?.entries?.map((entry) => entry.key)).toEqual(['filter.mark.clean']);
    const error = await rejection(bridge.commit(project.id));
    expect(error.details).toMatchObject({ code: 'GIT_PAUSED', reason: 'local-config' });
    expect(existsSync(marker)).toBe(false);

    // Web 看不到条目与路径。
    const web = await bridge.status(project.id, { web: true });
    expect(web.repoRoot).toBeUndefined();
    expect(web.pause?.localConfig?.entries).toBeUndefined();
    expect(web.pause?.localConfig?.digest).toBe(status.pause?.localConfig?.digest);

    const stale = await rejection(bridge.allowLocalConfig(project.id, `sha256:${'0'.repeat(64)}`));
    expect(stale.details).toMatchObject({ code: 'GIT_PAUSED', reason: 'local-config' });
    expect((await bridge.allowLocalConfig(project.id, status.pause!.localConfig!.digest)).state).toBe('ready');
    expect((await bridge.commit(project.id)).committed).toBe(true);
    expect(existsSync(marker)).toBe(true);
  });
});

describe('提交到 git', () => {
  it.skipIf(!hasGit)('只提交 BaoCut 的路径：用户暂存的文件留在暂存区，大素材、库、锁与版本文件不提交', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    await write(path.join(repo, 'script.py'), 'print(1)\n');
    git(repo, 'add', 'script.py');
    await write(path.join(repo, 'notes.md'), 'draft\n');
    await makeVideo(path.join(repo, 'ep1'));
    await write(path.join(repo, 'ep1', 'blobs', 'big.bin'), Buffer.alloc(1024 * 1024 + 1));
    await write(path.join(repo, 'ep1', 'blobs', '.staging', 'part'), 'x');
    const { service: bridge, project, flushed } = service(repo);

    const result = await bridge.commit(project.id);
    expect(flushed).toEqual([project.id]);
    expect(result).toMatchObject({ committed: true, files: 3, videos: [{ videoId: 'vid_1', from: 1, to: 1 }] });
    expect(result.status.state).toBe('ready');
    expect(committedFiles(repo)).toEqual(['ep1/.bcut-snapshot/documents/doc_1.json', 'ep1/.bcut-snapshot/video.json', 'ep1/blobs/abc.png']);
    expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('script.py');
    expect(git(repo, 'status', '--porcelain', '--', 'notes.md').trim()).toBe('?? notes.md');

    const message = git(repo, 'log', '-1', '--format=%B');
    expect(message.split('\n')[0]).toBe('Trimmed the intro');
    expect(message).toContain('BaoCut-Video: vid_1 v1..v1');
    // 没配身份时用 BaoCut 的兜底，不从系统用户名与主机名拼。
    expect(git(repo, 'log', '-1', '--format=%an <%ae>|%cn <%ce>').trim()).toBe('BaoCut <baocut@localhost>|BaoCut <baocut@localhost>');

    // 再提交一次：没有改动。
    expect((await bridge.commit(project.id)).committed).toBe(false);
  });

  it.skipIf(!hasGit)('用户的身份齐全时用用户的；缺邮箱时整个用兜底', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    await makeVideo(path.join(repo, 'ep1'));
    git(repo, 'config', 'user.name', 'Ada');
    const { service: bridge, project } = service(repo);
    await bridge.commit(project.id);
    expect(git(repo, 'log', '-1', '--format=%an <%ae>').trim()).toBe('BaoCut <baocut@localhost>');
    git(repo, 'config', 'user.email', 'ada@example.com');
    await makeVideo(path.join(repo, 'ep2'), { videoId: 'vid_2', name: 'Episode 2' });
    await bridge.commit(project.id, { message: 'Rough cut' });
    expect(git(repo, 'log', '-1', '--format=%an <%ae>|%s').trim()).toBe('Ada <ada@example.com>|Rough cut');
  });

  it.skipIf(!hasGit)('Git LFS 跟踪的路径不受大小限制；用户忽略了的不提交', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    await write(path.join(repo, '.gitattributes'), '*.mov filter=lfs diff=lfs merge=lfs -text\n');
    await write(path.join(repo, '.gitignore'), '*.wav\n');
    await makeVideo(path.join(repo, 'ep1'));
    await write(path.join(repo, 'ep1', 'blobs', 'clip.mov'), Buffer.alloc(1024 * 1024 + 1));
    await write(path.join(repo, 'ep1', 'blobs', 'voice.wav'), 'wav');
    const { service: bridge, project } = service(repo);
    await bridge.commit(project.id);
    const files = committedFiles(repo);
    expect(files).toContain('ep1/blobs/clip.mov');
    expect(files).not.toContain('ep1/blobs/voice.wav');
  });

  it.skipIf(!hasGit)('项目是仓库的子目录时只看项目里的视频', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    await makeVideo(path.join(repo, 'other', 'ep9'), { videoId: 'vid_9' });
    const projectDir = path.join(repo, 'shows', 'season 1');
    await makeVideo(path.join(projectDir, 'ep1'));
    const { service: bridge, project } = service(projectDir);
    const result = await bridge.commit(project.id);
    expect(result.videos.map((video) => video.videoId)).toEqual(['vid_1']);
    expect(committedFiles(repo).every((file) => file.startsWith('shows/season 1/ep1/'))).toBe(true);
  });

  it.skipIf(!hasGit)('index.lock 在时重试后推迟，不删锁文件', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    await makeVideo(path.join(repo, 'ep1'));
    const lock = path.join(repo, '.git', 'index.lock');
    await write(lock, '');
    const { service: bridge, project } = service(repo);
    expect((await bridge.status(project.id)).pause?.reason).toBe('locked');
    const error = await rejection(bridge.commit(project.id));
    expect(error.details).toMatchObject({ code: 'GIT_PAUSED', reason: 'locked' });
    expect(existsSync(lock)).toBe(true);
    await fs.rm(lock);
    expect((await bridge.commit(project.id)).committed).toBe(true);
  });

  it.skipIf(!hasGit || !posix)('仓库里的钩子不运行', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    const marker = path.join(scratch, 'hook-ran');
    for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']) {
      await write(path.join(repo, '.git', 'hooks', hook), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
      await fs.chmod(path.join(repo, '.git', 'hooks', hook), 0o755);
    }
    await makeVideo(path.join(repo, 'ep1'));
    const { service: bridge, project } = service(repo);
    expect((await bridge.commit(project.id)).committed).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(!hasGit)('合并、变基、二分中与 HEAD 分离时暂停', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    await makeVideo(path.join(repo, 'ep1'));
    const { service: bridge, project } = service(repo);
    const head = git(repo, 'rev-parse', 'HEAD').trim();

    await write(path.join(repo, '.git', 'MERGE_HEAD'), `${head}\n`);
    expect((await bridge.status(project.id)).pause).toEqual({ reason: 'repo-state', repoState: 'merge' });
    expect((await rejection(bridge.commit(project.id))).details).toMatchObject({ code: 'GIT_PAUSED', reason: 'repo-state' });
    await fs.rm(path.join(repo, '.git', 'MERGE_HEAD'));

    await fs.mkdir(path.join(repo, '.git', 'rebase-merge'));
    expect((await bridge.status(project.id)).pause?.repoState).toBe('rebase');
    await fs.rm(path.join(repo, '.git', 'rebase-merge'), { recursive: true });

    await write(path.join(repo, '.git', 'BISECT_LOG'), '');
    expect((await bridge.status(project.id)).pause?.repoState).toBe('bisect');
    await fs.rm(path.join(repo, '.git', 'BISECT_LOG'));

    git(repo, 'checkout', '-q', '--detach');
    const detached = await bridge.status(project.id);
    expect(detached).toMatchObject({ state: 'paused', branch: null, pause: { reason: 'repo-state', repoState: 'detached' } });
    git(repo, 'checkout', '-q', 'main');
    expect(await bridge.status(project.id)).toMatchObject({ state: 'ready', branch: 'main' });
  });

  it.skipIf(!hasGit)('没有 git、不在仓库里时报 GIT_UNAVAILABLE', async () => {
    const dir = path.join(scratch, 'plain');
    await fs.mkdir(dir);
    const missing = service(dir, { gitPath: null });
    expect((await missing.service.status(missing.project.id)).state).toBe('unavailable');
    expect((await rejection(missing.service.commit(missing.project.id))).details).toMatchObject({ code: 'GIT_UNAVAILABLE', reason: 'missing' });
    const { service: bridge, project } = service(dir);
    expect(await bridge.status(project.id)).toMatchObject({ state: 'not-repo', init: { allowed: true } });
    expect((await rejection(bridge.commit(project.id))).details).toMatchObject({ code: 'GIT_UNAVAILABLE', reason: 'not-repo' });
  });
});

describe('初始化 git', () => {
  it('主目录、标准用户文件夹与卷的根不初始化', async () => {
    const fakeHome = path.join(scratch, 'me');
    await fs.mkdir(path.join(fakeHome, 'Documents'), { recursive: true });
    expect(await initRefusal(fakeHome, { home: fakeHome })).toEqual({ refusal: 'home' });
    expect(await initRefusal(path.join(fakeHome, 'Documents'), { home: fakeHome })).toMatchObject({ refusal: 'user-folder' });
    expect(await initRefusal(path.join(fakeHome, 'Movies'), { home: fakeHome })).toMatchObject({ refusal: 'user-folder' });
    expect(await initRefusal(path.join(fakeHome, 'Documents', 'My Show'), { home: fakeHome })).toBeNull();
    expect(await initRefusal('/', { home: fakeHome, platform: 'linux' })).toEqual({ refusal: 'volume-root' });
    expect(await initRefusal('/Volumes/Footage', { home: fakeHome, platform: 'darwin' })).toEqual({ refusal: 'volume-root' });
    expect(await initRefusal('/Volumes/Footage/show', { home: fakeHome, platform: 'darwin' })).toBeNull();
    expect(await initRefusal('/media/me/USB', { home: fakeHome, platform: 'linux' })).toEqual({ refusal: 'volume-root' });
    expect(await initRefusal('D:\\', { home: 'C:\\Users\\me', platform: 'win32' })).toEqual({ refusal: 'volume-root' });
    expect(await initRefusal('C:\\Users\\Me\\desktop', { home: 'C:\\Users\\me', platform: 'win32' })).toMatchObject({ refusal: 'user-folder' });
    expect(await initRefusal('C:\\Users\\me\\Videos\\show', { home: 'C:\\Users\\me', platform: 'win32' })).toBeNull();
  });

  it.skipIf(!hasGit)('在项目目录初始化并写块；已经在仓库里或在主目录时拒绝', async () => {
    const dir = path.join(scratch, 'show');
    await fs.mkdir(dir);
    const { service: bridge, project } = service(dir);
    const status = await bridge.init(project.id);
    expect(status.state).toBe('ready');
    expect(await fs.readFile(path.join(dir, '.git', 'info', 'exclude'), 'utf8')).toContain(BLOCK_START);
    expect((await rejection(bridge.init(project.id))).details).toMatchObject({ code: 'GIT_INIT_REFUSED', reason: 'inside-repo' });

    const inHome = service(home);
    expect(await inHome.service.status(inHome.project.id)).toMatchObject({ state: 'not-repo', init: { allowed: false, refusal: 'home' } });
    expect((await rejection(inHome.service.init(inHome.project.id))).details).toMatchObject({ code: 'GIT_INIT_REFUSED', reason: 'home' });
    expect(existsSync(path.join(home, '.git'))).toBe(false);
  });
});

describe('自动提交', () => {
  const commits = (repo: string) => Number(git(repo, 'rev-list', '--count', '--all').trim() || '0');

  it.skipIf(!hasGit)('安静一段时间之后提交一次；设置关着时只记下有改动', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    await makeVideo(path.join(repo, 'ep1'));
    const harness = service(repo, { quietMs: 20 });
    harness.changed({});
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(commits(repo)).toBe(0);

    harness.settings.autoCommit = true;
    harness.changed({});
    await waitFor(() => commits(repo) === 1);
    await expect(harness.service.status(harness.project.id)).resolves.toMatchObject({ lastCommit: { trigger: 'auto' } });
  });

  it.skipIf(!hasGit)('项目的视频都关掉时与退出时提交；版本范围从上次提交的尾注接着算', async () => {
    const repo = path.join(scratch, 'repo');
    git(scratch, 'init', '-q', repo);
    await makeVideo(path.join(repo, 'ep1'));
    const harness = service(repo, { settings: { autoCommit: true } });

    harness.open.count = 1;
    harness.changed({});
    harness.closed({});
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(commits(repo)).toBe(0);
    harness.open.count = 0;
    harness.closed({});
    await waitFor(() => commits(repo) === 1);
    expect(git(repo, 'log', '-1', '--format=%B')).toContain('BaoCut-Video: vid_1 v1..v1');

    await makeVideo(path.join(repo, 'ep1'), { seq: 2, summary: 'Added captions' });
    harness.changed({});
    await harness.service.shutdown();
    expect(commits(repo)).toBe(2);
    const message = git(repo, 'log', '-1', '--format=%B');
    expect(message.split('\n')[0]).toBe('Added captions');
    expect(message).toContain('BaoCut-Video: vid_1 v2..v2');
  });
});

describe('提交说明', () => {
  it('标题取版本的名字与摘要，尾注列出版本范围', () => {
    const versions = [
      { seq: 3, updatedAt: 1, label: 'Trimmed the intro' },
      { seq: 4, updatedAt: 2, label: 'Added captions' },
    ];
    const message = commitMessage(
      [
        { video: { videoId: 'vid_1', name: 'Episode 1', rel: 'ep1/' }, versions },
        { video: { videoId: 'vid_2', name: 'Episode 2', rel: 'ep2/' }, versions: [] },
      ],
      undefined,
      (names) => `BaoCut: update ${names.join(', ')}`,
    );
    expect(message.split('\n')[0]).toBe('Trimmed the intro; Added captions');
    expect(message).toContain('Episode 1 v3..v4\n- v3: Trimmed the intro\n- v4: Added captions');
    expect(message).toContain('BaoCut-Video: vid_1 v3..v4\nBaoCut-Video: vid_2\n');
    expect(commitMessage([{ video: { videoId: 'vid_2', name: 'Episode 2', rel: 'ep2/' }, versions: [] }], undefined, (names) => `BaoCut: update ${names.join(', ')}`).split('\n')[0]).toBe(
      'BaoCut: update Episode 2',
    );
  });

  it('从上次的提交说明读出这部视频提交到的版本', () => {
    const message = 'Title\n\nBaoCut-Video: vid_2 v1..v9\nBaoCut-Video: vid_1 v3..v4\nBaoCut-Video: vid_3\n';
    expect(lastCommittedVersion(message, 'vid_1')).toBe(4);
    expect(lastCommittedVersion(message, 'vid_3')).toBeNull();
    expect(lastCommittedVersion(message, 'vid_x')).toBeNull();
  });

  it('读版本头部：名字优先于摘要，转义还原', () => {
    expect(parseVersionHead('BaoCut-Version: 7\nUpdated-At: 2026-01-01T00:00:00Z\nSummary: a\\nb\nName: Final\n')).toEqual({
      seq: 7,
      updatedAt: Date.parse('2026-01-01T00:00:00Z'),
      label: 'Final',
    });
    expect(parseVersionHead('BaoCut-Version: 2\nUpdated-At: 2026-01-01T00:00:00Z\nSummary: \nAction: user | Split \\| clip | 3\n')?.label).toBe('Split \\| clip');
    expect(parseVersionHead('Kind: segment\n')).toBeNull();
  });
});

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
