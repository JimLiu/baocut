import { setLocale } from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_LABEL } from './stage-toolbar.ts';
import { TOOL_GROUPS, toolById } from './tool-catalog.ts';
import { rerunOf } from './tool-rerun.ts';
import { SPACE_INPUT_COPY } from './tool-space-input.ts';
import { grantLoopText } from './tool-runs.ts';
import { UPDATE_METHOD_LABEL, updateSectionCopy, updateSummary } from './tool-update.ts';
import { langName, localNotDownloaded, languagesShort } from './tools-models.ts';
import { QUALITIES } from './tools-transcode.ts';
import { emptyText, textStats, VIBES } from './tools-tts.ts';
import { tooLong } from './tools-text.ts';
import { voiceConsentStatement } from './voices-library.ts';

/** 界面模型层（link-import 之后的模块）在英文下的文案：切换语言后，常量导出与函数都读到英文。 */
describe('model copy in English', () => {
  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('constant tables read the current language', () => {
    expect(TOOL_LABEL.color).toBe('Color');
    expect(toolById('transcribe')?.name).toBe('Transcribe');
    expect(TOOL_GROUPS.every((g) => !/[一-鿿]/.test(g.label))).toBe(true);
    expect(QUALITIES[0]?.name).toBe('Smaller');
    expect(SPACE_INPUT_COPY.trashed).toBe('In the Trash');
    expect(UPDATE_METHOD_LABEL.standalone).toBe('Official standalone binary');
    expect(VIBES[0].name).toBe('Late-night radio');
    expect(rerunOf({ kind: 'generateText', pipeline: null, submitter: { kind: 'connection' }, videoId: null, state: 'failed' } as never)?.label).toBe('Try again');
  });

  it('sentences with values are written in English', () => {
    expect(textStats('', 4096)).toBe('0 / 4096 characters');
    expect(tooLong()).toBe('Up to 16,000 characters at a time');
    expect(languagesShort(['en', 'fr', 'de', 'ja'])).toMatch(/ and 2 more$/);
    expect(langName('en')).toBe('English');
    expect(languagesShort(['zh', 'en'])).toBe('Chinese, English');
    expect(updateSectionCopy({ method: 'homebrew', runnable: true, reason: null } as never).label).toBe('Update with Homebrew');
    expect(updateSummary({ state: 'completed', exitCode: 0, before: '1', after: '1', error: null } as never).title).toMatch(/^Already up to date/);
    expect(emptyText()).toBe('Write the text to read first');
    expect(localNotDownloaded()).toBe('Not downloaded');
    expect(voiceConsentStatement()).toMatch(/^This is my own voice/);
    expect(grantLoopText()).not.toMatch(/[一-鿿]/);
  });

  it('switching back restores Chinese', () => {
    vi.unstubAllEnvs();
    vi.stubEnv('BAOCUT_LOCALE', 'zh-Hans');
    setLocale('zh-Hans');
    expect(TOOL_LABEL.color).toBe('颜色');
    expect(emptyText()).toBe('先写要念的文字');
    expect(langName('en')).toBe('英语');
    expect(rerunOf({ kind: 'generateText', pipeline: null, submitter: { kind: 'connection' }, videoId: null, state: 'failed' } as never)?.label).toBe('重试');
  });
});
