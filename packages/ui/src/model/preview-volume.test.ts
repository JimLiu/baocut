import { describe, expect, it } from 'vitest';
import { FULL_VOLUME, monitorGain, monitorLevel, stepMonitor, toggleMute } from './preview-volume.ts';

describe('预览的监听音量', () => {
  it('一档 10，夹在 0–100', () => {
    expect(stepMonitor(FULL_VOLUME, 1)).toEqual({ volume: 100, muted: false });
    expect(stepMonitor(FULL_VOLUME, -1)).toEqual({ volume: 90, muted: false });
    expect(stepMonitor({ volume: 4, muted: false }, -1)).toEqual({ volume: 0, muted: true });
  });

  it('往上走取消静音；往下走到 0 才算静音（原型 stepVol）', () => {
    expect(stepMonitor({ volume: 60, muted: true }, 1)).toEqual({ volume: 70, muted: false });
    expect(stepMonitor({ volume: 60, muted: true }, -1)).toEqual({ volume: 50, muted: false });
    expect(stepMonitor({ volume: 10, muted: false }, -1)).toEqual({ volume: 0, muted: true });
    expect(stepMonitor({ volume: 0, muted: true }, 1)).toEqual({ volume: 10, muted: false });
  });

  it('M 只切静音，音量照记', () => {
    expect(toggleMute({ volume: 40, muted: false })).toEqual({ volume: 40, muted: true });
    expect(toggleMute({ volume: 40, muted: true })).toEqual({ volume: 40, muted: false });
  });

  it('与引擎的 0–1 倍数互换', () => {
    expect(monitorGain({ volume: 70, muted: true })).toEqual({ volume: 0.7, muted: true });
    expect(monitorLevel({ volume: 0.7, muted: false })).toEqual({ volume: 70, muted: false });
    expect(monitorLevel({ volume: 3, muted: false })).toEqual({ volume: 100, muted: false });
  });
});
