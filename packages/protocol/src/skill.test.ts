import { describe, expect, it } from 'vitest';
import { methodParamSchemas } from './schemas.ts';
import { messageSkills, SKILL_LIMITS, sendSkillRefs } from './skill.ts';

describe('conversations.send 点选的 skill', () => {
  const send = methodParamSchemas['conversations.send'];
  const base = { conversationId: 'c', text: 'hi', commandId: 'k' };

  it('收单个的 skill 与有序的 skills 清单', () => {
    expect(send.safeParse({ ...base, skill: { id: 'caption-layout' } }).success).toBe(true);
    expect(send.safeParse({ ...base, skills: [{ id: 'caption-layout' }, { id: 'b-roll' }] }).success).toBe(true);
    expect(send.safeParse({ ...base, skill: { id: 'a' }, skills: [{ id: 'b' }] }).success).toBe(true);
    expect(send.safeParse({ ...base, skills: [] }).success).toBe(true);
  });

  it('拒绝不合规的 id、多余字段与超过上限的清单', () => {
    expect(send.safeParse({ ...base, skills: [{ id: 'Caption Layout' }] }).success).toBe(false);
    expect(send.safeParse({ ...base, skills: [{ id: 'a', name: 'x' }] }).success).toBe(false);
    expect(send.safeParse({ ...base, skills: { id: 'a' } }).success).toBe(false);
    const many = Array.from({ length: SKILL_LIMITS.perMessage + 1 }, (_, i) => ({ id: `s${i}` }));
    expect(send.safeParse({ ...base, skills: many }).success).toBe(false);
    expect(send.safeParse({ ...base, skills: many.slice(1) }).success).toBe(true);
  });

  it('合成清单：单个的在前，按顺序，重复的只留第一次', () => {
    expect(sendSkillRefs({})).toEqual([]);
    expect(sendSkillRefs({ skill: { id: 'a' } })).toEqual([{ id: 'a' }]);
    expect(sendSkillRefs({ skills: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] })).toEqual([{ id: 'b' }, { id: 'a' }]);
    expect(sendSkillRefs({ skill: { id: 'a' }, skills: [{ id: 'b' }, { id: 'a' }] })).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('消息上的标记兼容只写了单个 skill 的旧记录', () => {
    const ref = (id: string) => ({ id, name: id, origin: 'builtin' as const });
    expect(messageSkills({})).toEqual([]);
    expect(messageSkills({ skill: ref('a') })).toEqual([ref('a')]);
    expect(messageSkills({ skills: [ref('a'), ref('b')] })).toEqual([ref('a'), ref('b')]);
  });
});
