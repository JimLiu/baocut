import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import { NO_THUMBNAIL, thumbnailVersion, toThumbnail, wantsThumbnail } from './space-thumbnail.ts';

const entry = (patch: Partial<SpaceEntry> = {}): SpaceEntry => ({
  id: 'e1',
  kind: 'video-file',
  name: 'a.mp4',
  fileName: 'a.mp4',
  source: { projectId: 'p1', conversationId: null },
  relPath: 'a.mp4',
  size: 1024,
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  status: null,
  user: { favorite: false, displayName: null, trashedAt: null },
  ...patch,
});

describe('缩略图：要不要取', () => {
  it('有画面或正文的类型才取；音频、便携包、模板不问', () => {
    for (const kind of ['video', 'export', 'video-file', 'image', 'document', 'subtitle'] as const) {
      expect(wantsThumbnail(entry({ kind }))).toBe(true);
    }
    for (const kind of ['audio', 'package', 'template'] as const) expect(wantsThumbnail(entry({ kind }))).toBe(false);
  });

  it('缺失、生成中与失败的不取（Runtime 都答 none）；来源已变、回收站里的照取', () => {
    expect(wantsThumbnail(entry({ status: 'missing' }))).toBe(false);
    expect(wantsThumbnail(entry({ status: 'generating' }))).toBe(false);
    expect(wantsThumbnail(entry({ status: 'failed' }))).toBe(false);
    expect(wantsThumbnail(entry({ status: 'source-changed' }))).toBe(true);
    expect(
      wantsThumbnail(
        entry({
          user: {
            favorite: false,
            displayName: null,
            trashedAt: '2026-10-02T00:00:00.000Z',
          },
        }),
      ),
    ).toBe(true);
  });
});

describe('缩略图：版本', () => {
  it('最近活动、大小、状态、指向的视频与路径变了版本才变；改名、收藏不变', () => {
    const base = entry({ kind: 'video', ref: { videoId: 'v1' } });
    const v = thumbnailVersion(base);
    expect(
      thumbnailVersion({
        ...base,
        name: '新名字',
        user: { ...base.user, favorite: true, displayName: '新名字' },
      }),
    ).toBe(v);
    expect(thumbnailVersion({ ...base, lastActivityAt: '2026-10-02T00:00:00.000Z' })).not.toBe(v);
    expect(thumbnailVersion({ ...base, size: 2048 })).not.toBe(v);
    expect(thumbnailVersion({ ...base, status: 'missing' })).not.toBe(v);
    expect(thumbnailVersion({ ...base, ref: { videoId: 'v2' } })).not.toBe(v);
    expect(thumbnailVersion({ ...base, relPath: 'b/a.mp4' })).not.toBe(v);
  });
});

describe('缩略图：Runtime 的回答', () => {
  it('画面拼成 data URL，摘要原样，空摘要与 none 画占位', () => {
    expect(
      toThumbnail({
        kind: 'image',
        mimeType: 'image/png',
        data: 'AAA=',
        width: 320,
        height: 180,
      }),
    ).toEqual({
      kind: 'image',
      url: 'data:image/png;base64,AAA=',
      width: 320,
      height: 180,
    });
    expect(toThumbnail({ kind: 'text', excerpt: '第一行\n第二行' })).toEqual({
      kind: 'text',
      excerpt: '第一行\n第二行',
    });
    expect(toThumbnail({ kind: 'text', excerpt: '' })).toBe(NO_THUMBNAIL);
    expect(toThumbnail({ kind: 'none' })).toBe(NO_THUMBNAIL);
  });
});
