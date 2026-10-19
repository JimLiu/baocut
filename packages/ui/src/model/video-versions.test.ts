import { describe, expect, it } from 'vitest';
import { RpcError, type VideoVersion, type VideoVersionList } from '@baocut/protocol';
import {
  actorGroups,
  actorLabel,
  blockedText,
  buttonTip,
  fileChange,
  fileLabel,
  isImportChange,
  parseUnifiedDiff,
  predictNoop,
  reach,
  resolveAsk,
  snapshotState,
  versionError,
  versionFileName,
  versionRows,
  versionTitle,
} from './video-versions.ts';

const version = (patch: Partial<VideoVersion> & Pick<VideoVersion, 'version'>): VideoVersion => ({
  kind: 'segment',
  startedAt: '2026-10-17T09:41:00.000Z',
  updatedAt: '2026-10-17T10:02:00.000Z',
  fromRevision: '1',
  toRevision: '2',
  summary: 'Trim clip',
  actions: [{ actor: 'user_local', label: 'Trim clip', count: 1 }],
  conversations: [],
  files: [{ path: 'video.json', before: 'sha256:a', after: 'sha256:b' }],
  bytes: 512,
  open: false,
  ...patch,
});

/** 版本 1–6，新的在前；4 读不出。 */
const list: VideoVersionList = {
  versions: [6, 5, 3, 2, 1].map((n) => version({ version: n, open: n === 6 })),
  unreadable: [4],
};

describe('video versions', () => {
  it('merges unreadable versions into the list, newest first, and marks the top', () => {
    const rows = versionRows(list, null);
    expect(rows.map((r) => r.version)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(rows[0]!.top).toBe(true);
    expect(rows.find((r) => r.version === 4)).toMatchObject({ unreadable: true, blocked: true });
    // 回到 3 结束时要逆着走过 4：读不出就挡住，3 之前的都回不去；5 结束时与之前都走得通。
    expect(rows.find((r) => r.version === 3)!.blocked).toBe(true);
    expect(rows.find((r) => r.version === 5)!.blocked).toBe(false);
  });

  it('blocks restores that would walk through an unreadable version or a reported break', () => {
    expect(reach(list, null, 5, false)).toEqual({ ok: true });
    expect(reach(list, null, 5, true)).toEqual({ ok: true });
    expect(reach(list, null, 4, false)).toEqual({ ok: false, reason: 'unreadable', at: 4 });
    expect(reach(list, null, 3, false)).toEqual({ ok: false, reason: 'unreadable', at: 4 });
    expect(reach(list, null, 9, false)).toEqual({ ok: false, reason: 'not-found', at: 9 });
    // 上次回到时引擎报出断点 5：5 之前（含 5 开始之前）都回不去，5 结束时还行。
    expect(reach(list, 5, 5, false)).toEqual({ ok: true });
    expect(reach(list, 5, 5, true)).toEqual({ ok: false, reason: 'broken', at: 5 });
    expect(blockedText(reach(list, null, 3, false))).toBe('版本 4 的文件读不出来，它和更早的状态都回不去');
    expect(blockedText(reach(list, 5, 2, false))).toBe('版本记录在版本 5 处对不上，更早的状态都回不去');
  });

  it('predicts a no-op restore only when the snapshot is synced and every walked diff is empty', () => {
    const saved: VideoVersionList = {
      versions: [version({ version: 3, kind: 'save', name: '送审', files: [] }), version({ version: 2 }), version({ version: 1 })],
      unreadable: [],
    };
    expect(predictNoop(saved, 'synced', 2, false)).toBe(true);
    expect(predictNoop(saved, 'synced', 3, true)).toBe(true);
    expect(predictNoop(saved, 'synced', 2, true)).toBe(false);
    expect(predictNoop(saved, 'pending', 2, false)).toBe(false);
    expect(predictNoop(list, 'synced', 3, false)).toBe(false);
  });

  it('titles saved versions by name and others by the engine summary', () => {
    expect(versionTitle(version({ version: 3, kind: 'save', name: '送审的版本' }))).toBe('送审的版本');
    expect(versionTitle(version({ version: 2, summary: 'Trim clip' }))).toBe('Trim clip');
  });

  it('groups actions by actor and names actors', () => {
    const groups = actorGroups([
      { actor: 'user_local', label: 'Trim clip', count: 5 },
      { actor: 'agent:conv_1', label: 'Cut pauses', count: 1 },
      { actor: 'user_local', label: 'Edit text', count: 2 },
    ]);
    expect(groups.map((g) => [g.kind, g.label, g.items])).toEqual([
      ['user', '你', 'Trim clip ×5、Edit text ×2'],
      ['agent', '智能体', 'Cut pauses'],
    ]);
    expect(actorLabel('external:mcp')).toBe('外部服务 mcp');
    expect(actorLabel('system:jobs')).toBe('BaoCut');
  });

  it('names snapshot files and their changes', () => {
    const documents = { doc_1: { id: 'doc_1', kind: 'speech', name: '文稿', currentRevision: '1', revisions: {} } };
    expect(fileLabel('video.json', documents)).toBe('时间线');
    expect(fileLabel('documents/doc_1.json', documents)).toBe('文稿');
    expect(fileLabel('documents/doc_9.json', documents)).toBe('文档');
    expect(fileChange({ before: null, after: 'x' })).toBe('add');
    expect(fileChange({ before: 'x', after: null })).toBe('delete');
    expect(versionFileName(12)).toBe('history/000012.patch');
  });

  it('describes the entry button', () => {
    expect(buttonTip(true, { state: 'synced', latestVersion: 14 })).toBe('历史 · 最新是版本 14');
    expect(buttonTip(true, { state: 'conflict', conflict: 'both-changed', latestVersion: 14 })).toBe('历史 · 最新是版本 14 · 快照和 BaoCut 都改过');
    expect(buttonTip(true, { state: 'conflict', conflict: 'invalid', latestVersion: 14 })).toBe('历史 · 最新是版本 14 · 快照读不出');
    expect(buttonTip(true, { state: 'external', latestVersion: 14 })).toBe('历史 · 最新是版本 14 · 正在导入外部改动');
    expect(buttonTip(true, { state: 'missing' })).toBe('历史 · 还没有版本 · 还没有快照');
    expect(buttonTip(false, null)).toBe('历史 · 这部视频不在项目里');
    expect(buttonTip(true, { state: 'synced', latestVersion: 14 }, '327')).toBe('历史 · 修订 327 · 最新是版本 14');
    expect(buttonTip(false, null, '12')).toBe('历史 · 修订 12 · 这部视频不在项目里');
  });

  it('names the snapshot states, telling the two conflict reasons apart', () => {
    expect(snapshotState({ state: 'conflict', conflict: 'both-changed' })).toMatchObject({ label: '快照和 BaoCut 都改过', tone: 'negative' });
    expect(snapshotState({ state: 'conflict', conflict: 'invalid' })).toMatchObject({ label: '快照读不出', tone: 'negative' });
    // 旧的 Runtime 不带原因时按两边都改了说。
    expect(snapshotState({ state: 'conflict' }).label).toBe('快照和 BaoCut 都改过');
    expect(snapshotState({ state: 'external' })).toMatchObject({ label: '正在导入外部改动', tone: 'informative' });
  });

  it('recognizes a Runtime import of an external change, but not its undo or other system changes', () => {
    expect(isImportChange({ actorId: 'system:history' })).toBe(true);
    expect(isImportChange({ actorId: 'system:history', undoOf: 'tx_1' })).toBe(false);
    expect(isImportChange({ actorId: 'system:asr' })).toBe(false);
    expect(isImportChange({ actorId: 'user_local' })).toBe(false);
    expect(isImportChange(null)).toBe(false);
  });

  it('says what each conflict choice loses', () => {
    const docs = { doc_1: { name: '字幕' } } as unknown as Parameters<typeof resolveAsk>[2];
    const status = { conflict: 'both-changed' as const, changedPaths: ['video.json', 'documents/doc_1.json'] };
    const keep = resolveAsk('video', status, docs);
    expect(keep).toMatchObject({ title: '保留 BaoCut 里的？', confirm: '覆盖磁盘上的', destructive: true });
    expect(keep.body).toContain('覆盖磁盘上被改过的 2 个文件（时间线、字幕）');
    expect(keep.body).toContain('不进版本记录');
    const disk = resolveAsk('snapshot', status, docs);
    expect(disk).toMatchObject({ title: '用磁盘上的？', confirm: '用磁盘上的', destructive: false });
    expect(disk.body).toContain('回到「外部变更」之前就能找回');
    expect(resolveAsk('video', { conflict: 'invalid', changedPaths: ['video.json'] }, docs).body).toContain('覆盖磁盘上读不出的 1 个文件（时间线）');
  });

  it('splits a unified diff into files and hunks by the hunk line counts', () => {
    const files = parseUnifiedDiff(
      [
        '--- a/video.json',
        '+++ b/video.json',
        '@@ -7,4 +7,3 @@',
        ' 7',
        '--- not a header',
        '-10',
        '+ten',
        ' 11',
        '--- /dev/null',
        '+++ b/documents/d.json',
        '@@ -0,0 +1,2 @@',
        '+{',
        '+}',
        '',
      ].join('\n'),
    );
    expect(files.map((f) => [f.path, f.change, f.plus, f.minus, f.hunks.length])).toEqual([
      ['video.json', 'modify', 1, 2, 1],
      ['documents/d.json', 'add', 2, 0, 1],
    ]);
    expect(files[0]!.hunks[0]!.lines.map((l) => l.sign + l.text)).toEqual([' 7', '--- not a header', '-10', '+ten', ' 11']);
    expect(parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -3 +3 @@\n-a\n+b\n')[0]!.hunks[0]!.lines).toHaveLength(2);
  });

  it('reads the code and break point from a refused write', () => {
    const broken = new RpcError('conflict', 'x', {
      code: 'VERSION_CHAIN_BROKEN',
      message: 'The version history does not match at version 4',
      entityIds: [],
      inputRevisions: [],
      retryability: 'never',
      details: { brokenAt: 4 },
    });
    expect(versionError(broken)).toMatchObject({ code: 'VERSION_CHAIN_BROKEN', brokenAt: 4 });
    const outside = new RpcError('invalid-request', '只有项目里的视频才有版本记录', { code: 'VERSIONS_NEED_PROJECT' });
    expect(versionError(outside)).toMatchObject({ code: 'VERSIONS_NEED_PROJECT', brokenAt: null, message: '只有项目里的视频才有版本记录' });
  });
});
