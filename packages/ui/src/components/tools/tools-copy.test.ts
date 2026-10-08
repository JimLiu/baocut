import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { FRAME_COPY, GALLERY_COPY, GATE_COPY, IMAGE_COPY, LINK_TOOL_COPY, OUTPUT_COPY, RECORD_COPY, TEXT_COPY, TRANSCODE_COPY } from './tools-copy.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('tools-copy', () => {
  it('reads English when the locale is en', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(GALLERY_COPY.title).toBe('Tools');
    expect(OUTPUT_COPY.reveal).toBe('Show in Folder');
    expect(OUTPUT_COPY.revealFailed('EACCES')).toBe("Couldn't show in folder: EACCES");
    expect(TRANSCODE_COPY.revealFailed('EACCES')).toBe("Couldn't show in folder: EACCES");
    expect(RECORD_COPY.ahead(2)).toBe('Queued · 2 ahead');
    expect(TRANSCODE_COPY.files(1)).toBe('1 file');
    expect(TRANSCODE_COPY.files(3)).toBe('3 files');
    expect(IMAGE_COPY.chars(1200, 2000)).toBe('1,200 / 2,000 characters');
    expect(LINK_TOOL_COPY.detected(0)).toBe('No browser cookies found');
    expect(FRAME_COPY.saveFoot('Saved here.', true)).toBe('Saved here. This applies to this run only; change the default location in Settings › General.');
    expect(GATE_COPY.downloadBodyPaused.startsWith(GATE_COPY.downloadBody)).toBe(true);
  });

  it('keeps the original Simplified Chinese text', () => {
    setLocale('zh-Hans');
    expect(GALLERY_COPY.title).toBe('工具');
    expect(OUTPUT_COPY.revealFailed('EACCES')).toBe('没能在文件夹中显示：EACCES');
    expect(FRAME_COPY.saveFoot('说明。', true)).toBe('说明。只改这一次，默认位置在设置 › 通用里改。');
    expect(FRAME_COPY.saveFoot('说明。', false)).toBe('说明。默认位置在设置 › 通用里改。');
    expect(TEXT_COPY.previewCut(1200, 34567)).toBe('这里只显示开头 1,200 字；复制与下载是全文（34,567 字）。');
    expect(RECORD_COPY.unsettled('出错了')).toBe(`出错了。${RECORD_COPY.reconcileNote}`);
    expect(GATE_COPY.downloadBodyPaused).toBe(`${GATE_COPY.downloadBody}下载停在一半，继续下载会从这里续传。`);
  });
});
