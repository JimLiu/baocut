import { RECORDING_DEFAULTS, type RecordingSummary } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import { barView, clock, currentRecording, hideForRecording, parseHostSettings, privacyUrl, shortcutsWanted, toggleMethod, windowPlan } from './recording-rules.ts';

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

describe('控制条', () => {
  it('录制中能暂停、停止、丢弃；暂停时能继续', () => {
    expect(barView(rec())).toMatchObject({ phase: 'recording', seconds: 12.4, canPause: true, canResume: false, canStop: true, canDiscard: true });
    expect(barView(rec({ state: 'paused' }))).toMatchObject({ phase: 'paused', canPause: false, canResume: true, canStop: true });
  });

  it('倒计时显示剩下的秒数；收尾时只显示「正在收尾」；导入完、等待开始时不显示', () => {
    expect(barView(rec({ state: 'countdown', countdownLeft: 2 }))).toMatchObject({ phase: 'countdown', seconds: 2, canStop: false, canDiscard: true });
    expect(barView(rec({ state: 'finalizing' }))).toMatchObject({ phase: 'finishing', canStop: false, canDiscard: false });
    expect(barView(rec({ state: 'in-timeline' }))).toBeNull();
    expect(barView(rec({ state: 'waiting' }))).toBeNull();
  });

  it('中途断开的那几路带出来', () => {
    const r = rec({ streams: [{ role: 'camera', device: { name: 'Cam' }, active: false, lost: true }, { role: 'screen', device: null, active: true }] });
    expect(barView(r)?.lost).toEqual(['camera']);
  });

  it('当前的那次：在采集或在收尾的', () => {
    expect(currentRecording([rec({ recordingId: 'a', state: 'in-timeline' }), rec({ recordingId: 'b', state: 'importing' })])?.recordingId).toBe('b');
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

  it('这次要把 BaoCut 录进去（整屏、区域）时不收起；录单个窗口时照设置', () => {
    expect(hideForRecording(rec(), true)).toBe(true);
    expect(hideForRecording(rec(), false)).toBe(false);
    expect(hideForRecording(rec({ options: { ...RECORDING_DEFAULTS, includeSelf: true } }), true)).toBe(false);
    const area = { kind: 'area' as const, rect: { x: 0, y: 0, width: 100, height: 100 } };
    expect(hideForRecording(rec({ options: { ...RECORDING_DEFAULTS, includeSelf: true, source: area } }), true)).toBe(false);
    expect(hideForRecording(rec({ options: { ...RECORDING_DEFAULTS, includeSelf: true, source: { kind: 'window', windowId: 'w1' } } }), true)).toBe(true);
  });
});

describe('快捷键与设置', () => {
  it('只在采集时注册；暂停与继续按状态切换', () => {
    expect(shortcutsWanted(rec())).toBe(true);
    expect(shortcutsWanted(rec({ state: 'finalizing' }))).toBe(false);
    expect(toggleMethod(rec())).toBe('recordings.pause');
    expect(toggleMethod(rec({ state: 'paused' }))).toBe('recordings.resume');
    expect(toggleMethod(rec({ state: 'countdown' }))).toBeNull();
  });

  it('渲染进程给的设置：不认识的值退回缺省，空串是不用', () => {
    expect(parseHostSettings({ shortcuts: { stop: 'Alt+S', pause: '' }, hideWindow: false })).toEqual({ shortcuts: { stop: 'Alt+S', pause: '' }, hideWindow: false });
    expect(parseHostSettings({ shortcuts: { stop: 42, pause: 'x'.repeat(80) } })).toEqual(parseHostSettings(null));
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
