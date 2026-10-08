import { describe, expect, it } from 'vitest';
import type { SkillSummary } from '@baocut/protocol';
import { formatSkillChanged, parseChatSkill, parseSkillId } from './skills-output.ts';

const builtin: SkillSummary = {
  id: 'caption-layout',
  name: 'Caption layout',
  description: '字幕排版规则\n第二行',
  version: '1.0.0',
  origin: 'builtin',
  enabled: true,
  defaultEnabled: true,
  removable: false,
  path: '/app/skills/caption-layout',
  source: null,
  fileCount: 2,
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const imported: SkillSummary = {
  ...builtin,
  id: 'podcast-chapters',
  name: '播客分章',
  description: '给播客分章节',
  version: null,
  origin: 'third-party',
  enabled: false,
  defaultEnabled: false,
  removable: true,
  path: '/home/skills/podcast-chapters',
  source: {
    kind: 'github',
    url: 'https://github.com/o/r',
    owner: 'o',
    repo: 'r',
    ref: 'main',
    commit: 'abcdef0123456789abcdef0123456789abcdef01',
    path: '',
    importedAt: '2026-10-02T00:00:00.000Z',
  },
};

describe('baocut skills 的输出', () => {
  it('回执写明目标目录与来源', () => {
    expect(formatSkillChanged('已导入', imported)).toBe(
      '已导入 podcast-chapters（播客分章，关着）→ /home/skills/podcast-chapters\n来源：https://github.com/o/r（main@abcdef012345，2026-10-02T00:00:00.000Z）',
    );
  });

  it('--skill 与 --id 只查形状，不假定拉丁字母', () => {
    expect(parseChatSkill(undefined)).toBeUndefined();
    expect(parseChatSkill(' caption-layout ')).toEqual({ id: 'caption-layout' });
    expect(parseSkillId('字幕-排版', '--id')).toBe('字幕-排版');
    for (const bad of ['', 'Caption', 'a_b', '../x', '-a']) expect(() => parseChatSkill(bad), bad).toThrow(/--skill/);
  });
});
