import { afterEach, describe, expect, it } from 'vitest';
import type { SkillListResult, SkillSummary } from '@baocut/protocol';
import { emptySkills, useSkills } from '../state/skills-store.ts';
import type { RuntimeSession } from './session.ts';
import {
  addSkillFromFolder,
  importSkillFromGithub,
  loadSkills,
  removeSkill,
  resetSkillCommands,
  setSkillEnabled,
} from './skill-commands.ts';

function summary(id: string, patch: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id,
    name: id,
    description: '说明',
    version: null,
    origin: 'personal',
    enabled: true,
    defaultEnabled: true,
    removable: true,
    path: `/home/skills/${id}`,
    source: null,
    fileCount: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    ...patch,
  };
}

/** 假的会话：只有 `client.request`，按方法名回答，记下每次调用。 */
function fakeSession(answer: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const session = {
    client: {
      request: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return answer(method, params);
      },
    },
  } as unknown as Pick<RuntimeSession, 'client'>;
  return { session, calls };
}

afterEach(() => {
  resetSkillCommands();
  useSkills.setState(emptySkills());
});

describe('skill 列表', () => {
  it('同时要几次只发一次；取到后排好放进镜像，诊断原样带上', async () => {
    const result: SkillListResult = {
      skills: [summary('zeta', { origin: 'third-party' }), summary('alpha')],
      diagnostics: [{ code: 'invalid', scope: 'user', dir: 'broken', path: '/home/skills/broken', message: '缺 SKILL.md', issues: [] }],
    };
    const { session, calls } = fakeSession(() => result);
    await Promise.all([loadSkills(session), loadSkills(session)]);
    expect(calls).toHaveLength(1);
    const state = useSkills.getState();
    expect(state).toMatchObject({ status: 'ready', loaded: true, error: null });
    expect(state.skills.map((s) => s.id)).toEqual(['alpha', 'zeta']);
    expect(state.diagnostics).toEqual(result.diagnostics);
  });

  it('取失败：取到过的列表留着，只记下错误；下次照常重取', async () => {
    useSkills.getState().succeed({ skills: [summary('a')], diagnostics: [] });
    const { session, calls } = fakeSession(() => {
      throw new Error('断线');
    });
    await loadSkills(session);
    expect(useSkills.getState()).toMatchObject({ status: 'failed', loaded: true, error: '断线' });
    expect(useSkills.getState().skills.map((s) => s.id)).toEqual(['a']);
    await loadSkills(session);
    expect(calls).toHaveLength(2);
  });
});

describe('变更类命令', () => {
  it('开关、添加、导入、移除都把返回的整份列表写回镜像', async () => {
    const after = (skills: SkillSummary[]) => ({ skills, diagnostics: [] });
    const { session, calls } = fakeSession((method, params) => {
      if (method === 'skills.setEnabled') return { skill: summary('a', { enabled: false }), ...after([summary('a', { enabled: false })]) };
      if (method === 'skills.add') return { skill: summary('b'), ...after([summary('a'), summary('b')]) };
      if (method === 'skills.importGithub')
        return { skill: summary('c', { origin: 'third-party', enabled: false }), ...after([summary('c', { origin: 'third-party' })]) };
      if (method === 'skills.remove') return { removed: { id: params.id, path: '/home/skills/c' }, ...after([]) };
      throw new Error(method);
    });

    await setSkillEnabled(session, 'a', false);
    expect(useSkills.getState().skills.map((s) => [s.id, s.enabled])).toEqual([['a', false]]);

    const added = await addSkillFromFolder(session, '/Users/me/my-skill');
    expect(added.skill.id).toBe('b');
    expect(useSkills.getState().skills.map((s) => s.id)).toEqual(['a', 'b']);

    await importSkillFromGithub(session, '  owner/repo  ');
    expect(useSkills.getState().skills.map((s) => s.id)).toEqual(['c']);

    await removeSkill(session, 'c');
    expect(useSkills.getState().skills).toEqual([]);

    expect(calls.map((c) => c.method)).toEqual(['skills.setEnabled', 'skills.add', 'skills.importGithub', 'skills.remove']);
    expect(calls[0]!.params).toEqual({ id: 'a', enabled: false });
    expect(calls[1]!.params).toMatchObject({ path: '/Users/me/my-skill' });
    expect(typeof calls[1]!.params.commandId).toBe('string');
    expect(calls[2]!.params).toMatchObject({ url: 'owner/repo' });
  });

  it('失败时不动镜像，错误交给调用方', async () => {
    useSkills.getState().succeed({ skills: [summary('a')], diagnostics: [] });
    const { session } = fakeSession(() => {
      throw new Error('已存在');
    });
    await expect(addSkillFromFolder(session, '/x')).rejects.toThrow('已存在');
    expect(useSkills.getState().skills.map((s) => s.id)).toEqual(['a']);
  });
});
