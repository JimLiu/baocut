import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import { entryReason, inputKindOf, SPACE_INPUT_COPY, spaceKindsText, spaceRows, toolsForEntry } from './tool-space-input.ts';
import type { PickerRow } from './tool-targets.ts';

const entry = (id: string, patch: Partial<SpaceEntry> = {}, trashedAt: string | null = null): SpaceEntry => ({
  id,
  kind: 'video-file',
  name: `${id}.mp4`,
  fileName: `${id}.mp4`,
  source: { projectId: 'p1', conversationId: null },
  relPath: `${id}.mp4`,
  size: 1024,
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  status: null,
  ...patch,
  user: { favorite: false, displayName: null, trashedAt },
});

const videoRow = (entryId: string, patch: Partial<PickerRow> = {}): PickerRow => ({
  entryId,
  videoId: `v-${entryId}`,
  name: entryId,
  projectId: 'p1',
  lastActivityAt: '2026-10-02T00:00:00.000Z',
  indexed: true,
  documents: [],
  tags: [],
  eligible: true,
  reason: null,
  ...patch,
});

describe('Space 选择器的候选', () => {
  const entries = [
    entry('clip'),
    entry('final', { kind: 'export', name: '成片.mp4', lastActivityAt: '2026-10-03T00:00:00.000Z' }),
    entry('voice', { kind: 'audio', name: 'voice.m4a', fileName: 'voice.m4a' }),
    entry('notes', { kind: 'document', name: 'notes.md', fileName: 'notes.md' }),
    entry('old', {}, '2026-09-01T00:00:00.000Z'),
    entry('busy', { status: 'generating', lastActivityAt: '2026-10-05T00:00:00.000Z' }),
    entry('movie', { kind: 'video', name: 'movie' }),
  ];

  it('只列工具收的种类，回收站里的不列；能选的在前，同组按最近活动', () => {
    const rows = spaceRows('compress-video', entries, []);
    expect(rows.map((r) => r.entryId)).toEqual(['final', 'clip', 'busy']);
    expect(rows.at(-1)).toMatchObject({ eligible: false, reason: SPACE_INPUT_COPY.generating });
  });

  it('视频行来自候选（带文稿与置灰原因），只给收视频的工具', () => {
    const videos = [videoRow('movie'), videoRow('raw', { eligible: false, reason: '还没有文稿' })];
    const rows = spaceRows('transcribe', entries, videos);
    expect(rows.map((r) => r.entryId)).toEqual(['final', 'movie', 'clip', 'voice', 'busy', 'raw']);
    expect(rows.find((r) => r.entryId === 'movie')).toMatchObject({ kind: 'video', kindLabel: '视频', video: videos[0] });
    expect(spaceRows('extract-audio', entries, videos).some((r) => r.kind === 'video')).toBe(false);
  });

  it('按名字搜索，不分大小写', () => {
    expect(spaceRows('transcribe', entries, [videoRow('Movie')], 'MOV').map((r) => r.entryId)).toEqual(['Movie']);
    expect(spaceRows('synthesize-speech', entries, [], 'note').map((r) => r.entryId)).toEqual(['notes']);
  });

  it('条目本身的原因：生成中、缺失、失败、读不了的文档与字幕格式', () => {
    expect(entryReason(entry('a', { status: 'missing' }))).toBe(SPACE_INPUT_COPY.missing);
    expect(entryReason(entry('a', { status: 'failed' }))).toBe(SPACE_INPUT_COPY.failed);
    expect(entryReason(entry('a', { kind: 'document', fileName: 'a.pdf' }))).toBe(SPACE_INPUT_COPY.textOnly);
    expect(entryReason(entry('a', { kind: 'document', fileName: 'a.TXT' }))).toBeNull();
    expect(entryReason(entry('a', { kind: 'subtitle', fileName: 'a.ass' }))).toBe(SPACE_INPUT_COPY.subtitleOnly);
    expect(entryReason(entry('a', { kind: 'subtitle', fileName: 'a.vtt' }))).toBeNull();
    expect(entryReason(entry('a', {}, '2026-09-01T00:00:00.000Z'))).toBe(SPACE_INPUT_COPY.trashed);
  });

  it('收的种类写成一句', () => {
    expect(spaceKindsText('transcribe')).toBe('视频、视频素材、成片、音频');
    expect(spaceKindsText('generate-image')).toBe('');
  });
});

describe('条目按哪种输入提交', () => {
  it('视频写进它，生成语音与文本生成的文档是素材，其余当文件', () => {
    expect(inputKindOf('transcribe', 'video')).toBe('video');
    expect(inputKindOf('transcribe', 'audio')).toBe('file');
    expect(inputKindOf('translate-subtitles', 'subtitle')).toBe('file');
    expect(inputKindOf('synthesize-speech', 'subtitle')).toBe('document');
    expect(inputKindOf('generate-text', 'document')).toBe('document');
    expect(inputKindOf('merge-video', 'export')).toBe('file');
  });
});

describe('条目 → 收它的工具', () => {
  it('按目录顺序；回收站里的没有', () => {
    expect(toolsForEntry(entry('a', { kind: 'audio' }))).toEqual(['transcribe', 'extract-audio']);
    expect(toolsForEntry(entry('a', { kind: 'subtitle' }))).toEqual(['translate-subtitles', 'synthesize-speech', 'generate-text']);
    expect(toolsForEntry(entry('a', { kind: 'video' }))).toEqual(['transcribe', 'translate-subtitles', 'dub']);
    expect(toolsForEntry(entry('a', { kind: 'image' }))).toEqual([]);
    expect(toolsForEntry(entry('a', { kind: 'export' }, '2026-09-01T00:00:00.000Z'))).toEqual([]);
  });
});
