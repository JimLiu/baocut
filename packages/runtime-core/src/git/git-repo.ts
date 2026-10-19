import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectGitRepoState } from '@baocut/protocol';
import { gitErrorDetail, line, type GitRunner } from './git-command.ts';

/**
 * 项目所在的仓库（版本记录设计 §5.2、§5.3）：找仓库、读特殊状态、写 `info/exclude` 与 `info/attributes` 里 BaoCut 的块。
 * 这里只运行不读工作区文件内容的命令（`rev-parse`、`symbolic-ref`），本地过滤器暂停期间也能用（§5.4）。
 */

export interface GitRepo {
  /** 仓库的根目录（工作区顶层）。 */
  root: string;
  /** 这个工作区的 git 目录（worktree 时是 `.git/worktrees/<名字>`）。 */
  gitDir: string;
  /** 共用的 git 目录（本地配置、`info/` 在这里）。 */
  commonDir: string;
  /** 查找时的目录相对仓库根目录的前缀（`/` 分隔、以 `/` 结尾；就是根目录时为空串）。 */
  prefix: string;
}

export type RepoLookup = { kind: 'repo'; repo: GitRepo } | { kind: 'not-repo' } | { kind: 'error'; detail: string };

/** 项目目录所在的仓库。`dir` 不在仓库里时 `not-repo`；git 拒绝（例如仓库属于别的用户）时 `error`。 */
export async function findRepo(runner: GitRunner, dir: string): Promise<RepoLookup> {
  const result = await runner.run(dir, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--show-prefix'], { query: true });
  if (result.exitCode !== 0) {
    if (/not a git repository/i.test(result.stderr)) return { kind: 'not-repo' };
    return { kind: 'error', detail: gitErrorDetail(result) };
  }
  const [root, gitDir, commonDir, prefix] = result.stdout.toString('utf8').split(/\r?\n/);
  // 在 git 目录里面（裸仓库）时没有工作区顶层：不是可以提交的项目。
  if (!root || !gitDir || !commonDir) return { kind: 'not-repo' };
  return {
    kind: 'repo',
    repo: { root: path.resolve(root), gitDir: path.resolve(gitDir), commonDir: path.resolve(dir, commonDir), prefix: prefix ?? '' },
  };
}

/** `git rev-parse --git-path`：worktree 与子模块里 `info/`、锁文件、状态文件的真实位置。结果相对 `cwd`，这里换成绝对路径。 */
export async function gitPaths(runner: GitRunner, cwd: string, names: readonly string[]): Promise<string[]> {
  const result = await runner.run(cwd, ['rev-parse', ...names.flatMap((name) => ['--git-path', name])], { query: true });
  if (result.exitCode !== 0) throw new Error(`git rev-parse --git-path failed: ${gitErrorDetail(result)}`);
  const paths = result.stdout.toString('utf8').split(/\r?\n/).slice(0, names.length);
  return paths.map((item) => path.resolve(cwd, item));
}

/** 状态文件 → 特殊状态（按 git 自己的判断顺序：变基中的拣选算变基）。 */
const STATE_FILES: ReadonlyArray<readonly [string, ProjectGitRepoState]> = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_LOG', 'bisect'],
];

/** 仓库的特殊状态（§5.3）：合并、变基、拣选、还原、二分中，或 HEAD 分离。没有时 null。 */
export async function repoState(runner: GitRunner, cwd: string): Promise<{ state: ProjectGitRepoState | null; branch: string | null }> {
  const files = await gitPaths(
    runner,
    cwd,
    STATE_FILES.map(([name]) => name),
  );
  for (const [index, file] of files.entries()) {
    if (await exists(file)) return { state: STATE_FILES[index]![1], branch: await currentBranch(runner, cwd) };
  }
  const branch = await currentBranch(runner, cwd);
  return { state: branch === null ? 'detached' : null, branch };
}

/** 当前分支（还没有提交的新分支也算）；HEAD 分离时 null。 */
export async function currentBranch(runner: GitRunner, cwd: string): Promise<string | null> {
  const result = await runner.run(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'], { query: true });
  return result.exitCode === 0 ? line(result.stdout) || null : null;
}

// ---- info/exclude 与 info/attributes 的块 ----

export const BLOCK_START = '# >>> BaoCut';
export const BLOCK_END = '# <<< BaoCut';

/** `info/exclude` 块（§5.2）：机器本地的状态与能重新生成的产物。 */
export const EXCLUDE_BLOCK = [
  '# BaoCut: machine-local state and rebuildable output',
  '.bcut/',
  '.bcut-trash/',
  '**/video.db',
  '**/video.db-*',
  '**/video.lock',
  '**/movie.db',
  '**/movie.lock',
  '**/blobs/.staging/',
  '**/.bcut-snapshot/history/',
  '**/tabs/*.history.json',
  '**/tabs/*.versions.json',
  '.baocut-out/',
  '**/.baocut-out/',
  '**/.baocut-export-*/',
  '.baocut-import-*/',
  '**/.*.partial',
  '**/exports/',
] as const;

/** `info/attributes` 块（§5.2）：快照固定 LF、冲突时不逐行拼接、代码托管网站折叠 diff。 */
export const ATTRIBUTES_BLOCK = ['**/.bcut-snapshot/** text eol=lf merge=binary linguist-generated=true'] as const;

/**
 * 换上（或追加）BaoCut 的块，块外的内容一字不动。文件用 CRLF 时块也用 CRLF。有不止一个块时只换第一个（之后的原样留着，
 * 不猜它们是谁写的）。
 */
export function withBlock(text: string, body: readonly string[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = [BLOCK_START, ...body, BLOCK_END].join(eol);
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((item) => item.trim() === BLOCK_START);
  const end = start < 0 ? -1 : lines.findIndex((item, index) => index > start && item.trim() === BLOCK_END);
  if (start >= 0 && end > start) {
    // 按原文的位置切，保留块前后原来的换行。
    const offsets = lineOffsets(text);
    const before = text.slice(0, offsets[start]);
    const afterStart = offsets[end]! + lines[end]!.length;
    return before + block + text.slice(afterStart);
  }
  if (!text) return `${block}${eol}`;
  const separator = text.endsWith('\n') ? '' : eol;
  return `${text}${separator}${block}${eol}`;
}

function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') offsets.push(index + 1);
  return offsets;
}

/** 把块写进一个文件：内容不变时不写；写时先写同目录的临时文件再改名。 */
export async function writeBlock(file: string, body: readonly string[]): Promise<boolean> {
  let text = '';
  let mode: number | undefined;
  try {
    text = await fs.readFile(file, 'utf8');
    mode = (await fs.stat(file)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const next = withBlock(text, body);
  if (next === text) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, next, mode === undefined ? undefined : { mode });
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  return true;
}

/**
 * 项目在仓库里时写两个块（§5.2）。有 git 时按 `--git-path` 找位置（worktree、子模块）；没有 git 时从项目目录向上找 `.git`：
 * 是目录就写它的 `info/`，是文件（worktree、子模块）就跳过。返回写到的仓库根目录；不在仓库里时 null。
 */
export async function ensureInfoBlocks(runner: GitRunner | null, dir: string): Promise<string | null> {
  let exclude: string;
  let attributes: string;
  let root: string;
  if (runner) {
    const found = await findRepo(runner, dir);
    if (found.kind !== 'repo') return null;
    [exclude, attributes] = (await gitPaths(runner, dir, ['info/exclude', 'info/attributes'])) as [string, string];
    root = found.repo.root;
  } else {
    const dotGit = await findDotGit(dir);
    if (!dotGit) return null;
    exclude = path.join(dotGit, 'info', 'exclude');
    attributes = path.join(dotGit, 'info', 'attributes');
    root = path.dirname(dotGit);
  }
  await writeBlock(exclude, EXCLUDE_BLOCK);
  await writeBlock(attributes, ATTRIBUTES_BLOCK);
  return root;
}

/** 从 `dir` 向上找 `.git` 目录；先遇到 `.git` 文件（worktree、子模块）时 null。 */
async function findDotGit(dir: string): Promise<string | null> {
  let current = path.resolve(dir);
  for (;;) {
    const candidate = path.join(current, '.git');
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat) return stat.isDirectory() ? candidate : null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function exists(file: string): Promise<boolean> {
  return await fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}
