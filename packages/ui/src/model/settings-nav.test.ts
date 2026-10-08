import { describe, expect, it } from 'vitest';
import {
  MODEL_CATEGORIES,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_INFO,
  isSettingsSection,
  legacyAgentSection,
} from './settings-nav.ts';

describe('设置分组', () => {
  it('Agent 自成一组，在偏好设置之后、应用之前，含两个独立条目', () => {
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(['preferences', 'agents', 'app']);
    expect(SETTINGS_GROUPS.find((g) => g.id === 'agents')).toMatchObject({ label: 'Agent', keys: ['agent', 'skills'] });
    expect(SETTINGS_GROUPS.find((g) => g.id === 'app')?.keys).toEqual(['glossary', 'privacy', 'diagnostics', 'about']);
  });

  it('每个分节恰好属于一组，且都有标签', () => {
    expect(SETTINGS_GROUPS.flatMap((g) => g.keys).sort()).toEqual([...SETTINGS_SECTIONS].sort());
    expect(SETTINGS_SECTION_INFO.map((s) => s.key)).toEqual([...SETTINGS_SECTIONS]);
    const label = (key: string) => SETTINGS_SECTION_INFO.find((s) => s.key === key)?.label;
    expect(label('agent')).toBe('Agent 提供方');
    expect(label('skills')).toBe('Skills');
    expect(label('privacy')).toBe('隐私与权限');
  });

  it('组 id 与条目 key 不重名（S2 SideNav 共用一个 id 空间，撞名会抛 RangeError）', () => {
    const ids = [...SETTINGS_GROUPS.map((g) => g.id), 'models', ...SETTINGS_SECTIONS, ...MODEL_CATEGORIES];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skills 是独立分节', () => {
    expect(isSettingsSection('skills')).toBe(true);
  });
});

describe('旧的 Agent 页签去向', () => {
  it('skills、permissions 各去新位置，其余留在 Agent 提供方', () => {
    expect(legacyAgentSection('skills')).toBe('skills');
    expect(legacyAgentSection('permissions')).toBe('privacy');
    expect(legacyAgentSection('advanced')).toBe('agent');
    expect(legacyAgentSection('connect')).toBe('agent');
    expect(legacyAgentSection(undefined)).toBe('agent');
  });
});
