import { describe, expect, it } from 'vitest';
import { RpcError, refOf, type ProjectGitStatus } from '@baocut/protocol';
import { RcGit } from '@baocut/protocol/messages/runtime-core';
import { canCommit, canRecheck, commitText, gitError, gitLight, inRepo, lastCommitText, localConfigOf, pauseLabel, refusalText, statusRemedy, statusText } from './project-git.ts';

const base: ProjectGitStatus = {
  projectId: 'p1',
  state: 'ready',
  gitVersion: '2.47.1',
  repoRoot: '/Users/me/BaoCut/Demo',
  branch: 'main',
  autoCommit: false,
  lastCommit: null,
  lastError: null,
};
const said = (reason: ReturnType<typeof RcGit.pausedLocked>, remedy?: ReturnType<typeof RcGit.lockedRemedy>) => ({
  reason: reason.text,
  reasonRef: refOf(reason),
  ...(remedy ? { remedy: remedy.text, remedyRef: refOf(remedy) } : {}),
});

describe('project git', () => {
  it('names the state and the pause reason', () => {
    expect(gitLight(base)).toEqual({ tone: 'positive', label: '正常' });
    const rebase: ProjectGitStatus = { ...base, state: 'paused', pause: { reason: 'repo-state', repoState: 'rebase' } };
    expect(gitLight(rebase)).toEqual({ tone: 'notice', label: '已暂停 · 正在变基' });
    expect(pauseLabel({ reason: 'locked' })).toBe('仓库正被占用');
    expect(pauseLabel({ reason: 'repo-state', repoState: 'detached' })).toBe('HEAD 分离');
    expect(pauseLabel({ reason: 'local-config', localConfig: { digest: 'd', changed: true } })).toBe('本地过滤器变了');
    expect(gitLight({ ...base, state: 'not-repo' }).tone).toBe('neutral');
    expect(gitLight({ ...base, state: 'error' })).toEqual({ tone: 'negative', label: 'git 运行失败' });
  });

  it('decides what can be done in each state', () => {
    const locked: ProjectGitStatus = { ...base, state: 'paused', pause: { reason: 'locked' } };
    const local: ProjectGitStatus = { ...base, state: 'paused', pause: { reason: 'local-config', localConfig: { digest: 'sha', changed: false } } };
    expect([canCommit(base), canCommit(locked), canCommit({ ...base, state: 'error' })]).toEqual([true, false, false]);
    expect([inRepo(base), inRepo(locked), inRepo({ ...base, state: 'error' }), inRepo({ ...base, state: 'not-repo' })]).toEqual([true, true, true, false]);
    // 本地过滤器要「允许」，不靠重新检查；没有 git 时也不给。
    expect([canRecheck(locked), canRecheck(local), canRecheck({ ...base, state: 'error' }), canRecheck({ ...base, state: 'unavailable' })]).toEqual([true, false, true, false]);
    expect(localConfigOf(local)?.digest).toBe('sha');
    expect(localConfigOf(locked)).toBeNull();
  });

  it('joins the Runtime reason and remedy in the interface language', () => {
    const locked: ProjectGitStatus = { ...base, state: 'paused', pause: { reason: 'locked' }, ...said(RcGit.pausedLocked(), RcGit.lockedRemedy()) };
    // Runtime 写的是英文，引用按界面语言（测试钉在简体中文）重新生成。
    expect(statusText(locked)).toBe(`${RcGit.pausedLocked().toString()}。${RcGit.lockedRemedy().toString()}。`);
    expect(statusText(locked)).toMatch(/^仓库正被另一个 git 命令占用/);
    expect(statusText(locked, false)).toBe('仓库正被另一个 git 命令占用（存在 index.lock）。');
    expect(statusText(base)).toBeNull();
    expect(statusRemedy(locked)).toBe(`${RcGit.lockedRemedy().toString()}。`);
    expect(statusRemedy(base)).toBeNull();
  });

  it('has its own words for where git can’t be initialized', () => {
    expect(refusalText('home')).toMatch(/主目录/);
    expect(refusalText('volume-root')).toMatch(/根目录/);
    expect(refusalText(undefined)).toBeNull();
  });

  it('describes the last commit and a commit result', () => {
    const now = Date.parse('2026-10-18T10:42:00.000Z');
    const record = { commit: '9c2e4a1f00d', at: '2026-10-18T10:00:00.000Z', trigger: 'manual' as const, videos: [] };
    expect(lastCommitText(record, now)).toBe('上次提交 9c2e4a1 · 手动 · 42 分钟前');
    expect(lastCommitText(null, now)).toBeNull();
    const names: Record<string, string> = { v1: '采访' };
    const result = {
      committed: true,
      commit: '3f9c2a1bbbb',
      files: 3,
      videos: [
        { videoId: 'v1', from: 3, to: 5 },
        { videoId: 'v2', from: 2, to: 2 },
        { videoId: 'v3', from: null, to: null },
      ],
    };
    expect(commitText(result, (id) => names[id] ?? null)).toBe('已提交 3f9c2a1：3 个文件，「采访」版本 3–5、「一部视频」版本 2、「一部视频」。');
    expect(commitText({ committed: false, commit: null, files: 0, videos: [] }, () => null)).toBe('BaoCut 的文件和上次提交时一样。');
  });

  it('reads a refusal with its remedy and the new status', () => {
    const status: ProjectGitStatus = { ...base, state: 'paused', pause: { reason: 'locked' } };
    const paused = new RpcError('conflict', RcGit.pausedLocked(), {
      code: 'GIT_PAUSED',
      reason: 'locked',
      remedy: RcGit.lockedRemedy().text,
      remedyRef: refOf(RcGit.lockedRemedy()),
      status,
    });
    const read = gitError(paused);
    expect(read.code).toBe('GIT_PAUSED');
    expect(read.status).toBe(status);
    expect(read.message).toMatch(/^仓库正被另一个 git 命令占用（存在 index\.lock）。等另一个 git 命令结束/);
    expect(gitError(new RpcError('forbidden', RcGit.manageOnlyInAppOrCli()))).toMatchObject({ code: null, status: null });
    expect(gitError(new Error('offline')).message).toBe('offline');
  });
});
