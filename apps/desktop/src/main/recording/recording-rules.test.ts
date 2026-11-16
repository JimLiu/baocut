import { RECORDING_DEFAULTS, type RecordingSummary } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import {
  BAR,
  barPlacement,
  cameraPlacement,
  captureShortcutsWanted,
  clock,
  currentRecording,
  DEFAULT_HOST_SETTINGS,
  hideForRecording,
  openShortcutsWanted,
  parseHostSettings,
  parseSessionRequest,
  privacyUrl,
  toggleMethod,
  windowPlan,
  workerDisplayFor,
} from './recording-rules.ts';

const rec = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  recordingId: 'rec_1',
  state: 'recording',
  jobId: 'job_1',
  options: RECORDING_DEFAULTS,
  target: { create: { projectId: 'p' } },
  requestedBy: null,
  createdAt: '2026-11-15T10:00:00.000Z',
  startedAt: '2026-11-15T10:00:03.000Z',
  elapsed: 12.4,
  streams: [],
  videoId: null,
  unfinished: false,
  dir: '/tmp/rec_1',
  error: null,
  result: null,
  ...over,
});

describe('当前的那次', () => {
  it('在准备、采集或在收尾的；导入完、等待开始、没收完的不算', () => {
    expect(currentRecording([rec({ recordingId: 'a', state: 'in-timeline' }), rec({ recordingId: 'b', state: 'importing' })])?.recordingId).toBe('b');
    expect(currentRecording([rec({ state: 'preparing' })])?.state).toBe('preparing');
    expect(currentRecording([rec({ state: 'waiting' })])).toBeNull();
    expect(currentRecording([rec({ state: 'importable', unfinished: true })])).toBeNull();
  });
});

describe('应用窗口', () => {
  it('开始采集时收起，采集结束时放回来；关掉了收起就不收', () => {
    expect(windowPlan(undefined, 'preparing', true)).toBe('hide');
    expect(windowPlan('waiting', 'countdown', true)).toBe('hide');
    expect(windowPlan('recording', 'paused', true)).toBeNull();
    expect(windowPlan('recording', 'stopping', true)).toBe('restore');
    expect(windowPlan('countdown', 'failed', true)).toBe('restore');
    expect(windowPlan('paused', 'discarded', true)).toBe('restore');
    expect(windowPlan(undefined, 'recording', false)).toBeNull();
    expect(windowPlan('stopping', 'in-timeline', true)).toBeNull();
  });

  it('这次要把 BaoCut 录进去（整屏、区域）时不收起；录单个窗口时照样收起', () => {
    expect(hideForRecording(rec())).toBe(true);
    expect(hideForRecording(rec({ options: { ...RECORDING_DEFAULTS, includeSelf: true } }))).toBe(false);
    const area = { kind: 'area' as const, rect: { x: 0, y: 0, width: 100, height: 100 } };
    expect(hideForRecording(rec({ options: { ...RECORDING_DEFAULTS, includeSelf: true, source: area } }))).toBe(false);
    expect(hideForRecording(rec({ options: { ...RECORDING_DEFAULTS, includeSelf: true, source: { kind: 'window', windowId: 'w1' } } }))).toBe(true);
  });
});

describe('快捷键与设置', () => {
  it('停止、暂停、重新开始只在采集时注册；暂停与继续按状态切换', () => {
    expect(captureShortcutsWanted(rec())).toBe(true);
    expect(captureShortcutsWanted(rec({ state: 'preparing' }))).toBe(true);
    expect(captureShortcutsWanted(rec({ state: 'finalizing' }))).toBe(false);
    expect(captureShortcutsWanted(null)).toBe(false);
    expect(toggleMethod(rec())).toBe('recordings.pause');
    expect(toggleMethod(rec({ state: 'paused' }))).toBe('recordings.resume');
    expect(toggleMethod(rec({ state: 'countdown' }))).toBeNull();
  });

  it('打开启动器的四个：设置到了、连着 Runtime、没有在录时才占着', () => {
    expect(openShortcutsWanted(null, true, true)).toBe(true);
    expect(openShortcutsWanted(null, true, false)).toBe(false);
    expect(openShortcutsWanted(null, false, true)).toBe(false);
    expect(openShortcutsWanted(rec(), true, true)).toBe(false);
    expect(openShortcutsWanted(rec({ state: 'preparing' }), true, true)).toBe(false);
  });

  it('渲染进程给的设置：七个快捷键缺省都不设，不认识的值退回缺省', () => {
    const home = { target: { home: { projectId: null, name: 'Recordings' } }, landing: { text: 'New video', kind: 'new' } };
    expect(
      parseHostSettings({ shortcuts: { launcher: 'Alt+R', stop: 'Alt+S', pause: '', start: 'Alt+X' }, mainWindow: 'minimize', afterDiscard: 'launcher', trayIcon: false, home }),
    ).toEqual({
      shortcuts: { ...DEFAULT_HOST_SETTINGS.shortcuts, launcher: 'Alt+R', stop: 'Alt+S' },
      mainWindow: 'minimize',
      afterDiscard: 'launcher',
      trayIcon: false,
      home,
    });
    expect(parseHostSettings({ shortcuts: { launcher: {}, stop: 42, pause: 'x'.repeat(80) }, mainWindow: 'close', trayIcon: 'yes' })).toEqual(parseHostSettings(null));
    expect(parseHostSettings(null)).toEqual(DEFAULT_HOST_SETTINGS);
    expect(Object.values(DEFAULT_HOST_SETTINGS.shortcuts).every((v) => v === '')).toBe(true);
    // 落点形状不对时当作不能录。
    expect(parseHostSettings({ home: { target: { home: { projectId: 'bad id!', name: 'x' } }, landing: { text: '', kind: 'new' } } }).home).toBeNull();
  });

  it('打开启动器的请求：校验落点、ID 与落点行', () => {
    const landing = { text: 'New video · Demo', kind: 'new' };
    expect(parseSessionRequest({ target: { create: { projectId: 'prj_1' } }, landing, direct: 'area' })).toEqual({ target: { create: { projectId: 'prj_1' } }, landing, direct: 'area' });
    expect(parseSessionRequest({ target: { videoId: 'vid_1', at: 3.5 }, landing: { text: 'Add', kind: 'into' } })?.target).toEqual({ videoId: 'vid_1', at: 3.5 });
    expect(parseSessionRequest({ target: { videoId: 'vid_1', at: -1 }, landing: { text: 'Add', kind: 'into' } })?.target).toEqual({ videoId: 'vid_1' });
    expect(parseSessionRequest({ target: { create: {} }, recordingId: 'rec_1', landing: { text: 'Agent', note: 'Demo chat', kind: 'agent' } })).toEqual({
      target: { create: {} },
      recordingId: 'rec_1',
      landing: { text: 'Agent', note: 'Demo chat', kind: 'agent' },
    });
    expect(parseSessionRequest({ target: { home: { projectId: null, name: 'Recordings' } }, landing, direct: 'nope' })).toEqual({ target: { home: { projectId: null, name: 'Recordings' } }, landing });
    expect(parseSessionRequest({ target: { create: { projectId: '../x' } }, landing })).toBeNull();
    expect(parseSessionRequest({ target: { videoId: 'vid_1' }, landing: { text: 'x', kind: 'other' } })).toBeNull();
    expect(parseSessionRequest({ target: { videoId: 'vid_1' }, recordingId: 5, landing })).toBeNull();
    expect(parseSessionRequest('x')).toBeNull();
    expect(parseSessionRequest(null)).toBeNull();
  });

  it('只认四项权限；macOS 给隐私页的地址，别的系统没有就是 null', () => {
    expect(privacyUrl('screen', 'darwin')).toContain('Privacy_ScreenCapture');
    expect(privacyUrl('inputMonitoring', 'darwin')).toContain('Privacy_ListenEvent');
    expect(privacyUrl('fullDisk', 'darwin')).toBeNull();
    expect(privacyUrl('camera', 'win32')).toBe('ms-settings:privacy-webcam');
    expect(privacyUrl('screen', 'linux')).toBeNull();
  });

  it('时长写成 m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(61.9)).toBe('1:01');
    expect(clock(3601)).toBe('1:00:01');
  });
});

describe('覆盖层盖着的屏幕', () => {
  const workers = [
    { id: '1', width: 1512, height: 982, primary: true },
    { id: '724', width: 1920, height: 1080, primary: false },
  ];
  it('先按 ID；对不上时按尺寸与是否主屏；再不行主屏对主屏', () => {
    expect(workerDisplayFor({ id: 724, bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, primary: false }, workers)).toBe('724');
    expect(workerDisplayFor({ id: 99, bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, primary: false }, workers)).toBe('724');
    expect(workerDisplayFor({ id: 98, bounds: { x: 0, y: 0, width: 1440, height: 900 }, primary: true }, workers)).toBe('1');
    expect(workerDisplayFor({ id: 97, bounds: { x: 0, y: 0, width: 800, height: 600 }, primary: false }, workers)).toBeNull();
  });
});

describe('控制条与摄像头浮窗的缺省位置', () => {
  const screen = { x: 0, y: 0, width: 1440, height: 900 };
  it('屏幕与区域在底部居中向上 120；窗口在窗口下边缘向上 48；截在屏幕里', () => {
    expect(barPlacement('display', null, screen)).toEqual({ x: 560, y: 716 });
    expect(barPlacement('area', null, screen, BAR.alertHeight)).toEqual({ x: 560, y: 630 });
    expect(barPlacement('window', { x: 100, y: 100, width: 600, height: 400 }, screen)).toEqual({ x: 240, y: 388 });
    expect(barPlacement('window', { x: 1300, y: 860, width: 600, height: 400 }, screen)).toEqual({ x: 1120, y: 836 });
    expect(barPlacement('window', null, { x: 1440, y: 0, width: 1920, height: 1080 })).toEqual({ x: 2240, y: 896 });
  });

  it('浮窗缺省在右下角离边 100；记下的位置截回屏幕', () => {
    expect(cameraPlacement(null, { width: 230, height: 230 }, screen)).toEqual({ x: 1110, y: 570 });
    expect(cameraPlacement({ x: 2000, y: -50 }, { width: 230, height: 230 }, screen)).toEqual({ x: 1210, y: 0 });
  });
});
