import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { M } from '../../model/space-copy.ts';
import { SPACE_COPY } from './space-copy.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('Space 页文案', () => {
  it('英文界面读英文', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(SPACE_COPY.trash).toBe('Move to Trash');
    expect(SPACE_COPY.reveal).toBe('Show in Folder');
    expect(SPACE_COPY.capability.synthesizeSpeech).toBe('Voice-over');
    expect(SPACE_COPY.hitsCount(1)).toBe('1 match');
    expect(SPACE_COPY.hitsGrouped(3, 2)).toBe('3 matches · 2 videos');
    expect(SPACE_COPY.failed(SPACE_COPY.rebuild, 'disk full')).toBe('Rebuild index failed: disk full');
    expect(SPACE_COPY.issuesTitle(1)).toBe("1 folder wasn't fully listed");
    expect(SPACE_COPY.activityAt('2 days ago', '10/4/2026')).toBe('2 days ago (10/4/2026)');
    expect(SPACE_COPY.filesButton(1)).toBe('1 file');
    expect(SPACE_COPY.filesLine(3, 'Export 2 · Subtitles 1')).toBe('3 files · Export 2 · Subtitles 1');
    expect(M.foundFiles('a.srt', 3)).toBe('Found: a.srt and 2 more');
    expect(M.filesStatus(2, 'Missing')).toBe('2 files: Missing');
  });

  it('简体中文译文照旧', () => {
    expect(SPACE_COPY.trash).toBe('移入回收站');
    expect(SPACE_COPY.hitsGrouped(3, 2)).toBe('3 条 · 2 个视频');
    expect(SPACE_COPY.failed(SPACE_COPY.rebuild, '磁盘满了')).toBe('没能重建索引：磁盘满了');
    expect(SPACE_COPY.withReason('文件被移走了', SPACE_COPY.missingBody)).toBe('文件被移走了。条目还在，接回文件后状态会自己恢复。');
    expect(SPACE_COPY.filesButtonLabel(2, '成片 1 · 字幕 1')).toBe('2 个文件：成片 1 · 字幕 1');
    expect(M.fileStatus('成片', '来源已变')).toBe('成片来源已变');
  });
});
