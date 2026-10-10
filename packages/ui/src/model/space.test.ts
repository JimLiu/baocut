import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import {
  SPACE_SORTS,
  countByCategory,
  entryPath,
  filesAttention,
  filesOf,
  filesSummary,
  formatBytes,
  groupEntries,
  hitsText,
  hostVideoOf,
  inCategory,
  measureText,
  previewKind,
  projectOptions,
  recentVideos,
  sourceLabel,
  statusText,
  videoNamesOf,
  viewEntries,
  visibleCategories,
} from './space.ts';

const entry = (id: string, patch: Partial<SpaceEntry> = {}, user: Partial<SpaceEntry['user']> = {}): SpaceEntry => ({
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
  user: { favorite: false, displayName: null, trashedAt: null, ...user },
});

const dirs = { projects: [{ id: 'p1', name: '宣传片', path: '/work/promo/' }], conversations: [{ id: 'c1', title: '', cwd: '/tmp/c1' }] };

describe('分类', () => {
  it('回收站只收移入的；其余分类都不含回收站里的', () => {
    const trashed = entry('a', {}, { trashedAt: '2026-10-01T00:00:00.000Z', favorite: true });
    expect(inCategory(trashed, 'trash')).toBe(true);
    expect(inCategory(trashed, 'all')).toBe(false);
    expect(inCategory(trashed, 'favorite')).toBe(false);
    expect(inCategory(trashed, 'video-file')).toBe(false);
  });

  it('计数与侧栏：有条目的类型才出现，全部、收藏、回收站总在', () => {
    const counts = countByCategory([entry('a'), entry('b', { kind: 'image' }, { favorite: true })]);
    expect(counts.all).toBe(2);
    expect(counts['video-file']).toBe(1);
    expect(counts.favorite).toBe(1);
    expect(counts.audio).toBe(0);
    expect(visibleCategories(counts).map((c) => c.key)).toEqual(['all', 'video-file', 'image', 'favorite', 'trash']);
  });
});

describe('viewEntries', () => {
  const rows = [
    entry('b', { lastActivityAt: '2026-10-01T02:00:00.000Z', kind: 'image', name: '乙.png' }),
    entry('a', { lastActivityAt: '2026-10-01T01:00:00.000Z', name: '甲.mp4', relPath: 'clips/甲.mp4' }),
    entry('c', { source: { projectId: null, conversationId: 'c1' }, lastActivityAt: '2026-10-01T03:00:00.000Z' }),
  ];
  const query = { category: 'all' as const, projectId: null, search: '', sort: 'recent' as const };

  it('默认按最近活动排', () => {
    expect(viewEntries(rows, query).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('创建与更新时间各自倒序，时间相同保持次序，未知与无效时间放在末尾', () => {
    const dated = [
      entry('old', { createdAt: '2026-10-01T01:00:00Z', updatedAt: '2026-10-01T04:00:00Z' }),
      entry('new', { createdAt: '2026-10-01T03:00:00+00:00', updatedAt: '2026-10-01T02:00:00Z' }),
      entry('tie', { createdAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T02:00:00.000Z' }),
      entry('legacy'),
      entry('unknown', { createdAt: null, updatedAt: null }),
      entry('invalid', { createdAt: 'invalid', updatedAt: '' }),
    ];
    expect(viewEntries(dated, { ...query, sort: 'created' }).map((e) => e.id)).toEqual(['new', 'tie', 'old', 'legacy', 'unknown', 'invalid']);
    expect(viewEntries(dated, { ...query, sort: 'updated' }).map((e) => e.id)).toEqual(['old', 'new', 'tie', 'legacy', 'unknown', 'invalid']);
    expect(viewEntries(dated, { ...query, sort: 'created', search: 'old' }).map((e) => e.id)).toEqual(['old']);
    expect(SPACE_SORTS.map((s) => s.key)).toEqual(['recent', 'created', 'updated', 'name', 'kind']);
  });

  it('按项目筛选；none 是不属于任何项目的', () => {
    expect(viewEntries(rows, { ...query, projectId: 'p1' }).map((e) => e.id)).toEqual(['b', 'a']);
    expect(viewEntries(rows, { ...query, projectId: 'none' }).map((e) => e.id)).toEqual(['c']);
  });

  it('搜索名称与路径；按类型排时视频类在前', () => {
    expect(viewEntries(rows, { ...query, search: 'CLIPS' }).map((e) => e.id)).toEqual(['a']);
    expect(viewEntries(rows, { ...query, sort: 'kind' }).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('项目选项只列出现过的项目，有临时会话的条目时末尾加一项', () => {
    expect(
      projectOptions(rows, [
        { id: 'p1', name: '宣传片' },
        { id: 'p2', name: '没用到' },
      ]),
    ).toEqual([
      { key: 'p1', label: '宣传片' },
      { key: 'none', label: '不属于任何项目' },
    ]);
  });
});

describe('一部视频只出现一次', () => {
  const query = { category: 'all' as const, projectId: null, search: '', sort: 'recent' as const };
  const at = (h: number) => `2026-10-01T${String(h).padStart(2, '0')}:00:00.000Z`;
  const from = (videoId: string) => ({ source: 'exported' as const, projectId: 'p1', videoId });
  // 截图里的情形：一部下载转录的视频，连同下载的源文件、导出的成片、字幕与文稿
  const video = entry('v', { kind: 'video', name: '洗碗机', ref: { videoId: 'vid1' }, lastActivityAt: at(1) });
  const files = [
    entry('mp4', { kind: 'video-file', name: '洗碗机.mp4', origin: { ...from('vid1'), source: 'imported' }, lastActivityAt: at(2) }),
    entry('final', { kind: 'export', name: '洗碗机 · 成片.mp4', origin: from('vid1'), lastActivityAt: at(3) }),
    entry('srt', { kind: 'subtitle', name: '英文字幕.srt', origin: from('vid1'), lastActivityAt: at(4) }),
    entry('md', { kind: 'document', name: 'transcript.md', origin: from('vid1'), lastActivityAt: at(5), status: 'source-changed' }),
  ];
  const other = entry('other', { kind: 'image', name: '海报.png', lastActivityAt: at(3) });
  const list = [video, ...files, other];

  it('「全部」与「视频」里视频收下它的文件，卡片数按一部算；按类型看仍逐个列出', () => {
    expect(viewEntries(list, query).map((e) => e.id)).toEqual(['v', 'other']);
    const [row] = viewEntries(list, query);
    expect(row!.files!.map((f) => f.id)).toEqual(['final', 'mp4', 'srt', 'md']);
    expect(row!.activityAt).toBe(at(5));
    expect(viewEntries(list, { ...query, category: 'export' }).map((e) => e.id)).toEqual(['final']);
    const counts = countByCategory(list);
    expect([counts.all, counts.video, counts.export, counts.subtitle, counts.document]).toEqual([2, 1, 1, 1, 1]);
  });

  it('最近活动按视频与文件里最近的一次排；更新时间只看视频自己', () => {
    const late = entry('late', { kind: 'image', lastActivityAt: at(4) });
    expect(viewEntries([...list, late], query).map((e) => e.id)).toEqual(['v', 'late', 'other']);
  });

  it('搜索与状态穿过文件：只靠文件对上时记下是哪个文件，「无状态」只看视频自己', () => {
    const [byFile] = viewEntries(list, { ...query, search: 'SRT' });
    expect([byFile!.id, byFile!.hits]).toEqual(['v', ['srt']]);
    expect(hitsText(byFile!)).toBe('找到 英文字幕.srt');
    expect(hitsText({ ...byFile!, hits: ['final', 'mp4'] })).toBe('找到 洗碗机 · 成片.mp4 等 2 个文件');
    const [self] = viewEntries(list, { ...query, search: '洗碗机' });
    expect([self!.id, self!.hits]).toEqual(['v', undefined]);
    expect(viewEntries(list, { ...query, status: 'source-changed' }).map((e) => [e.id, e.hits])).toEqual([['v', ['md']]]);
    expect(viewEntries(list, { ...query, status: 'none' }).map((e) => e.id)).toEqual(['v', 'other']);
  });

  it('卡片的明细与状态：视频自己没有状态时替最该被看见的文件说话', () => {
    const [row] = groupEntries(list);
    expect(filesSummary(row!)).toBe('成片 1 · 视频素材 1 · 字幕 1 · 文档 1');
    expect(filesAttention(row!)).toEqual({ status: 'source-changed', text: '文档来源已变' });
    const busy = groupEntries([video, ...files.map((f) => ({ ...f, status: 'missing' as const })), { ...files[1]!, id: 'gen', status: 'generating' as const }]);
    expect(filesAttention(busy[0]!)).toEqual({ status: 'generating', text: '成片生成中' });
    expect(filesAttention(groupEntries([video, ...files.map((f) => ({ ...f, status: 'missing' as const }))])[0]!)!.text).toBe('4 个文件缺失');
    expect(filesAttention({ ...row!, status: 'missing' })).toBeNull();
  });

  it('模板、回收站里的文件不收；视频进了回收站，它的文件各自出现', () => {
    const template = entry('tpl', { kind: 'template', origin: from('vid1') });
    const trashedFile = entry('old', { kind: 'export', origin: from('vid1') }, { trashedAt: at(6) });
    expect(viewEntries([video, template, trashedFile], query).map((e) => e.id)).toEqual(['v', 'tpl']);
    const gone = { ...video, user: { ...video.user, trashedAt: at(6) } };
    expect(viewEntries([gone, ...files], query).map((e) => e.id)).toEqual(['md', 'srt', 'final', 'mp4']);
  });

  it('查看框：视频列出名下的文件，文件回到所属的视频；同一个 videoId 有两处时收进先列出的那个', () => {
    expect(filesOf(list, 'v').map((f) => f.id)).toEqual(['final', 'mp4', 'srt', 'md']);
    expect(filesOf(list, 'other')).toEqual([]);
    expect(hostVideoOf(list, files[2]!)?.id).toBe('v');
    expect(hostVideoOf(list, other)).toBeNull();
    const copy = entry('v2', { kind: 'video', ref: { videoId: 'vid1' } });
    expect(viewEntries([video, copy, ...files], query).map((e) => [e.id, e.files?.length])).toEqual([
      ['v', 4],
      ['v2', undefined],
    ]);
  });
});

describe('不在来源目录里的产物（来源两项都是 null）', () => {
  const art = entry('art', {
    kind: 'image',
    source: { projectId: null, conversationId: null },
    relPath: 'cover.png',
    ref: { artifactId: 'art' },
    origin: { source: 'generated', projectId: 'p1', videoId: 'vid1', conversationId: 'c1' },
  });
  const loose = entry('loose', {
    source: { projectId: null, conversationId: null },
    origin: { source: 'generated', projectId: null, conversationId: 'c1' },
  });
  const query = { category: 'all' as const, projectId: null, search: '', sort: 'recent' as const };

  it('按 origin.projectId 归到项目：项目筛选与选项都看两处', () => {
    expect(viewEntries([art, loose], { ...query, projectId: 'p1' }).map((e) => e.id)).toEqual(['art']);
    expect(viewEntries([art, loose], { ...query, projectId: 'none' }).map((e) => e.id)).toEqual(['loose']);
    expect(projectOptions([art], [{ id: 'p1', name: '宣传片' }])).toEqual([{ key: 'p1', label: '宣传片' }]);
  });

  it('来源写项目 · 产生它的视频；没有项目时写产生它的会话', () => {
    const names = videoNamesOf([entry('v', { kind: 'video', name: '发布会', ref: { videoId: 'vid1' } })]);
    expect(sourceLabel(art, dirs, '新会话', names)).toBe('宣传片 · 发布会');
    expect(sourceLabel(art, dirs, '新会话')).toBe('宣传片');
    expect(sourceLabel(loose, dirs, '新会话')).toBe('会话「新会话」');
    expect(sourceLabel(entry('x', { source: { projectId: null, conversationId: null } }), dirs, '新会话')).toBe('不属于任何项目');
  });
});

describe('状态与时长', () => {
  const query = { category: 'all' as const, projectId: null, search: '', sort: 'recent' as const };
  const rows = [entry('a', { status: 'candidate' }), entry('b'), entry('c', { status: 'missing' })];

  it('按状态筛选；none 是没有状态的', () => {
    expect(viewEntries(rows, { ...query, status: 'candidate' }).map((e) => e.id)).toEqual(['a']);
    expect(viewEntries(rows, { ...query, status: 'none' }).map((e) => e.id)).toEqual(['b']);
    expect(viewEntries(rows, { ...query, status: 'any' })).toHaveLength(3);
  });

  it('状态的字：生成中带进度', () => {
    expect(statusText({ status: null })).toBeNull();
    expect(statusText({ status: 'source-changed' })).toBe('来源已变');
    expect(statusText({ status: 'generating', statusDetail: { progress: { done: 1, total: 4 } } })).toBe('生成中 · 25%');
    expect(statusText({ status: 'generating', statusDetail: { progress: { done: 1, total: null } } })).toBe('生成中');
  });

  it('时长或尺寸：视频写时长与画面，音频写时长，图片写尺寸；没有媒体信息时 null', () => {
    expect(measureText({ kind: 'export', media: { durationSec: 65, width: 1920, height: 1080 } })).toBe('1:05 · 1920×1080');
    expect(measureText({ kind: 'audio', media: { durationSec: 3, width: 1, height: 1 } })).toBe('0:03');
    expect(measureText({ kind: 'image', media: { width: 640, height: 480 } })).toBe('640×480');
    expect(measureText({ kind: 'image', media: {} })).toBeNull();
    expect(measureText({ kind: 'document' })).toBeNull();
  });
});

describe('位置与来源', () => {
  it('项目条目在项目目录下，临时会话的条目在会话工作目录下；来源不在了为 null', () => {
    expect(entryPath(entry('a', { relPath: 'clips/a.mp4' }), dirs)).toBe('/work/promo/clips/a.mp4');
    expect(entryPath(entry('c', { source: { projectId: null, conversationId: 'c1' } }), dirs)).toBe('/tmp/c1/c.mp4');
    expect(entryPath(entry('x', { source: { projectId: 'gone', conversationId: null } }), dirs)).toBeNull();
    // 不在来源目录里的结果：写到保存位置的文件（§7.9）。
    expect(entryPath(entry('s', { source: { projectId: null, conversationId: null }, file: { path: '/Users/me/Downloads/s.mp3' } }), dirs)).toBe(
      '/Users/me/Downloads/s.mp3',
    );
    expect(entryPath(entry('n', { source: { projectId: null, conversationId: null } }), dirs)).toBeNull();
  });

  it('来源一列带上子目录；没有标题的会话用占位名', () => {
    expect(sourceLabel(entry('a', { relPath: 'clips/a.mp4' }), dirs, '新会话')).toBe('宣传片 · clips');
    expect(sourceLabel(entry('c', { source: { projectId: null, conversationId: 'c1' } }), dirs, '新会话')).toBe('会话「新会话」');
  });
});

describe('预览与大小', () => {
  it('浏览器放不了的格式如实说', () => {
    expect(previewKind({ kind: 'video-file', fileName: 'a.MP4' })).toBe('video');
    expect(previewKind({ kind: 'video-file', fileName: 'a.mkv' })).toBeNull();
    expect(previewKind({ kind: 'image', fileName: 'a.heic' })).toBeNull();
    expect(previewKind({ kind: 'subtitle', fileName: 'a.srt' })).toBe('text');
    expect(previewKind({ kind: 'document', fileName: 'a.md' })).toBe('markdown');
    expect(previewKind({ kind: 'document', fileName: 'a.pdf' })).toBe('pdf');
    expect(previewKind({ kind: 'document', fileName: 'a.csv' })).toBe('table');
    expect(previewKind({ kind: 'document', fileName: 'a.html' })).toBe('html');
  });

  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});

describe('最近的视频', () => {
  const video = (id: string, at: string, patch: Partial<SpaceEntry> = {}, user: Partial<SpaceEntry['user']> = {}) =>
    entry(id, { kind: 'video', ref: { videoId: `v-${id}` }, relPath: id, lastActivityAt: at, ...patch }, user);

  it('只列还能选的项目里的视频，新的在前，最多几部', () => {
    const list = [
      video('old', '2026-09-01T00:00:00.000Z'),
      video('new', '2026-10-02T00:00:00.000Z'),
      video('mid', '2026-09-15T00:00:00.000Z'),
      video('archived', '2026-10-03T00:00:00.000Z', { source: { projectId: 'p2', conversationId: null } }),
      video('chat', '2026-10-03T00:00:00.000Z', { source: { projectId: null, conversationId: 'c1' } }),
      video('trashed', '2026-10-03T00:00:00.000Z', {}, { trashedAt: '2026-10-04T00:00:00.000Z' }),
      video('missing', '2026-10-03T00:00:00.000Z', { status: 'missing' }),
      entry('file', { lastActivityAt: '2026-10-03T00:00:00.000Z' }),
    ];
    expect(recentVideos(list, ['p1']).map((e) => e.id)).toEqual(['new', 'mid', 'old']);
    expect(recentVideos(list, ['p1'], 2).map((e) => e.id)).toEqual(['new', 'mid']);
    expect(recentVideos(list, []).map((e) => e.id)).toEqual([]);
  });
});
