import { describe, expect, it } from 'vitest';
import type { Project, ProjectGitStatus } from '@baocut/protocol';
import { formatGitStatus, resolveProject } from './projects-output.ts';

const projects = [
  { id: 'prj_a', name: 'Show', path: '/work/show' },
  { id: 'prj_b', name: 'Season', path: '/work/show/season 1' },
  { id: 'prj_c', name: 'Dup', path: '/work/dup1' },
  { id: 'prj_d', name: 'Dup', path: '/work/dup2' },
] as Project[];

describe('baocut projects git-* 的项目参数', () => {
  it('不给时用包含工作目录的最深的项目', () => {
    expect(resolveProject(projects, undefined, '/work/show/season 1/ep1', 'linux').id).toBe('prj_b');
    expect(resolveProject(projects, undefined, '/work/show', 'linux').id).toBe('prj_a');
    expect(() => resolveProject(projects, undefined, '/work/showcase', 'linux')).toThrow('/work/showcase');
  });

  it('按 ID、目录、名字找；重名时要 ID', () => {
    expect(resolveProject(projects, 'prj_c', '/', 'linux').id).toBe('prj_c');
    expect(resolveProject(projects, 'show', '/work', 'linux').id).toBe('prj_a');
    expect(resolveProject(projects, '/WORK/SHOW', '/', 'darwin').id).toBe('prj_a');
    expect(resolveProject(projects, 'Season', '/', 'linux').id).toBe('prj_b');
    expect(() => resolveProject(projects, 'Dup', '/', 'linux')).toThrow('ID');
    expect(() => resolveProject(projects, 'nope', '/', 'linux')).toThrow('nope');
  });
});

describe('git-status 的输出', () => {
  it('暂停在本地过滤器时列出条目与下一步', () => {
    const status: ProjectGitStatus = {
      projectId: 'prj_a',
      state: 'paused',
      gitVersion: '2.45.0',
      repoRoot: '/work/show',
      branch: 'main',
      pause: {
        reason: 'local-config',
        localConfig: { digest: 'sha256:x', changed: false, entries: [{ key: 'filter.crypt.clean', value: 'crypt', file: '/work/show/.git/config' }] },
      },
      autoCommit: false,
      lastCommit: null,
      lastError: null,
      reason: 'Paused',
      remedy: 'Review them',
    };
    const lines = formatGitStatus({ id: 'prj_a', name: 'Show' }, status);
    expect(lines[0]).toContain('prj_a');
    expect(lines).toContain('  filter.crypt.clean = crypt  （/work/show/.git/config）');
    expect(lines.at(-1)).toContain('baocut projects git-allow');
  });
});
