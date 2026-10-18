import { LOCALES, setLocale, type Locale } from '@baocut/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baocutStep } from './agent-tool-steps.ts';

/** 会话线程的步骤行（产品设计 §3.2.2）：BaoCut 自己的工具念这一类的名字加一句摘要。 */

const call = (tool: string, args: Record<string, unknown>) => ({
  tool: 'mcp' as const,
  title: `baocut.${tool}`,
  detail: JSON.stringify(args),
});

/** 界面语言：测试环境的 `BAOCUT_LOCALE` 优先，跟着一起换。 */
const use = (locale: Locale) => {
  vi.stubEnv('BAOCUT_LOCALE', locale);
  setLocale(locale);
};

describe('baocutStep', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('智能体给会话起标题（产品设计 §3.1）：念「重命名会话」加新标题', () => {
    use('zh-Hans');
    expect(baocutStep(call('conversations_set_title', { title: ' 城市骑行通勤的五个误区 ' }))).toEqual({
      kind: 'conversation',
      label: '重命名会话',
      summary: '城市骑行通勤的五个误区',
    });
    use('en');
    expect(baocutStep(call('conversations_set_title', { title: 'Five myths about bike commuting' }))).toEqual({
      kind: 'conversation',
      label: 'Rename session',
      summary: 'Five myths about bike commuting',
    });
  });

  it('每种界面语言都有自己的译名；参数缺了只给类别名', () => {
    for (const locale of LOCALES) {
      use(locale);
      const step = baocutStep(call('conversations_set_title', {}));
      expect(step?.summary, locale).toBe('');
      if (locale === 'en') expect(step?.label).toBe('Rename session');
      else expect(step?.label, locale).not.toBe('Rename session');
      const adopt = baocutStep(call('projects_adopt_session', {}))?.label;
      if (locale === 'en') expect(adopt).toBe('Move to new project');
      else expect(adopt, locale).not.toBe('Move to new project');
    }
  });

  it('项目工具：新建念项目名，没给时念目录名；放进新项目念用户给的名字', () => {
    use('zh-Hans');
    expect(baocutStep(call('projects_list', {}))).toEqual({ kind: 'project', label: '列出项目', summary: '' });
    expect(baocutStep(call('projects_create', { path: '/Users/me/Videos/episode-12', name: '第 12 期' }))?.summary).toBe('第 12 期');
    expect(baocutStep(call('projects_create', { path: '/Users/me/Videos/episode-12/' }))).toEqual({
      kind: 'project',
      label: '新建项目',
      summary: 'episode-12',
    });
    expect(baocutStep(call('projects_adopt_session', { name: '第 12 期' }))).toEqual({
      kind: 'project',
      label: '放进新项目',
      summary: '第 12 期',
    });
    expect(baocutStep(call('projects_adopt_session', {}))?.summary).toBe('');
    expect(baocutStep(call('projects_adopt_session', { project: '/Volumes/T7/访谈' }))?.summary).toBe('访谈');
    expect(baocutStep(call('projects_adopt_session', { project: 'prj_1' }))?.summary).toBe('');
    use('en');
    expect(['projects_list', 'projects_create', 'projects_adopt_session'].map((t) => baocutStep(call(t, {}))?.label)).toEqual([
      'List projects',
      'New project',
      'Move to new project',
    ]);
  });

  it('不是 BaoCut 的工具、认不出的工具返回 null', () => {
    expect(baocutStep({ tool: 'mcp', title: 'other.conversations_set_title', detail: null })).toBeNull();
    expect(baocutStep(call('conversations_unknown', {}))).toBeNull();
  });
});
