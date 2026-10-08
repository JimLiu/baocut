import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import {
  continueBlock,
  editBlock,
  editRoute,
  entryConversationId,
  entryJobId,
  entryMenuKey,
  importSummary,
  isFailedPlaceholder,
  packageBlock,
  packageScope,
  placeKindOf,
  purgeBlock,
  referenceDescription,
  referencesText,
  relatedEntries,
  videoNameOf,
} from './space-actions.ts';

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

const artifact = (id: string, patch: Partial<SpaceEntry> = {}) =>
  entry(id, { source: { projectId: null, conversationId: null }, ref: { artifactId: id }, ...patch });

describe('二次编辑的去处', () => {
  it('视频进编辑器；有来源视频的回到来源视频；没有来源的成片与视频素材新建视频', () => {
    expect(editRoute(entry('v', { kind: 'video' }))).toBe('video');
    expect(editRoute(entry('e', { kind: 'export', origin: { source: 'exported', videoId: 'vid1' } }))).toBe('source-video');
    expect(editRoute(entry('e', { kind: 'export' }))).toBe('new-video');
    expect(editRoute(entry('f'))).toBe('new-video');
    expect(editRoute(entry('s', { kind: 'subtitle' }))).toBe('text');
    expect(editRoute(entry('i', { kind: 'image' }))).toBe('version');
    expect(editRoute(entry('p', { kind: 'package' }))).toBeNull();
  });

  it('做不了的写明原因：状态、还没开放的编辑、拿不到路径的产物', () => {
    expect(editBlock(entry('v', { kind: 'video' }), null)).toBeNull();
    expect(editBlock(entry('f'), '/work/f.mp4')).toBeNull();
    expect(editBlock(entry('f'), null)).toMatch('不在项目或会话的目录里');
    expect(editBlock(artifact('a', { kind: 'export' }), null)).toMatch('不在项目或会话的目录里');
    expect(editBlock(entry('f', {}, { trashedAt: '2026-10-01T00:00:00.000Z' }), '/work/f.mp4')).toMatch('先恢复');
    expect(editBlock(entry('f', { status: 'missing' }), '/work/f.mp4')).toMatch('找不到文件');
    expect(editBlock(entry('f', { status: 'generating' }), '/work/f.mp4')).toMatch('还在生成');
    expect(editBlock(entry('s', { kind: 'subtitle' }), '/work/s.srt')).toMatch('在会话中继续');
    expect(editBlock(entry('i', { kind: 'image' }), '/work/i.png')).toMatch('还没有开放');
    expect(editBlock(entry('e', { kind: 'export', origin: { source: 'exported', videoId: 'vid1' } }), null)).toBeNull();
  });
});

describe('继续与删除', () => {
  it('回收站里的条目要先恢复才能带入会话', () => {
    expect(continueBlock(entry('a'))).toBeNull();
    expect(continueBlock(entry('a', {}, { trashedAt: '2026-10-01T00:00:00.000Z' }))).toMatch('先恢复');
  });

  it('彻底删除只给回收站里的；失败的占位直接清除；生成中的先取消', () => {
    expect(purgeBlock(entry('a'))).toMatch('先移入回收站');
    expect(purgeBlock(entry('a', {}, { trashedAt: '2026-10-01T00:00:00.000Z' }))).toBeNull();
    const failed = entry('j1', { status: 'failed', ref: { jobId: 'j1' }, source: { projectId: null, conversationId: null } });
    expect(isFailedPlaceholder(failed)).toBe(true);
    expect(purgeBlock(failed)).toBeNull();
    expect(purgeBlock(entry('j2', { status: 'generating', ref: { jobId: 'j2' } }))).toMatch('先在任务页取消');
  });

  it('删除视频时列出由它导出、生成的条目（不含视频本身与回收站里的）', () => {
    const rows = [
      entry('v', { kind: 'video', ref: { videoId: 'vid1' } }),
      artifact('x', { kind: 'export', origin: { source: 'exported', videoId: 'vid1' } }),
      artifact('y', { kind: 'image', origin: { source: 'generated', videoId: 'vid1' } }),
      artifact('z', { kind: 'image', origin: { source: 'generated', videoId: 'vid2' } }),
    ];
    rows.push(entry('t', { origin: { source: 'generated', videoId: 'vid1' } }, { trashedAt: '2026-10-01T00:00:00.000Z' }));
    expect(relatedEntries(rows, 'vid1').map((e) => e.id)).toEqual(['x', 'y']);
  });

  it('任务与来源会话：占位看自己的任务，产物看 origin', () => {
    expect(entryJobId(entry('j', { ref: { jobId: 'j' } }))).toBe('j');
    expect(entryJobId(artifact('a', { origin: { source: 'generated', jobId: 'job9' } }))).toBe('job9');
    expect(entryJobId(entry('f'))).toBeNull();
    expect(entryConversationId(entry('c', { source: { projectId: null, conversationId: 'c1' } }))).toBe('c1');
    expect(entryConversationId(artifact('a', { origin: { source: 'generated', conversationId: 'c2' } }))).toBe('c2');
  });
});

describe('导入的结果', () => {
  it('写明几个复制进了 imports/、几个没导入', () => {
    expect(importSummary([{ ok: true, copied: true }])).toEqual({ text: '已导入 1 个素材 · 复制进了项目的 imports/', tone: 'positive' });
    expect(importSummary([{ ok: true, copied: false }, { ok: true, copied: true }, { ok: false, error: '认不出' }])).toEqual({
      text: '已导入 2 个素材 · 1 个复制进了项目的 imports/ · 1 个没有导入',
      tone: 'neutral',
    });
    expect(importSummary([{ ok: false, error: '文件不存在' }])).toEqual({ text: '没有导入：文件不存在', tone: 'negative' });
  });
});

describe('从文件新建视频', () => {
  it('只有视频、音频、图片能放上时间线', () => {
    expect(placeKindOf('a.MOV')).toBe('video');
    expect(placeKindOf('b.wav')).toBe('audio');
    expect(placeKindOf('c.png')).toBe('image');
    expect(placeKindOf('d.srt')).toBeNull();
    expect(placeKindOf('noext')).toBeNull();
  });

  it('视频名取文件名去掉扩展名', () => {
    expect(videoNameOf('/Users/me/Movies/采访 01.mp4')).toBe('采访 01');
    expect(videoNameOf('C:\\clips\\b-roll.mov')).toBe('b-roll');
    expect(videoNameOf('/x/.hidden')).toBe('.hidden');
    expect(videoNameOf('/x/plain')).toBe('plain');
  });
});

describe('随消息带上的条目', () => {
  it('最多写出两个名字', () => {
    expect(referencesText([{ name: '成片' }])).toBe('Space 条目 「成片」');
    expect(referencesText([{ name: 'a' }, { name: 'b' }])).toBe('Space 条目 「a」「b」');
    expect(referencesText([{ name: 'a' }, { name: 'b' }, { name: 'c' }])).toBe('Space 条目 「a」「b」等 3 个');
  });

  it('说明写类型与位置', () => {
    expect(referenceDescription({ kind: 'image', relPath: 'imports/封面.png' })).toBe('图片 · imports/封面.png');
    expect(referenceDescription({ kind: 'audio', relPath: null })).toBe('音频 · 产物');
  });
});

describe('便携包打开成新视频', () => {
  const pkg = (patch: Partial<SpaceEntry> = {}, user: Partial<SpaceEntry['user']> = {}) =>
    entry('p', { kind: 'package', name: 'p.baocut', fileName: 'p.baocut', relPath: 'exports/p.baocut', ...patch }, user);

  it('项目或会话目录里的包能打开，新视频建在包所在的目录', () => {
    expect(packageBlock(pkg(), '/work/exports/p.baocut')).toBeNull();
    expect(packageScope(pkg())).toEqual({ projectId: 'p1' });
    expect(packageScope(pkg({ source: { projectId: null, conversationId: 'c1' } }))).toEqual({ conversationId: 'c1' });
  });

  it('回收站、导出中、缺失、失败、不在来源目录里的包打不开，并说明原因', () => {
    expect(packageBlock(pkg({}, { trashedAt: '2026-10-01T00:00:00.000Z' }), '/work/p.baocut')).toMatch('先恢复');
    expect(packageBlock(pkg({ status: 'generating' }), '/work/p.baocut')).toMatch('还在导出');
    expect(packageBlock(pkg({ status: 'missing' }), '/work/p.baocut')).toMatch('找不到');
    expect(packageBlock(pkg({ status: 'failed' }), '/work/p.baocut')).toMatch('导出失败');
    expect(packageBlock(pkg(), null)).toMatch('不在项目或会话的目录里');
    expect(packageBlock(pkg({ source: { projectId: null, conversationId: null } }), '/a/p.baocut')).toMatch('不在项目或会话的目录里');
    expect(packageScope(pkg({ source: { projectId: null, conversationId: null } }))).toBeNull();
  });
});

describe('列表与卡片的集合依赖键', () => {
  const entries = [entry('a', { kind: 'video' }), entry('b')];
  const reveal = () => true;

  it('同一个 entries 数组，转录动作后到（null → redo）时键变，菜单才会重渲染出「重新转录…」', () => {
    const before = entryMenuKey(entries, reveal, () => null);
    const after = entryMenuKey(entries, reveal, (e) => (e.kind === 'video' ? 'redo' : null));
    expect(after).not.toBe(before);
    expect(entryMenuKey(entries, reveal, (e) => (e.kind === 'video' ? 'redo' : null))).toBe(after);
  });

  it('能否在文件夹中显示、来源列变了也让键变；结果都没变时键不变（不每次渲染都失效缓存）', () => {
    const none = () => null;
    const base = entryMenuKey(entries, reveal, none, () => '项目一');
    expect(
      entryMenuKey(
        entries,
        () => false,
        none,
        () => '项目一',
      ),
    ).not.toBe(base);
    expect(entryMenuKey(entries, reveal, none, () => '项目二')).not.toBe(base);
    expect(entryMenuKey([...entries], reveal, none, () => '项目一')).toBe(base);
  });
});
