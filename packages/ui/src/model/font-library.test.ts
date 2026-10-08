import { describe, expect, it } from 'vitest';
import type { FontFamilyStatus, FontUsageFamily } from '@baocut/protocol';
import { job } from '../testing/task-records.ts';
import {
  batchFamilies,
  catalogueCount,
  clearConfirmBody,
  clearedText,
  detailRows,
  downloadedList,
  exportFontFallbacks,
  exportOtherWarnings,
  exportFontNote,
  exportFontPhase,
  familyKey,
  fontBar,
  fontSections,
  liveFontJobs,
  liveRow,
  mirrorError,
  fontError,
  fontLabel,
  orderKey,
  pickToast,
  pickerRows,
  removeToast,
  progressText,
  pushRecent,
  rowEnd,
  type FontBatch,
  type FontRow,
} from './font-library.ts';

const status = (family: string, patch: Partial<FontFamilyStatus> = {}): FontFamilyStatus => ({
  family,
  state: 'downloadable',
  category: 'sans-serif',
  subsets: ['latin'],
  scripts: ['latin'],
  weights: [400, 700],
  italics: [],
  variable: false,
  licence: 'OFL-1.1',
  source: 'google-fonts',
  downloaded: [],
  job: null,
  error: null,
  ...patch,
});

const row = (family: string, patch: Partial<FontFamilyStatus> = {}): FontRow => liveRow(status(family, patch), undefined);
const byName = (rows: FontRow[]) => new Map(rows.map((r) => [familyKey(r.family), r]));

describe('字体库', () => {
  it('在跑的 fontDownload 任务叠上字节进度；导出里的下载用状态里的字节数', () => {
    const jobs = [
      job({
        jobId: 'j1',
        kind: 'fontDownload',
        modelId: 'Lobster',
        phase: 'downloading',
        progress: { done: 50, total: 200, unit: 'bytes' },
      }),
      job({ jobId: 'j2', kind: 'fontDownload', modelId: 'Roboto', state: 'completed', endedAt: '2026-10-01T09:01:00Z' }),
    ];
    const live = liveFontJobs(jobs);
    expect([...live.keys()]).toEqual(['lobster']);
    const lobster = liveRow(status('Lobster'), live.get('lobster'));
    expect(lobster).toMatchObject({ state: 'downloading', progress: { done: 50, total: 200 } });
    expect(rowEnd(lobster)).toEqual({ kind: 'progress', label: '25%', value: 25 });
    const exporting = liveRow(
      status('Ma Shan Zheng', { state: 'downloading', job: { jobId: 'e1', doneBytes: 2048, totalBytes: null } }),
      undefined,
    );
    expect(rowEnd(exporting)).toEqual({ kind: 'progress', label: '2 KB', value: null });
    expect(progressText(null)).toBe('');
    expect(progressText({ done: 0, total: null })).toBe('');
  });

  it('「等待中」只给排在同时下载上限后面的任务；马上开始、还没收到字节的念「下载中」', () => {
    const fontJob = (patch: Parameters<typeof job>[0]) => job({ kind: 'fontDownload', modelId: 'Lobster', ...patch });
    const since = '2026-10-04T00:00:00Z';
    const states = {
      // 刚提交、同一刻就开始的任务先发一条不带 `wait` 的 queued。
      submitted: liveRow(status('Lobster'), fontJob({ jobId: 'j1', state: 'queued', phase: 'queued' })),
      // 开始了：Runtime 先报 0 字节、不知道总大小（还在取样式表）。
      started: liveRow(
        status('Lobster'),
        fontJob({ jobId: 'j1', phase: 'downloading', progress: { done: 0, total: null, unit: 'bytes' } }),
      ),
      // 排在上限后面（同时下两个）。
      waiting: liveRow(
        status('Lobster'),
        fontJob({ jobId: 'j3', state: 'queued', phase: 'queued', wait: { reason: 'concurrency', ahead: 0, detail: '前面有 2 个', since } }),
      ),
      // `fonts.download` 的回应先到、任务记录还没到：状态是下载中，没有字节。
      statusOnly: liveRow(status('Lobster', { state: 'downloading', job: { jobId: 'j1', doneBytes: 0, totalBytes: null } }), undefined),
    };
    expect(Object.fromEntries(Object.entries(states).map(([k, r]) => [k, [r.state, r.waiting, rowEnd(r)]]))).toEqual({
      submitted: ['downloading', false, { kind: 'progress', label: '下载中', value: null }],
      started: ['downloading', false, { kind: 'progress', label: '下载中', value: null }],
      waiting: ['downloading', true, { kind: 'progress', label: '等待中', value: null }],
      statusOnly: ['downloading', false, { kind: 'progress', label: '下载中', value: null }],
    });
    // 详情的状态行不重复念「下载中」；等待中照念。
    expect(detailRows(states.started)[0]).toEqual(['状态', '下载中']);
    expect(detailRows(states.waiting)[0]).toEqual(['状态', '下载中 · 等待中']);
    // 字体条：当前这一个马上开始时念「下载中」，排着的念「等待中」。
    const batch: FontBatch = { videoId: 'v1', families: ['Lobster'], mode: 'auto', skipped: [], dismissed: false };
    const bar = (r: FontRow) => fontBar(batch, byName([r]), () => 'Noto Sans SC');
    expect(bar(states.submitted)).toMatchObject({ kind: 'running', progress: '下载中', value: null });
    expect(bar(states.started)).toMatchObject({ kind: 'running', progress: '下载中', value: null });
    expect(bar(states.statusOnly)).toMatchObject({ kind: 'running', progress: '下载中', value: null });
    expect(bar(states.waiting)).toMatchObject({ kind: 'running', progress: '等待中', value: null });
  });

  it('行尾：标签、下载、进度、失败与已取消（重试）', () => {
    expect(rowEnd(row('Inter', { state: 'built-in', source: 'built-in' }))).toEqual({ kind: 'badge', label: '内置' });
    expect(rowEnd(row('Roboto', { state: 'installed', source: 'local' }))).toEqual({ kind: 'badge', label: '本机' });
    expect(rowEnd(row('Lobster', { state: 'downloaded' }))).toEqual({ kind: 'badge', label: '已下载', tone: 'positive' });
    expect(rowEnd(row('Lobster'))).toEqual({ kind: 'download' });
    const at = '2026-10-04T00:00:00Z';
    expect(rowEnd(row('A', { state: 'failed', error: { code: 'FONT_DOWNLOAD_NETWORK', message: '连不上字体服务', at } }))).toEqual({
      kind: 'retry',
      label: '失败',
      message: '连不上字体服务',
    });
    expect(rowEnd(row('A', { state: 'failed', error: { code: 'CANCELLED', message: '下载已取消', at } }))).toEqual({
      kind: 'retry',
      label: '已取消',
      message: '已取消',
    });
    expect(rowEnd(row('Nowhere', { state: 'unavailable', source: 'local', category: null }))).toEqual({
      kind: 'badge',
      label: '没有这个字体',
    });
  });

  it('分段：视频里用到、最近用过、全部；检索或筛选时合成搜索结果；打开时的次序冻结住', () => {
    const rows = [
      row('Inter', { state: 'built-in', source: 'built-in' }),
      row('Lobster', { category: 'display' }),
      row('Ma Shan Zheng', { category: 'handwriting', scripts: ['chinese', 'latin'] }),
      row('PingFang SC', { state: 'installed', source: 'local', category: null, scripts: [] }),
    ];
    const frozen = orderKey(rows);
    // 下载完的 Lobster 不在光标底下挪到前面：仍按打开时的次序。
    const later = [row('Lobster', { state: 'downloaded' }), ...rows.filter((r) => r.family !== 'Lobster')];
    const secs = fontSections(later, { inVideo: ['ma shan zheng', 'Nowhere'], recent: ['Lobster', 'Inter'], frozen });
    expect(secs.map((s) => [s.key, s.title, s.rows.map((r) => r.family)])).toEqual([
      ['video', '这个视频里用到', ['Ma Shan Zheng']],
      ['recent', '最近用过', ['Lobster', 'Inter']],
      ['all', '全部字体', ['Inter', 'Lobster', 'Ma Shan Zheng', 'PingFang SC']],
    ]);
    expect(fontSections(rows, { script: 'chinese' }).map((s) => [s.title, s.rows.map((r) => r.family)])).toEqual([
      ['搜索结果', ['Ma Shan Zheng']],
    ]);
    expect(fontSections(rows, { query: ' lob ', category: 'display' })[0]!.rows.map((r) => r.family)).toEqual(['Lobster']);
    expect(fontSections(rows, { query: 'zzz' })[0]!.rows).toEqual([]);
    expect(catalogueCount(rows)).toBe(3);
  });

  it('选中还没下载的族：提示先用回退字体，中日韩的给取消下载', () => {
    expect(pickToast(status('Lobster'))).toEqual({
      text: '「Lobster」下载好之前先用「Noto Sans SC」显示，下载好后自动换上',
      cancellable: false,
    });
    expect(pickToast(status('Ma Shan Zheng', { scripts: ['chinese', 'latin'] })).cancellable).toBe(true);
    expect(pushRecent(['A', 'B', 'lobster'], 'Lobster')).toEqual(['Lobster', 'A', 'B']);
  });

  it('详情：状态、来源、分类、字重、大小（下载之后）与许可', () => {
    const f = row('Lobster', {
      state: 'downloaded',
      italics: [400],
      downloaded: [{ weight: 400, italic: false, sizeBytes: 3 * 1024 * 1024 }],
    });
    expect(detailRows(f)).toEqual([
      ['状态', '已下载'],
      ['来源', 'Google Fonts'],
      ['分类', '无衬线 · 拉丁'],
      ['字重', '400 · 700（有斜体）'],
      ['大小', '已下载 3.0 MB'],
      ['许可', 'SIL Open Font License 1.1'],
    ]);
    const local = row('PingFang SC', { state: 'installed', source: 'local', category: null, scripts: [], weights: [], licence: null });
    expect(detailRows(local)).toEqual([
      ['状态', '本机'],
      ['来源', '本机已装'],
      ['许可', '未知（本机字体，请自行确认能否用于发布）'],
    ]);
  });

  it('镜像地址只接受 https，不带账号、查询参数与片段；空的用默认', () => {
    expect(mirrorError('')).toBeNull();
    expect(mirrorError('https://fonts.example.cn/google')).toBeNull();
    expect(mirrorError('fonts.example.cn')).toBe('不是有效的地址');
    expect(mirrorError('http://fonts.example.cn')).toBe('只接受 https:// 开头的地址');
    expect(mirrorError('https://me:pw@fonts.example.cn')).toBe('地址里不能带账号或密码');
    expect(mirrorError('https://fonts.example.cn/?a=1')).toBe('地址里不能带查询参数或 #');
    expect(mirrorError('https://fonts.example.cn/#x')).toBe('地址里不能带查询参数或 #');
  });

  it('设置里的已下载列表：每个族一行，导出在用的标出来；清空的结果按族数', () => {
    const face = (family: string, weight: number, sizeBytes: number, downloadedAt: string) => ({
      family,
      weight,
      italic: false,
      licence: 'OFL-1.1' as const,
      sha256: '0',
      sizeBytes,
      downloadedAt,
    });
    const { rows, totalBytes } = downloadedList(
      [face('Lobster', 700, 100, '2026-10-02'), face('Lobster', 400, 200, '2026-10-03'), face('Abel', 400, 50, '2026-10-01')],
      ['lobster'],
    );
    expect(rows).toEqual([
      { family: 'Abel', weights: '400', sizeBytes: 50, licence: 'OFL-1.1', at: '2026-10-01', inUse: false },
      { family: 'Lobster', weights: '400 · 700', sizeBytes: 300, licence: 'OFL-1.1', at: '2026-10-03', inUse: true },
    ]);
    expect(totalBytes).toBe(350);
    expect(clearConfirmBody(rows, totalBytes)).toBe(
      '删除 2 个族、共 350 B。用到它们的视频先用回退字体显示，需要时再下载。还没结束的导出在用的会留下。',
    );
    expect(clearedText([{ family: 'Abel' }], 50, [{ family: 'Lobster' }, { family: 'Lobster' }])).toBe(
      '已清空 1 个族，释放 50 B · 导出在用的 1 个留下',
    );
    expect(clearedText([], 0, [])).toBe('已清空 0 个族，释放 0 B');
  });

  it('字体条：进行中念第几个与进度，全到了说已就绪，没取到列出回退与原因（跳过、取消、失败），自动下载关着时可以下载', () => {
    const fallback = () => 'Noto Sans SC';
    const batch: FontBatch = { videoId: 'v1', families: ['Lobster', 'Ma Shan Zheng'], mode: 'auto', skipped: [], dismissed: false };
    const at = '2026-10-04T00:00:00Z';
    const running = byName([
      row('Lobster', { state: 'downloaded' }),
      liveRow(status('Ma Shan Zheng', { state: 'downloading', job: { jobId: 'j', doneBytes: 42, totalBytes: 100 } }), undefined),
    ]);
    expect(fontBar(batch, running, fallback)).toEqual({
      kind: 'running',
      title: '正在下载这个视频用到的字体',
      count: '2/2',
      current: 'Ma Shan Zheng',
      progress: '42%',
      value: 42,
    });
    const ready = byName([row('Lobster', { state: 'downloaded' }), row('Ma Shan Zheng', { state: 'downloaded' })]);
    expect(fontBar(batch, ready, fallback)).toEqual({ kind: 'ready', title: '这个视频用到的 2 个字体已就绪' });
    const missed = byName([
      row('Lobster', { state: 'failed', error: { code: 'CANCELLED', message: '下载已取消', at } }),
      row('Ma Shan Zheng', { state: 'failed', error: { code: 'FONT_DOWNLOAD_NETWORK', message: '连不上字体服务（重试了 3 次）', at } }),
    ]);
    expect(fontBar({ ...batch, skipped: ['Lobster'] }, missed, fallback)).toEqual({
      kind: 'missed',
      title: '2 个字体没取到，正在用回退字体显示',
      rows: [
        { family: 'Lobster', fallback: 'Noto Sans SC', reason: '已跳过' },
        { family: 'Ma Shan Zheng', fallback: 'Noto Sans SC', reason: '连不上字体服务（重试了 3 次）' },
      ],
    });
    expect((fontBar(batch, missed, fallback) as { rows: { reason: string }[] }).rows[0]!.reason).toBe('已取消');
    const idle = byName([row('Lobster'), row('Ma Shan Zheng')]);
    expect(fontBar({ ...batch, mode: 'off' }, idle, fallback)).toEqual({
      kind: 'off',
      title: '这个视频用到 2 个没下载的字体，正在用回退字体显示',
      rows: [
        { family: 'Lobster', fallback: 'Noto Sans SC', reason: '自动下载已关闭' },
        { family: 'Ma Shan Zheng', fallback: 'Noto Sans SC', reason: '自动下载已关闭' },
      ],
    });
    expect(fontBar({ ...batch, dismissed: true }, idle, fallback)).toBeNull();
  });

  it('打开视频的一批只算字体目录里有、此刻画不出来的族', () => {
    const usage = (family: string, patch: Partial<FontFamilyStatus>, fallback: string | null): FontUsageFamily => ({
      family,
      faces: [{ weight: 400, italic: false }],
      status: status(family, patch),
      fallback,
    });
    expect(
      batchFamilies([
        usage('Inter', { state: 'built-in', source: 'built-in' }, null),
        usage('Lobster', {}, 'Noto Sans SC'),
        usage('Nowhere', { state: 'unavailable', source: 'local', category: null }, 'Noto Sans SC'),
        usage('Abel', { state: 'downloaded' }, null),
      ]),
    ).toEqual(['Lobster']);
  });

  it('导出面板的字体提示：在下载的先等，失败的用回退代替（重试），没下载的按自动下载开关说', () => {
    const at = '2026-10-04T00:00:00Z';
    const usage: FontUsageFamily[] = [
      { family: 'A', faces: [], status: status('A', { state: 'downloading' }), fallback: 'Noto Sans SC' },
      {
        family: 'B',
        faces: [],
        status: status('B', { state: 'failed', error: { code: 'FONT_DOWNLOAD_SOURCE', message: 'x', at } }),
        fallback: 'Noto Sans SC',
      },
      { family: 'C', faces: [], status: status('C'), fallback: 'Noto Sans SC' },
      { family: 'Inter', faces: [], status: status('Inter', { state: 'built-in', source: 'built-in' }), fallback: null },
    ];
    const rows = byName(usage.map((u) => liveRow(u.status, undefined)));
    expect(exportFontNote(usage, rows, true)).toEqual([
      { tone: 'info', families: ['A'], text: '「A」还在下载 · 导出会先等它下载完再开始画' },
      { tone: 'notice', families: ['B'], action: '重试', text: '「B」没下载成功 · 会用「Noto Sans SC」代替导出' },
      { tone: 'info', families: ['C'], action: '现在下载', text: '「C」还没下载 · 导出开始时先下载，下载不成就用回退字体' },
    ]);
    expect(exportFontNote(usage, rows, false)[2]).toEqual({
      tone: 'notice',
      families: ['C'],
      action: '下载',
      text: '「C」没有下载（自动下载已关闭）· 会用回退字体导出',
    });
  });

  it('导出完成：没取到的族按族列出回退与原因；准备阶段念下载字体与百分比', () => {
    const font = (family: string, weight: number, reason: string) => ({ family, weight, italic: false, fallback: 'Noto Sans SC', reason });
    expect(
      exportFontFallbacks([
        { code: 'FONT_NOT_DOWNLOADED', detail: '…', font: font('Lobster', 400, '下载失败：连不上') },
        { code: 'FONT_NOT_DOWNLOADED', detail: '…', font: font('Lobster', 700, '下载失败：连不上') },
        { code: 'FONT_NOT_DOWNLOADED', detail: '「Abel」400：自动下载字体已关闭，照回退字体画' },
        { code: 'EXPORT_SIZE_ADJUSTED', detail: 'x' },
      ]),
    ).toBe('「Lobster」用「Noto Sans SC」代替 · 下载失败：连不上；「Abel」400：自动下载字体已关闭，照回退字体画');
    expect(exportFontFallbacks([])).toBeNull();
    // 其余提醒：内核对已列出的族报的缺字体提示不再重复，别的族照留。
    const note = (family: string) => ({
      code: 'EXPORT_RENDER_NOTE',
      detail: `item_a：字体 "${family}" 在当前字体库中不可用，将使用 Noto Sans SC fallback`,
    });
    expect(
      exportOtherWarnings([
        { code: 'FONT_NOT_DOWNLOADED', detail: '…', font: font('Long Cang', 400, '自动下载已关闭') },
        note('Long Cang'),
        note('Nowhere Sans'),
        { code: 'EXPORT_SIZE_ADJUSTED', detail: 'x' },
      ]).map((w) => w.detail),
    ).toEqual([note('Nowhere Sans').detail, 'x']);
    const exporting = job({ jobId: 'e', kind: 'export', phase: 'downloading', progress: { done: 42, total: 100, unit: 'bytes' } });
    expect(exportFontPhase(exporting, [status('Ma Shan Zheng')])).toBe('下载字体 · Ma Shan Zheng 42%');
    expect(exportFontPhase({ ...exporting, progress: null }, [])).toBe('下载字体');
    expect(exportFontPhase({ ...exporting, phase: 'generating' }, [])).toBeNull();
  });

  it('选字框的整表：系统字体在最前，Runtime 的次序，现值不在表里时补一行「没有这个字体」', () => {
    const statuses = { inter: status('Inter', { state: 'built-in', source: 'built-in' }), lobster: status('Lobster') };
    const rows = pickerRows(statuses, ['inter', 'lobster'], 'Lobster');
    expect(rows.map((f) => [f.family, f.state])).toEqual([
      ['system', 'built-in'],
      ['Inter', 'built-in'],
      ['Lobster', 'downloadable'],
    ]);
    expect(pickerRows(statuses, ['inter', 'lobster'], 'Kaiti SC').at(-1)).toMatchObject({
      family: 'Kaiti SC',
      state: 'unavailable',
      category: null,
    });
    expect(pickerRows(statuses, ['inter'], 'system')).toHaveLength(2);
    expect(fontLabel('system')).toBe('系统字体');
    expect(fontLabel('Inter')).toBe('Inter');
  });

  it('删除下载的文件：成功、导出在用（FONT_IN_USE）与其他拒绝', () => {
    expect(removeToast('Lobster', null)).toEqual({ text: '已删除「Lobster」下载的字体', tone: 'neutral' });
    const inUse = { message: '「Lobster」正被还没结束的导出使用，导出结束后再删', details: { code: 'FONT_IN_USE', family: 'Lobster' } };
    expect(removeToast('Lobster', inUse)).toEqual({ text: '还没结束的导出在用「Lobster」· 导出结束后再删', tone: 'notice' });
    expect(removeToast('Lobster', new Error('磁盘出错'))).toEqual({ text: '磁盘出错', tone: 'notice' });
    expect(fontError({ message: '严格离线模式下不下载字体', details: { code: 'OFFLINE_STRICT' } })).toEqual({
      code: 'OFFLINE_STRICT',
      message: '严格离线模式下不下载字体',
    });
  });
});
