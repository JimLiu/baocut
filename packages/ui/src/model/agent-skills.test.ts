import { describe, expect, it } from 'vitest';
import { RpcError, type SkillSummary } from '@baocut/protocol';
import {
  clipLine,
  countSkills,
  filterSkills,
  fileSizeLabel,
  sendFailureMessage,
  skillBody,
  skillErrorCode,
  skillErrorMessage,
  skillMenuItems,
  skillMetaLine,
  skillSourceLine,
  sortSkills,
} from './agent-skills.ts';

function skill(id: string, patch: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id,
    name: id,
    description: `${id} 的说明`,
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

const list = [
  skill('subtitle-style', { name: 'Subtitle Style', description: 'Line breaks and punctuation for captions' }),
  skill('chapters', { name: '分章方法', description: '按话题切分章节', origin: 'third-party', enabled: false }),
  skill('brand', { name: '品牌规范', origin: 'builtin', removable: false }),
];

describe('列表的排序、搜索与筛选', () => {
  it('按来源（内置、我的、第三方）再按名称排，不依赖 Runtime 给的顺序', () => {
    expect(sortSkills([...list].reverse()).map((s) => s.id)).toEqual(['brand', 'subtitle-style', 'chapters']);
  });

  it('搜名称、描述与 id，不分大小写；不假定语言', () => {
    expect(filterSkills(list, 'subtitle', 'all').map((s) => s.id)).toEqual(['subtitle-style']);
    expect(filterSkills(list, 'PUNCTUATION', 'all').map((s) => s.id)).toEqual(['subtitle-style']);
    expect(filterSkills(list, '章节', 'all').map((s) => s.id)).toEqual(['chapters']);
    expect(filterSkills(list, '  ', 'all')).toHaveLength(3);
  });

  it('按来源筛选，和搜索叠加；计数跟着搜索词走', () => {
    expect(filterSkills(list, '', 'third-party').map((s) => s.id)).toEqual(['chapters']);
    expect(filterSkills(list, 'subtitle', 'builtin')).toEqual([]);
    expect(countSkills(list, '')).toEqual({ all: 3, builtin: 1, personal: 1, 'third-party': 1 });
    expect(countSkills(list, '品牌')).toEqual({ all: 1, builtin: 1, personal: 0, 'third-party': 0 });
  });
});

describe('输入框「+ › 使用 Skill」的条目', () => {
  it('开着的在前、组内保持原顺序；关着的也列出来（点选不看开关）', () => {
    const items = skillMenuItems([skill('a', { enabled: false }), skill('b'), skill('c', { enabled: false }), skill('d')]);
    expect(items.map((i) => i.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(items.map((i) => i.enabled)).toEqual([true, true, false, false]);
  });

  it('描述折成一行，过长截断加省略号，不切坏增补字符', () => {
    expect(clipLine('第一行\n\n第二行   第三段')).toBe('第一行 第二行 第三段');
    expect(clipLine('一二三四五六', 4)).toBe('一二三…');
    expect(clipLine('😀😀😀😀😀', 3)).toBe('😀😀…');
    const [item] = skillMenuItems([skill('long', { description: 'x'.repeat(200) })]);
    expect([...item!.description]).toHaveLength(60);
  });
});

describe('卡片与详情的文字', () => {
  it('来源 · 版本', () => {
    expect(skillMetaLine({ origin: 'builtin', version: '1.2.0' })).toBe('内置 · v1.2.0');
    expect(skillMetaLine({ origin: 'third-party', version: null })).toBe('第三方');
  });

  it('来源：本地路径，或 GitHub 地址@ref（提交取前 7 位）', () => {
    expect(skillSourceLine(null)).toBeNull();
    expect(skillSourceLine({ kind: 'local', path: '/Users/me/skills/x', addedAt: '2026-10-01T00:00:00Z' })).toBe('/Users/me/skills/x');
    expect(
      skillSourceLine({
        kind: 'github',
        url: 'https://github.com/o/r/tree/main/skills/x',
        owner: 'o',
        repo: 'r',
        ref: 'main',
        commit: '0123456789abcdef',
        path: 'skills/x',
        importedAt: '2026-10-01T00:00:00Z',
      }),
    ).toBe('https://github.com/o/r/tree/main/skills/x@main（0123456）');
  });

  it('SKILL.md 去掉开头的 front matter，没有时原样', () => {
    expect(skillBody('---\nname: x\ndescription: y\n---\n\n# 标题\n正文')).toBe('# 标题\n正文');
    expect(skillBody('﻿---\r\nname: x\r\n---\r\n正文')).toBe('正文');
    expect(skillBody('# 没有 front matter')).toBe('# 没有 front matter');
  });

  it('文件大小', () => {
    expect(fileSizeLabel(512)).toBe('512 字节');
    expect(fileSizeLabel(2048)).toBe('2.0 KB');
    expect(fileSizeLabel(300 * 1024)).toBe('300 KB');
    expect(fileSizeLabel(8 * 1024 * 1024)).toBe('8.0 MB');
  });
});

describe('错误码换成人话', () => {
  const err = (code: string, details: Record<string, unknown> = {}) => new RpcError('conflict', 'Runtime 的原话', { code, ...details });

  it('读 details.code；不是 RpcError 或没有细分码时为 null', () => {
    expect(skillErrorCode(err('SKILL_EXISTS'))).toBe('SKILL_EXISTS');
    expect(skillErrorCode(new RpcError('internal', 'x'))).toBeNull();
    expect(skillErrorCode(new Error('x'))).toBeNull();
  });

  it('已存在、格式不对、超限、地址不对、离线、限流、网络都有各自的说法', () => {
    expect(skillErrorMessage(err('SKILL_EXISTS', { skillId: 'subtitle-style' }), 'add')).toContain('「subtitle-style」');
    expect(skillErrorMessage(err('SKILL_EXISTS'), 'import')).toContain('先移除旧的');
    expect(skillErrorMessage(err('SKILL_INVALID', { issues: ['根目录缺少 SKILL.md'] }), 'add')).toContain('根目录缺少 SKILL.md');
    expect(skillErrorMessage(err('SKILL_TOO_LARGE'), 'import')).toContain('200 个文件');
    expect(skillErrorMessage(err('SKILL_GITHUB_URL_INVALID'), 'import')).toContain('owner/repo');
    expect(skillErrorMessage(err('OFFLINE_STRICT'), 'import')).toContain('严格离线');
    expect(skillErrorMessage(err('SKILL_GITHUB_RATE_LIMITED'), 'import')).toContain('访问次数');
    expect(skillErrorMessage(err('SKILL_GITHUB_NETWORK'), 'import')).toContain('连不上 GitHub');
    expect(skillErrorMessage(err('WEB_METHOD_NOT_ALLOWED'), 'remove')).toContain('桌面应用');
  });

  it('同一个「来源不存在」按动作说：导入说 GitHub 上没有，添加说文件夹不在了', () => {
    expect(skillErrorMessage(err('SKILL_SOURCE_NOT_FOUND'), 'import')).toContain('GitHub');
    expect(skillErrorMessage(err('SKILL_SOURCE_NOT_FOUND'), 'add')).toContain('文件夹');
  });

  it('认不出的退回 Runtime 的原话', () => {
    expect(skillErrorMessage(new Error('磁盘满了'), 'add')).toBe('没能添加：磁盘满了');
  });

  it('发送失败：skill 的错误说 skill 的原因，其余照旧', () => {
    expect(sendFailureMessage(new RpcError('not-found', 'x', { code: 'SKILL_NOT_FOUND' }))).toContain('已经不在了');
    expect(sendFailureMessage(new Error('断线'))).toBe('没能发送：断线');
  });
});
