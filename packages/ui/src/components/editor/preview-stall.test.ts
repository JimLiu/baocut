import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { stallDetail, stallTopic, waitedSeconds } from './preview-stall.ts';
import type { MediaProbe, StallStep } from './preview-watch.ts';

const ASSETS: Record<string, string> = { asset_a: 'interview.mp4', asset_blank: '  ' };
const DOCUMENTS: Record<string, string> = { doc_cap: 'Original captions' };
const names = { asset: (id: string) => ASSETS[id], document: (id: string) => DOCUMENTS[id] };
const probe = (assetId?: string): MediaProbe => ({
  itemId: 'clip',
  ...(assetId ? { assetId } : {}),
  kind: 'video',
  wait: 'no-element',
  wantedSeconds: 0,
  element: null,
});
const report = (step: StallStep, patch: { media?: MediaProbe[]; documents?: string[]; fonts?: string[] } = {}) => ({
  step,
  media: patch.media ?? [],
  documents: patch.documents ?? [],
  fonts: patch.fonts ?? [],
});

describe('预览卡住提示', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('诊断的每一步都落到设计稿的一类', () => {
    expect(stallTopic('planner-loading')).toBe('engine');
    expect((['no-video', 'video-error', 'no-plan'] as const).map(stallTopic)).toEqual(['video', 'video', 'video']);
    expect(stallTopic('media-pending')).toBe('media');
    expect(stallTopic('documents-pending')).toBe('captions');
    expect(stallTopic('fonts-loading')).toBe('fonts');
    expect(stallTopic('not-painted')).toBe('paint');
    expect(stallTopic('no-canvas')).toBe('paint');
  });

  it('点名在等的素材、字幕文档与字体；查不到名字用通用说法', () => {
    expect(stallDetail(report('media-pending', { media: [probe(), probe('asset_blank'), probe('asset_a')] }), names)).toBe(
      '在等媒体：interview.mp4',
    );
    expect(stallDetail(report('media-pending', { media: [probe('asset_gone')] }), names)).toBe('在等媒体');
    expect(stallDetail(report('documents-pending', { documents: ['doc_cap'] }), names)).toBe('在等字幕：Original captions');
    expect(stallDetail(report('documents-pending', { documents: ['doc_gone'] }), names)).toBe('在等字幕');
    expect(stallDetail(report('fonts-loading', { fonts: ['Inter'] }), names)).toBe('在等字体：Inter');
    expect(stallDetail(report('planner-loading'), names)).toBe('预览引擎还在载入');
    expect(stallDetail(report('no-plan'), names)).toBe('还在准备这部视频');
    expect(stallDetail(report('not-painted'), names)).toBe('画面一直没有更新');
  });

  it('英文照设计稿的说法', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(stallDetail(report('media-pending', { media: [probe('asset_a')] }), names)).toBe('Waiting for media: interview.mp4');
    expect(stallDetail(report('planner-loading'), names)).toBe('Preview engine still loading');
    expect(stallDetail(report('documents-pending', { documents: ['doc_gone'] }), names)).toBe('Waiting for captions');
  });

  it('已经等了几秒：从开始卡住算起，向下取整', () => {
    expect(waitedSeconds({ since: 2000 }, 12_999)).toBe(10);
    expect(waitedSeconds({ since: 2000 }, 13_000)).toBe(11);
    expect(waitedSeconds({ since: 5000 }, 1000)).toBe(0);
  });
});
