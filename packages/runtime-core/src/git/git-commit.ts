import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Id, ProjectGitCommitVideo } from '@baocut/protocol';
import { gitErrorDetail, line, nulFields, type GitResult, type GitRunner } from './git-command.ts';
import { exists, gitPaths, type GitRepo } from './git-repo.ts';

/**
 * BaoCut 代为提交（版本记录设计 §5.3）：只提交项目里视频的快照与素材，用户自己的改动与暂存区里的其他文件原样不动。
 *
 * 1. 找视频：`ls-files` 列出项目目录下（已跟踪的与没被忽略的新文件）的 `.bcut-snapshot/video.json`。磁盘上已经没有的视频
 *    （删掉或移走的）不提交它们的删除，留给用户。
 * 2. 看改动：`status` 只看这些视频的 `video.json`、`documents/` 与 `blobs/`（`history/` 不进 git）。`blobs/` 里大于
 *    `maxFileBytes` 的新增或修改不提交，仓库用 Git LFS 跟踪的路径（`filter=lfs`）不受限；删除照常提交。
 * 3. `git add -- <路径>`，再 `git commit --only -F <说明文件> -- <路径>`：只提交这些路径，暂存区里别的改动留着。
 * 4. `index.lock` 存在时等一会儿重试，仍不行就交回 `locked` 推迟；任何时候都不删锁文件。
 */

export interface CommitInput {
  runner: GitRunner;
  repo: GitRepo;
  projectDir: string;
  /** `versions.git.maxFileMiB` 换成字节。 */
  maxFileBytes: number;
  /** 用户给的标题；不给时取版本的名字与摘要。 */
  message?: string | undefined;
  /** 版本里没有摘要时的标题（按 Runtime 的语言）。 */
  fallbackTitle: (names: readonly string[]) => string;
  /** 写提交说明文件的目录。 */
  messageDir: string;
  /** 遇到锁时最多再试几次、每次等多久（设计：2 秒 × 5 次）。 */
  lockRetries: number;
  lockDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

export type CommitOutcome =
  | { kind: 'committed'; commit: string; files: number; videos: ProjectGitCommitVideo[] }
  | { kind: 'nothing' }
  | { kind: 'locked' };

/** 项目里的一部视频。 */
interface VideoDir {
  /** 相对仓库根目录的视频目录前缀（`/` 结尾；视频就是仓库根目录时为空串）。 */
  rel: string;
  abs: string;
  videoId: Id | null;
  name: string | null;
}

/** 一个版本文件的头部里提交说明用得到的几项。 */
export interface VersionHead {
  seq: number;
  updatedAt: number;
  label: string | null;
}

const FALLBACK_AUTHOR = ['user.name=BaoCut', 'user.email=baocut@localhost'];
const TITLE_LIMIT = 72;

export async function commitProject(input: CommitInput): Promise<CommitOutcome> {
  const { runner, repo } = input;
  const videos = await findVideos(runner, repo, input.projectDir);
  if (videos.length === 0) return { kind: 'nothing' };

  const changed = await changedPaths(runner, input.projectDir, repo, videos);
  const files = await withinLimit(runner, repo, changed, input.maxFileBytes);
  if (files.length === 0) return { kind: 'nothing' };

  const touched = videos.filter((video) => files.some((file) => file.startsWith(video.rel)));
  const ranges = await Promise.all(touched.map(async (video) => ({ video, versions: await newVersions(runner, repo, video) })));
  const message = commitMessage(ranges, input.message, input.fallbackTitle);
  const author = (await hasIdentity(runner, repo)) ? [] : FALLBACK_AUTHOR;

  const [lockFile] = (await gitPaths(runner, repo.root, ['index.lock'])) as [string];
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempts = 0;
  /** 运行一步；锁在时等一会儿重试，用完次数交回 null（推迟）。 */
  const locked = async (step: () => Promise<GitResult>): Promise<GitResult | null> => {
    for (;;) {
      if (!(await exists(lockFile))) {
        const result = await step();
        if (!isLockFailure(result)) return result;
      }
      if (attempts >= input.lockRetries) return null;
      attempts += 1;
      await sleep(input.lockDelayMs);
    }
  };

  const pathspecs = `${files.join('\0')}\0`;
  const add = await locked(() =>
    runner.run(repo.root, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { literal: true, input: pathspecs }),
  );
  if (!add) return { kind: 'locked' };
  if (add.exitCode !== 0) throw new Error(`git add failed: ${gitErrorDetail(add)}`);

  await fs.mkdir(input.messageDir, { recursive: true });
  const messageFile = path.join(input.messageDir, `${randomUUID()}.txt`);
  await fs.writeFile(messageFile, message);
  try {
    const commit = await locked(() =>
      runner.run(
        repo.root,
        [
          'commit',
          '--only',
          '--no-verify',
          '--no-gpg-sign',
          '--no-edit',
          '--cleanup=whitespace',
          '-F',
          messageFile,
          '--pathspec-from-file=-',
          '--pathspec-file-nul',
        ],
        { literal: true, input: pathspecs, config: author },
      ),
    );
    if (!commit) return { kind: 'locked' };
    if (commit.exitCode !== 0) {
      if (/nothing (added )?to commit|no changes added to commit/i.test(commit.stdout.toString('utf8'))) return { kind: 'nothing' };
      throw new Error(`git commit failed: ${gitErrorDetail(commit)}`);
    }
  } finally {
    await fs.rm(messageFile, { force: true }).catch(() => {});
  }
  const head = await runner.run(repo.root, ['rev-parse', 'HEAD'], { query: true });
  if (head.exitCode !== 0) throw new Error(`git rev-parse HEAD failed: ${gitErrorDetail(head)}`);
  return {
    kind: 'committed',
    commit: line(head.stdout),
    files: files.length,
    videos: ranges
      .filter((range) => range.video.videoId)
      .map(({ video, versions }) => ({
        videoId: video.videoId!,
        from: versions.length > 0 ? versions[0]!.seq : null,
        to: versions.length > 0 ? versions.at(-1)!.seq : null,
      })),
  };
}

/** 别的 git 命令占着索引：`Unable to create '…/index.lock': File exists.` */
function isLockFailure(result: GitResult): boolean {
  return result.exitCode !== 0 && /index\.lock/.test(result.stderr) && /exists/i.test(result.stderr);
}

/** 项目目录下的视频（见文件头第 1 条）。 */
async function findVideos(runner: GitRunner, repo: GitRepo, projectDir: string): Promise<VideoDir[]> {
  const result = await runner.run(
    projectDir,
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/.bcut-snapshot/video.json'],
    { query: true },
  );
  if (result.exitCode !== 0) throw new Error(`git ls-files failed: ${gitErrorDetail(result)}`);
  const videos: VideoDir[] = [];
  for (const file of new Set(nulFields(result.stdout))) {
    const abs = path.join(projectDir, file);
    const text = await fs.readFile(abs, 'utf8').catch(() => null);
    if (text === null) continue;
    const dir = path.posix.dirname(path.posix.dirname(file));
    const rel = `${repo.prefix}${dir === '.' ? '' : `${dir}/`}`;
    const snapshot = parseJson(text);
    const video = snapshot?.video as { name?: unknown } | undefined;
    videos.push({
      rel,
      abs: path.dirname(path.dirname(abs)),
      videoId: typeof snapshot?.videoId === 'string' ? snapshot.videoId : null,
      name: typeof video?.name === 'string' ? video.name : null,
    });
  }
  return videos.sort((a, b) => a.rel.localeCompare(b.rel));
}

interface ChangedPath {
  /** 相对仓库根目录。 */
  path: string;
  deleted: boolean;
  blob: boolean;
}

/** 这些视频里有改动的 BaoCut 路径（`status` 只看这几处；用户忽略了的新文件不在里面）。 */
async function changedPaths(runner: GitRunner, projectDir: string, repo: GitRepo, videos: readonly VideoDir[]): Promise<ChangedPath[]> {
  const local = (video: VideoDir) => video.rel.slice(repo.prefix.length);
  const pathspecs = videos.flatMap((video) => [
    `${local(video)}.bcut-snapshot/video.json`,
    `${local(video)}.bcut-snapshot/documents`,
    `${local(video)}blobs`,
  ]);
  const result = await runner.run(
    projectDir,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all', '--no-renames', '--', ...pathspecs],
    { literal: true },
  );
  if (result.exitCode !== 0) throw new Error(`git status failed: ${gitErrorDetail(result)}`);
  const fields = nulFields(result.stdout);
  const changed: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]!;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    // 改名与复制（`--no-renames` 时不会有）后面跟着原来的路径。
    if (xy[0] === 'R' || xy[0] === 'C') index += 1;
    const video = videos.find((candidate) => file.startsWith(candidate.rel));
    if (!video) continue;
    const blob = file.startsWith(`${video.rel}blobs/`);
    if (blob && file.slice(`${video.rel}blobs/`.length).split('/')[0] === '.staging') continue;
    changed.push({ path: file, deleted: !(await exists(path.join(repo.root, file))), blob });
  }
  return changed;
}

/** 大小限制（§5.3）：`blobs/` 里新增或修改的大文件只在仓库用 Git LFS 跟踪它时提交。 */
async function withinLimit(runner: GitRunner, repo: GitRepo, changed: readonly ChangedPath[], maxBytes: number): Promise<string[]> {
  const large: string[] = [];
  for (const item of changed) {
    if (!item.blob || item.deleted) continue;
    const stat = await fs.stat(path.join(repo.root, item.path)).catch(() => null);
    if (stat && stat.size > maxBytes) large.push(item.path);
  }
  const lfs = new Set<string>();
  if (large.length > 0) {
    const result = await runner.run(repo.root, ['check-attr', '-z', '--stdin', 'filter'], { query: true, input: `${large.join('\0')}\0` });
    if (result.exitCode !== 0) throw new Error(`git check-attr failed: ${gitErrorDetail(result)}`);
    const fields = nulFields(result.stdout);
    for (let index = 0; index + 2 < fields.length; index += 3) if (fields[index + 2] === 'lfs') lfs.add(fields[index]!);
  }
  const skipped = new Set(large.filter((file) => !lfs.has(file)));
  return changed.map((item) => item.path).filter((file) => !skipped.has(file));
}

/** 仓库或全局配置了作者（名字与邮箱都有）；缺一个就用 BaoCut 的兜底身份，不让 git 从系统用户名与主机名拼。 */
async function hasIdentity(runner: GitRunner, repo: GitRepo): Promise<boolean> {
  const [name, email] = await Promise.all(
    ['user.name', 'user.email'].map((key) => runner.run(repo.root, ['config', '--get', key], { query: true })),
  );
  return name!.exitCode === 0 && line(name!.stdout).trim() !== '' && email!.exitCode === 0 && line(email!.stdout).trim() !== '';
}

/**
 * 上一次提交这部视频的快照之后的版本。那个提交带着这部视频的 `BaoCut-Video` 尾注时按版本号接着算（尾注里的最后一个版本
 * 之后又续写的也算）；否则（用户自己提交的、还没有提交过）按 `Updated-At` 与那个提交的时间比。读不出时为空。
 */
async function newVersions(runner: GitRunner, repo: GitRepo, video: VideoDir): Promise<VersionHead[]> {
  const last = await runner.run(repo.root, ['log', '-1', '--format=%ct%x00%B', '--', `${video.rel}.bcut-snapshot`], {
    query: true,
    literal: true,
  });
  // 还没有提交（新分支）时 git 报错：全部算新的。
  const [time = '', body = ''] = last.exitCode === 0 ? last.stdout.toString('utf8').split('\0') : [];
  const since = (Number(time.trim()) || 0) * 1000;
  const committedTo = video.videoId ? lastCommittedVersion(body, video.videoId) : null;
  const dir = path.join(video.abs, '.bcut-snapshot', 'history');
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const heads: VersionHead[] = [];
  for (const name of names) {
    if (!/^\d+\.patch$/.test(name)) continue;
    const head = parseVersionHead(await readHead(path.join(dir, name)));
    if (!head) continue;
    // 提交时间只到秒：同一秒里的旧版本不能再算一次。
    const fresh =
      committedTo === null ? head.updatedAt > since : head.seq > committedTo || (head.seq === committedTo && head.updatedAt >= since + 1000);
    if (fresh) heads.push(head);
  }
  return heads.sort((a, b) => a.seq - b.seq);
}

/** 提交说明里这部视频的尾注写到的最后一个版本；没有带版本范围的尾注时 null。 */
export function lastCommittedVersion(message: string, videoId: string): number | null {
  for (const text of message.split('\n')) {
    const match = /^BaoCut-Video: (\S+) v\d+\.\.v(\d+)\s*$/.exec(text.trim());
    if (match && match[1] === videoId) return Number(match[2]);
  }
  return null;
}

/** 版本文件的头部（到第一个空行为止；只读开头一段，diff 可能很大）。 */
async function readHead(file: string): Promise<string> {
  const handle = await fs.open(file, 'r').catch(() => null);
  if (!handle) return '';
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const end = text.indexOf('\n\n');
    return end < 0 ? text : text.slice(0, end);
  } finally {
    await handle.close();
  }
}

/** 解析版本头部（视频格式规范 §9.4）：标签依次取保存时的名字、摘要、第一组动作。 */
export function parseVersionHead(head: string): VersionHead | null {
  let seq: number | null = null;
  let updatedAt = Number.NaN;
  let name: string | null = null;
  let summary: string | null = null;
  let action: string | null = null;
  for (const text of head.split('\n')) {
    const at = text.indexOf(': ');
    if (at < 0) continue;
    const key = text.slice(0, at);
    const value = text.slice(at + 2);
    if (key === 'BaoCut-Version') seq = Number(value);
    else if (key === 'Updated-At') updatedAt = Date.parse(value);
    else if (key === 'Name') name = unescape(value);
    else if (key === 'Summary') summary = unescape(value);
    else if (key === 'Action' && action === null) {
      const parts = value.split(' | ');
      if (parts.length >= 3) action = unescape(parts.slice(1, -1).join(' | '));
    }
  }
  if (seq === null || !Number.isInteger(seq) || Number.isNaN(updatedAt)) return null;
  const label = [name, summary, action].map((text) => text?.split('\n')[0]!.trim() ?? '').find(Boolean) ?? null;
  return { seq, updatedAt, label };
}

function unescape(text: string): string {
  return text.replace(/\\(.)/g, (whole, next: string) => (next === 'n' ? '\n' : next === 'r' ? '\r' : next === '\\' ? '\\' : whole));
}

/**
 * 提交说明（§5.3）：标题取版本的名字与摘要（用户给了就用用户的），正文按视频列出版本序号与标签，尾注
 * `BaoCut-Video: <videoId> v<from>..v<to>`（键固定为英文）。
 */
export function commitMessage(
  ranges: ReadonlyArray<{ video: Pick<VideoDir, 'videoId' | 'name' | 'rel'>; versions: readonly VersionHead[] }>,
  given: string | undefined,
  fallbackTitle: (names: readonly string[]) => string,
): string {
  const labels = [...new Set(ranges.flatMap((range) => range.versions.map((version) => version.label).filter((label): label is string => !!label)))];
  const names = ranges.map(({ video }) => video.name ?? (video.rel.replace(/\/$/, '') || video.videoId || ''));
  const title = given?.trim() || (labels.length > 0 ? truncate(labels.join('; '), TITLE_LIMIT) : fallbackTitle(names));
  const body: string[] = [];
  for (const [index, { video, versions }] of ranges.entries()) {
    const range = versions.length > 0 ? ` v${versions[0]!.seq}..v${versions.at(-1)!.seq}` : '';
    body.push(`${names[index]}${range}`);
    for (const version of versions) if (version.label) body.push(`- v${version.seq}: ${version.label}`);
    body.push('');
  }
  const trailers = ranges
    .filter(({ video }) => video.videoId)
    .map(({ video, versions }) =>
      versions.length > 0 ? `BaoCut-Video: ${video.videoId} v${versions[0]!.seq}..v${versions.at(-1)!.seq}` : `BaoCut-Video: ${video.videoId}`,
    );
  return [title, '', ...body, ...trailers, ''].join('\n');
}

function truncate(text: string, limit: number): string {
  const chars = [...text];
  return chars.length <= limit ? text : `${chars.slice(0, limit - 1).join('')}…`;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
