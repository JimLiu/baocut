import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import { BRAND_COPY } from './brand-copy.ts';
import { DUB_GROUP_COPY } from './dub-group-copy.ts';
import { EDITOR_COPY } from './editor-copy.ts';
import { ELEMENTS_COPY } from './elements-copy.ts';
import { FONT_COPY } from './font-copy.ts';
import { INSPECTOR_COPY } from './inspector-copy.ts';
import { MEDIA_COPY } from './media-copy.ts';
import { QUICK_CHAT_COPY } from './quick-chat-copy.ts';
import { SUBTITLE_COPY } from './subtitle-copy.ts';
import { TRANSCRIPT_TOOLS_COPY } from './transcript-copy.ts';
import { VIDEO_BAR_COPY } from './video-bar-copy.ts';

const CJK = /[　-〿㐀-鿿＀-￯]/;

/** 目录里所有不带参数的字符串（含嵌套对象），函数条目跳过。 */
function strings(catalog: object): string[] {
  const out: string[] = [];
  for (const key of Object.keys(catalog)) {
    const value: unknown = (catalog as Record<string, unknown>)[key];
    if (typeof value === 'string') out.push(value);
    else if (value && typeof value === 'object') out.push(...strings(value));
  }
  return out;
}

const CATALOGS = { BRAND_COPY, DUB_GROUP_COPY, EDITOR_COPY, ELEMENTS_COPY, FONT_COPY, INSPECTOR_COPY, MEDIA_COPY, QUICK_CHAT_COPY, VIDEO_BAR_COPY };

describe('editor copy in English', () => {
  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('has no Chinese left in the English catalogs', () => {
    for (const [name, catalog] of Object.entries(CATALOGS)) {
      expect(strings(catalog).length, name).toBeGreaterThan(0);
      const leaked = strings(catalog).filter((s) => CJK.test(s));
      expect(leaked, name).toEqual([]);
    }
  });

  it('reads whole sentences instead of gluing fragments', () => {
    expect(VIDEO_BAR_COPY.revealVideoFolder).toBe('Show Video Folder');
    expect(VIDEO_BAR_COPY.historyMeta('12', VIDEO_BAR_COPY.actorAgent, '2 min ago')).toBe('Version 12 · Agent · 2 min ago');
    expect(MEDIA_COPY.replaceKind('audio')).toBe('Replace audio');
    expect(MEDIA_COPY.existing('image')).toBe('Existing images');
    expect(MEDIA_COPY.usesCount(1)).toBe('Used in 1 place on the timeline');
    expect(DUB_GROUP_COPY.regen(3)).toBe('Regenerate 3 sentences…');
    expect(EDITOR_COPY.playTip.pause).toBe('Pause · Space');
    expect(EDITOR_COPY.withNote('Volume', 'muted')).toBe('Volume (muted)');
    expect(TRANSCRIPT_TOOLS_COPY.regexError('bad')).toBe('Regex error: bad');
    expect(SUBTITLE_COPY.trackName).toBe('Subtitles');
  });

  it('switches back to the original Chinese wording', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'zh-Hans');
    setLocale('zh-Hans');
    expect(VIDEO_BAR_COPY.revealVideoFolder).toBe(`${revealLabel()}视频目录`);
    expect(MEDIA_COPY.replaceKind('audio')).toBe('替换音频');
    expect(EDITOR_COPY.withNote('音量', '静音')).toBe('音量（静音）');
  });
});
