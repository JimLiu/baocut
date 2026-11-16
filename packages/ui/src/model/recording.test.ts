import { RECORDING_DEFAULTS, type RecordingSources, type RecordingSummary } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import {
  autoOpenWaiting,
  choiceFromOptions,
  choiceOptions,
  DEFAULT_CHOICE,
  formatElapsed,
  LOW_DISK_MINUTES,
  lowDisk,
  recordingBytesPerSecond,
  recordingEntry,
  resolveChoice,
  shouldOpenAfter,
  sourceBlocks,
  startBlock,
  startFromShortcut,
  unavailableCode,
  unfinishedRecordings,
  type SourcesState,
} from './recording.ts';

const sources = (over: Partial<RecordingSources> = {}): RecordingSources => ({
  platform: 'darwin',
  available: true,
  reason: null,
  permissions: { screen: 'granted', camera: 'granted', microphone: 'granted', inputMonitoring: 'not-determined' },
  displays: [{ id: '1', name: 'Built-in', width: 1512, height: 982, scale: 2, primary: true }],
  windows: [{ id: 'w1', title: 'Doc', app: 'Notes', width: 800, height: 600 }],
  cameras: [{ id: 'cam1', name: 'FaceTime HD Camera' }],
  microphones: [{ id: 'mic1', name: 'MacBook Pro Microphone', default: true }],
  ...over,
});

const rec = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  recordingId: 'rec_1',
  state: 'waiting',
  jobId: 'job_1',
  options: RECORDING_DEFAULTS,
  target: { create: { conversationId: 'conv_1' } },
  requestedBy: { conversationId: 'conv_1' },
  createdAt: '2026-11-15T10:00:00.000Z',
  startedAt: null,
  elapsed: 0,
  streams: [],
  videoId: null,
  unfinished: false,
  dir: '/tmp/rec_1',
  error: null,
  result: null,
  ...over,
});

const ready = (s = sources()): SourcesState => ({ status: 'ready', sources: s });

describe('recordingEntry', () => {
  it('Web 与没有录制能力的宿主不显示入口', () => {
    expect(recordingEntry({ platform: 'web', hostCapable: true, sources: ready(), recordings: [] })).toEqual({ kind: 'hidden' });
    expect(recordingEntry({ platform: 'darwin', hostCapable: false, sources: ready(), recordings: [] })).toEqual({ kind: 'hidden' });
  });

  it('远程 Runtime、平台不支持时置灰并带原因', () => {
    const remote: SourcesState = { status: 'error', code: 'RECORDING_UNAVAILABLE', reason: 'remote', message: 'x' };
    expect(recordingEntry({ platform: 'darwin', hostCapable: true, sources: remote, recordings: [] })).toEqual({ kind: 'disabled', block: { kind: 'remote' } });
    const win = ready(sources({ platform: 'win32', available: false, reason: 'Windows capture is not implemented yet.' }));
    expect(recordingEntry({ platform: 'win32', hostCapable: true, sources: win, recordings: [] })).toEqual({
      kind: 'disabled',
      block: { kind: 'unsupported', code: null, text: 'Windows capture is not implemented yet.' },
    });
  });

  it('录不了的原因码：先看 unavailable.code，再看 reason 本身是不是码；remote 当成远程', () => {
    const coded = sources({ available: false, reason: 'Recorder missing.', unavailable: { code: 'worker-missing', message: 'Recorder missing.' } });
    expect(unavailableCode(coded)).toBe('no-worker');
    expect(recordingEntry({ platform: 'darwin', hostCapable: true, sources: ready(coded), recordings: [] })).toEqual({
      kind: 'disabled',
      block: { kind: 'unsupported', code: 'no-worker', text: 'Recorder missing.' },
    });
    expect(unavailableCode(sources({ available: false, reason: 'no-window' }))).toBe('no-window');
    expect(recordingEntry({ platform: 'darwin', hostCapable: true, sources: ready(sources({ available: false, reason: 'no-window' })), recordings: [] })).toEqual({
      kind: 'disabled',
      block: { kind: 'unsupported', code: 'no-window', text: null },
    });
    expect(recordingEntry({ platform: 'darwin', hostCapable: true, sources: ready(sources({ available: false, reason: 'remote' })), recordings: [] })).toEqual({
      kind: 'disabled',
      block: { kind: 'remote' },
    });
    expect(unavailableCode(sources({ available: false, reason: 'Some text.' }))).toBeNull();
  });

  it('已有一次在录时置灰；还没问到来源时照常可点', () => {
    expect(recordingEntry({ platform: 'darwin', hostCapable: true, sources: ready(), recordings: [rec({ state: 'recording' })] })).toEqual({
      kind: 'disabled',
      block: { kind: 'busy' },
    });
    expect(recordingEntry({ platform: 'darwin', hostCapable: true, sources: { status: 'idle' }, recordings: [rec({ state: 'in-timeline' })] })).toEqual({
      kind: 'ready',
    });
  });
});

describe('resolveChoice', () => {
  it('记下的设备不在了退回「不用」并提示，窗口不在了退回整块屏幕', () => {
    const { choice, notices } = resolveChoice(
      { ...DEFAULT_CHOICE, camera: 'gone', cameraName: 'Old Cam', microphone: 'gone-mic', source: 'window', windowId: 'w9', displayId: 'x' },
      sources(),
    );
    expect(choice).toMatchObject({ camera: null, microphone: null, source: 'display', windowId: null, displayId: null });
    expect(notices.map((n) => n.kind)).toEqual(['camera-gone', 'microphone-gone', 'window-gone']);
    expect(notices[0]).toEqual({ kind: 'camera-gone', name: 'Old Cam' });
  });

  it('设备都在、系统默认麦克风不提示；区域退回整块屏幕', () => {
    const { choice, notices } = resolveChoice({ ...DEFAULT_CHOICE, camera: 'cam1', source: 'area' }, sources());
    expect(notices).toEqual([]);
    expect(choice).toMatchObject({ camera: 'cam1', microphone: 'default', source: 'display' });
  });
});

describe('一个区域', () => {
  const area = { displayId: '1', rect: { x: 100, y: 50, width: 640, height: 360 } };
  const picker = { areaPicker: true };

  it('宿主有选框时区域可选；没有时置灰', () => {
    expect(sourceBlocks(sources(), picker).area).toBeNull();
    expect(sourceBlocks(sources({ displays: [] }), picker).area).toEqual({ kind: 'no-display' });
    expect(sourceBlocks(sources()).area).toEqual({ kind: 'no-area-picker' });
  });

  it('记下的区域还在屏幕里就照用；屏幕不在了或框出了屏幕时丢掉并提示；还没框时退回整块屏幕', () => {
    expect(resolveChoice({ ...DEFAULT_CHOICE, source: 'area', area }, sources(), picker)).toEqual({ choice: { ...DEFAULT_CHOICE, source: 'area', area }, notices: [] });
    const gone = resolveChoice({ ...DEFAULT_CHOICE, source: 'area', area: { ...area, displayId: '9' } }, sources(), picker);
    expect(gone.choice).toMatchObject({ source: 'display', area: null });
    expect(gone.notices).toEqual([{ kind: 'area-gone' }]);
    const outside = resolveChoice({ ...DEFAULT_CHOICE, source: 'area', area: { displayId: null, rect: { x: 1000, y: 0, width: 640, height: 360 } } }, sources(), picker);
    expect(outside.choice.source).toBe('display');
    expect(resolveChoice({ ...DEFAULT_CHOICE, source: 'area' }, sources(), picker)).toEqual({ choice: DEFAULT_CHOICE, notices: [] });
    // 宿主没有选框：记下的区域留着（下次在桌面端还能用），来源退回整块屏幕。
    expect(resolveChoice({ ...DEFAULT_CHOICE, source: 'area', area }, sources()).choice).toMatchObject({ source: 'display', area });
  });

  it('选了区域还没框时不能开始；框好了换成 area 来源', () => {
    expect(startBlock({ ...DEFAULT_CHOICE, source: 'area' }, sources())).toEqual({ kind: 'no-area' });
    expect(startBlock({ ...DEFAULT_CHOICE, source: 'area', area }, sources())).toEqual({ kind: 'ok' });
    expect(choiceOptions({ ...DEFAULT_CHOICE, source: 'area', area }).source).toEqual({ kind: 'area', displayId: '1', rect: area.rect });
    expect(choiceOptions({ ...DEFAULT_CHOICE, source: 'area', area: { ...area, displayId: null } }).source).toEqual({ kind: 'area', rect: area.rect });
    expect(choiceOptions({ ...DEFAULT_CHOICE, source: 'area', area }).includeSelf).toBe(false);
  });

  it('智能体给的区域落到面板上；码率按框的大小估', () => {
    const choice = choiceFromOptions({ ...RECORDING_DEFAULTS, source: { kind: 'area', displayId: '1', rect: area.rect } }, DEFAULT_CHOICE);
    expect(choice).toMatchObject({ source: 'area', area });
    const screenOnly = { ...DEFAULT_CHOICE, microphone: null };
    expect(recordingBytesPerSecond({ ...screenOnly, source: 'area', area }, sources())).toBeCloseTo((640 * 360 * 4 * 30 * 0.15) / 8);
  });
});

describe('选项能不能选与开始', () => {
  it('区域没有选框时置灰；没有窗口时窗口置灰', () => {
    expect(sourceBlocks(sources({ windows: [] }))).toEqual({ display: null, window: { kind: 'no-window' }, area: { kind: 'no-area-picker' } });
  });

  it('屏幕被拒时开始不可用；可选的一路被拒时去掉它才能开始；还没问过的不挡', () => {
    const denied = (p: Partial<RecordingSources['permissions']>) => sources({ permissions: { ...sources().permissions, ...p } });
    expect(startBlock(DEFAULT_CHOICE, denied({ screen: 'denied' }))).toEqual({ kind: 'permission', missing: ['screen'], required: true });
    const withCam = { ...DEFAULT_CHOICE, camera: 'cam1' };
    expect(startBlock(withCam, denied({ camera: 'denied' }))).toEqual({ kind: 'permission', missing: ['camera'], required: false });
    expect(startBlock({ ...withCam, camera: null }, denied({ camera: 'denied' }))).toEqual({ kind: 'ok' });
    expect(startBlock({ ...DEFAULT_CHOICE, keys: 'all' }, denied({ inputMonitoring: 'not-determined' }))).toEqual({ kind: 'ok' });
    expect(startBlock(DEFAULT_CHOICE, sources({ available: false }))).toEqual({ kind: 'unavailable' });
  });

  it('选择换成 start 的选项：不要光标时关掉自动缩放；窗口带上窗口 ID', () => {
    expect(choiceOptions({ ...DEFAULT_CHOICE, cursor: 'none' })).toMatchObject({ cursor: 'none', autoZoom: false, source: { kind: 'display' } });
    expect(choiceOptions({ ...DEFAULT_CHOICE, source: 'window', windowId: 'w1', displayId: '1' }).source).toEqual({ kind: 'window', windowId: 'w1' });
    expect(choiceOptions({ ...DEFAULT_CHOICE, displayId: '2' }).source).toEqual({ kind: 'display', displayId: '2' });
  });

  it('「把 BaoCut 也录进去」缺省关；整屏送 includeSelf，单个窗口不送', () => {
    expect(DEFAULT_CHOICE.includeSelf).toBe(false);
    expect(choiceOptions(DEFAULT_CHOICE).includeSelf).toBe(false);
    expect(choiceOptions({ ...DEFAULT_CHOICE, includeSelf: true }).includeSelf).toBe(true);
    expect(choiceOptions({ ...DEFAULT_CHOICE, source: 'window', windowId: 'w1', includeSelf: true })).not.toHaveProperty('includeSelf');
    expect(choiceFromOptions({ ...RECORDING_DEFAULTS, includeSelf: true }, DEFAULT_CHOICE).includeSelf).toBe(true);
    expect(choiceFromOptions(RECORDING_DEFAULTS, { ...DEFAULT_CHOICE, includeSelf: true }).includeSelf).toBe(false);
  });

  it('智能体填好的选项落到面板的选择上', () => {
    const choice = choiceFromOptions({ ...RECORDING_DEFAULTS, source: { kind: 'window', windowId: 'w1' }, camera: 'cam1', keys: 'shortcuts', countdown: 0 }, DEFAULT_CHOICE);
    expect(choice).toMatchObject({ source: 'window', windowId: 'w1', camera: 'cam1', keys: 'shortcuts', countdown: 0 });
  });
});

describe('磁盘剩余空间', () => {
  const withDisk = (freeBytes: number, over: Partial<RecordingSources> = {}) => sources({ ...over, disk: { freeBytes } } as Partial<RecordingSources>);

  it('码率按物理像素、帧率估，摄像头与每路声音另加', () => {
    const screenOnly = { ...DEFAULT_CHOICE, microphone: null };
    const base = recordingBytesPerSecond(screenOnly, sources());
    expect(base).toBeCloseTo((1512 * 982 * 4 * 30 * 0.15) / 8);
    expect(recordingBytesPerSecond(screenOnly, sources(), 60)).toBeCloseTo(base * 2);
    expect(recordingBytesPerSecond({ ...screenOnly, microphone: 'default', systemAudio: true }, sources())).toBeCloseTo(base + 32_000);
    expect(recordingBytesPerSecond({ ...screenOnly, camera: 'cam1' }, sources())).toBeGreaterThan(base);
    expect(recordingBytesPerSecond({ ...screenOnly, source: 'window', windowId: 'w1' }, sources())).toBeCloseTo((800 * 600 * 4 * 30 * 0.15) / 8);
  });

  it('不够录十分钟时提醒并给出大约还能录几分钟；够了或 Runtime 没给剩余空间时不提醒', () => {
    const rate = recordingBytesPerSecond(DEFAULT_CHOICE, sources());
    expect(lowDisk(DEFAULT_CHOICE, sources())).toBeNull();
    expect(lowDisk(DEFAULT_CHOICE, withDisk(rate * 60 * LOW_DISK_MINUTES + 1))).toBeNull();
    expect(lowDisk(DEFAULT_CHOICE, withDisk(rate * 60 * 4.5))).toEqual({ freeBytes: rate * 60 * 4.5, minutes: 4 });
    expect(lowDisk(DEFAULT_CHOICE, withDisk(rate * 10))?.minutes).toBe(1);
    expect(lowDisk(DEFAULT_CHOICE, withDisk(Number.NaN))).toBeNull();
  });
});

describe('开始录制的快捷键', () => {
  it('面板开着或入口不显示时不动；置灰时说明原因；否则在这一页的项目里打开面板', () => {
    expect(startFromShortcut({ entry: { kind: 'ready' }, panelOpen: true, projectId: null })).toBeNull();
    expect(startFromShortcut({ entry: { kind: 'hidden' }, panelOpen: false, projectId: null })).toBeNull();
    expect(startFromShortcut({ entry: { kind: 'disabled', block: { kind: 'busy' } }, panelOpen: false, projectId: null })).toEqual({ kind: 'blocked', block: { kind: 'busy' } });
    expect(startFromShortcut({ entry: { kind: 'ready' }, panelOpen: false, projectId: 'p1' })).toEqual({ kind: 'open', projectId: 'p1' });
  });
});

describe('智能体发起的与没收完的', () => {
  it('正看着发起它的会话、没关掉过、没有别的面板时自动弹出', () => {
    const waiting = rec();
    expect(autoOpenWaiting({ recordings: [waiting], conversationId: 'conv_1', dismissed: [], panelOpen: false })).toBe(waiting);
    expect(autoOpenWaiting({ recordings: [waiting], conversationId: 'conv_2', dismissed: [], panelOpen: false })).toBeNull();
    expect(autoOpenWaiting({ recordings: [waiting], conversationId: 'conv_1', dismissed: ['rec_1'], panelOpen: false })).toBeNull();
    expect(autoOpenWaiting({ recordings: [waiting], conversationId: 'conv_1', dismissed: [], panelOpen: true })).toBeNull();
    expect(autoOpenWaiting({ recordings: [rec({ state: 'recording' })], conversationId: 'conv_1', dismissed: [], panelOpen: false })).toBeNull();
  });

  it('没收完的按时间倒序；导入了的不算', () => {
    const a = rec({ recordingId: 'a', state: 'importable', unfinished: true, createdAt: '2026-11-14T00:00:00.000Z' });
    const b = rec({ recordingId: 'b', state: 'importable', unfinished: true, createdAt: '2026-11-15T00:00:00.000Z' });
    const c = rec({ recordingId: 'c', state: 'in-timeline', unfinished: false });
    expect(unfinishedRecordings([a, c, b]).map((r) => r.recordingId)).toEqual(['b', 'a']);
  });

  it('只在看着它走到「已进时间线」时打开编辑器', () => {
    const result = { videoId: 'v', manifestDocumentId: 'd', screenViewDocumentId: 's', groupId: 'g', itemIds: [], duration: 3, autoZoomPending: false };
    const done = rec({ state: 'in-timeline', result });
    expect(shouldOpenAfter('importing', done)).toBe(true);
    expect(shouldOpenAfter(undefined, done)).toBe(false);
    expect(shouldOpenAfter('in-timeline', done)).toBe(false);
    expect(shouldOpenAfter('importing', rec({ state: 'in-timeline', result, options: { ...RECORDING_DEFAULTS, open: false } }))).toBe(false);
  });

  it('时长写成 m:ss，过一小时 h:mm:ss', () => {
    expect(formatElapsed(5.9)).toBe('0:05');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(3725)).toBe('1:02:05');
  });
});
