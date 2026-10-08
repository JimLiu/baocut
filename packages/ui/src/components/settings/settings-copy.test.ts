import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { CARD_COPY } from './agent-card-copy.ts';
import { AGENT_COPY, CODEX_IMAGE_COPY, SKILL_DETAIL_COPY } from './agent-copy.ts';
import { M as SETUP } from './agent-setup-copy.ts';
import { EFFORT_LABEL, moreSummary, TIER_COPY } from './agent-setup.ts';
import { codexImageRow, codexImageToast } from './codex-image.ts';
import { GRANTS_COPY } from './data-grants-copy.ts';
import { FONT_COPY } from './font-settings-copy.ts';
import { M as GENERAL } from './general-settings-copy.ts';
import { GLOSSARY_COPY } from './glossary-copy.ts';
import { RESOURCE_COPY } from './resource-capacity-copy.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

const codex = { id: 'codex', state: 'ready' } as const;
const outdated = (detail?: string) => ({ providerId: 'agent:codex', label: 'Codex', available: false, unavailableReason: 'outdated', detail }) as never;

describe('settings copy', () => {
  it('reads English when the locale is en', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(AGENT_COPY.permissionsTitle).toBeTypeOf('string');
    expect(SKILL_DETAIL_COPY.reveal).toBe('Show in Folder');
    expect(SETUP.badgeReady).toBe('Available');
    expect(TIER_COPY.balanced.label).toBe('Recommended');
    expect(EFFORT_LABEL.medium).toBe('Medium');
    expect(moreSummary([{ name: 'A' }, { name: 'B' }])).not.toMatch(/[一-鿿]/);
    expect(CARD_COPY.runFailed('boom')).toBe("Couldn't run: boom");
    expect(CARD_COPY.modelsOf('Codex', 3)).toBe('Codex models · 3');
    expect(CARD_COPY.version('1.2.0')).toBe('Version · v1.2.0');
    expect(CODEX_IMAGE_COPY.on).toBe('On');
    expect(codexImageToast(false)).toBe('Turned off Draw with Codex');
    expect(codexImageRow(outdated('Needs Codex 0.40'), codex, 'done')?.why).toBe('Needs Codex 0.40.');
    expect(GRANTS_COPY.revokeTitle('OpenAI')).toBe('Revoke “OpenAI”?');
    expect(RESOURCE_COPY.limitOf('Memory', RESOURCE_COPY.unit.cpuThreads)).toBe('Memory limit (threads)');
    expect(FONT_COPY.lead(1900)).toContain('about 1,900 families');
    expect(FONT_COPY.summary(1, '2 MB')).toBe('1 family · 2 MB');
    expect(GENERAL.trashDaysDesc(30)).toContain('default of 30 days');
    expect(GENERAL.lineLengthNote(42, null)).not.toContain('custom');
    expect(GLOSSARY_COPY.list.stats(1, '2 days ago')).toBe('1 entry · Updated 2 days ago');
    expect(GLOSSARY_COPY.terms.problems(['a', 'b'])).toBe('a; b');
  });

  it('keeps the original Simplified Chinese text', () => {
    setLocale('zh-Hans');
    expect(SKILL_DETAIL_COPY.reveal).toBe('在文件夹中显示');
    expect(CARD_COPY.runFailed('boom')).toBe('没能运行：boom');
    expect(CARD_COPY.subInstalled('1.2.0', null)).toBe('本机已安装 · v1.2.0');
    expect(CARD_COPY.versionDesc('2.0', null, '请用当初安装它的那种方式升级。')).toBe(
      '可以升级到 2.0。升级只更新这个命令行工具，不影响你的账号和它自己的设置。请用当初安装它的那种方式升级。',
    );
    expect(CODEX_IMAGE_COPY.toggleFailed(true, 'x')).toBe('没能打开 Codex 画图：x');
    expect(codexImageRow(outdated(), codex, 'done')?.why).toBe('Codex 的版本太旧 · 升级 Codex CLI 之后再打开。');
    expect(RESOURCE_COPY.queued(null, '2 GB')).toBe('排队 · 等待开始 · 需要 2 GB');
    expect(FONT_COPY.facts('400 · 700', '1 MB', 'OFL', '3 天前')).toBe('字重 400 · 700 · 1 MB · OFL · 3 天前下载');
    expect(GENERAL.lineLengthNote(42, '每行 20 字')).toBe(
      '还没接上：自动断行现在固定按每行 42 个半角字符宽（一个中日韩文字算两个）。存着的是自定义值（每行 20 字）。',
    );
    expect(GLOSSARY_COPY.list.foot).toContain('一张 Markdown 表，');
  });
});
