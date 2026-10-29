// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPOSITION_BRIDGE_CHANNEL } from '@baocut/protocol';
import { COMPOSITION_ADAPTER_SCRIPT } from './composition-adapter.ts';
import { COMPOSITION_BRIDGE_SCRIPT } from './composition-bridge.ts';

/**
 * 取帧脚本的三种 seek（`composition-adapter.ts` 文件头）：截图先空一帧，实时层与录制不空。happy-dom 不排版也不出帧：
 * `requestAnimationFrame` 换成计时器，每个动画帧记下那一刻 `<html>` 的行内透明度，`renderAt` 也记一笔，按顺序核对。
 */

type AdapterResult = { ok: boolean; value?: unknown; code?: string };
type Adapter = {
  ready: (contract: string, id: string, timeoutMs: number, ctx: unknown) => Promise<AdapterResult>;
  seek: (seconds: number, mode?: unknown) => Promise<AdapterResult>;
};
type PageWindow = Window & {
  __baocutAdapter?: Adapter;
  __baocutCompositions?: Record<string, unknown>;
  __timelines?: Record<string, unknown>;
};
const win = () => window as unknown as PageWindow;
const adapter = () => win().__baocutAdapter!;
const ctx = { width: 64, height: 36, fps: { num: 30, den: 1 }, durationFrames: 120 };

let log: string[];
const opacity = () => document.documentElement.style.getPropertyValue('opacity');

beforeEach(() => {
  log = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => {
      log.push(`frame:${opacity()}`);
      callback(0);
    }, 0),
  );
  document.body.innerHTML = '<div id="root" data-composition-id="main" data-duration="4"></div>';
  delete win().__baocutAdapter;
  new Function(COMPOSITION_ADAPTER_SCRIPT)();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete win().__baocutAdapter;
  delete win().__baocutCompositions;
  delete win().__timelines;
  document.documentElement.removeAttribute('style');
});

const readyNative = async () => {
  win().__baocutCompositions = {
    main: {
      renderAt: (time: { ticks: string }) => {
        log.push(`render:${time.ticks}:${opacity()}`);
      },
    },
  };
  expect(await adapter().ready('baocut/1', 'main', 1000, ctx)).toMatchObject({ ok: true });
  log = [];
};

const readyHyperframes = async () => {
  let at = 0;
  win().__timelines = {
    main: {
      pause: () => {},
      duration: () => 4,
      time: () => at,
      seek: (seconds: number) => {
        at = seconds;
        log.push(`render:${seconds}:${opacity()}`);
      },
    },
  };
  expect(await adapter().ready('hyperframes/1', 'main', 1000, ctx)).toMatchObject({ ok: true });
  log = [];
};

describe('取帧脚本的 seek 模式', () => {
  it("'live'（实时层）：不空帧，画完等两个动画帧再回信", async () => {
    await readyNative();
    expect(await adapter().seek(1.5, 'live')).toMatchObject({ ok: true, value: { targetSeconds: 1.5 } });
    expect(log).toEqual(['render:1500000:', 'frame:', 'frame:']);
  });

  it("默认（截图）：先空一帧——<html> 透明度压到 0 两个动画帧、还原原来的行内值——再画、再等两帧", async () => {
    await readyNative();
    document.documentElement.style.setProperty('opacity', '0.5');
    expect(await adapter().seek(1.5)).toMatchObject({ ok: true });
    expect(log).toEqual(['frame:0', 'frame:0', 'render:1500000:0.5', 'frame:0.5', 'frame:0.5']);
    expect(opacity()).toBe('0.5');
  });

  it("'record'（录制）：不空帧也不等动画帧；认不出的模式按截图处理", async () => {
    await readyNative();
    expect(await adapter().seek(1, 'record')).toMatchObject({ ok: true });
    expect(log).toEqual(['render:1000000:']);
    log = [];
    expect(await adapter().seek(1, true)).toMatchObject({ ok: true });
    expect(log).toEqual(['frame:0', 'frame:0', 'render:1000000:', 'frame:', 'frame:']);
  });

  it("hyperframes/1：'live' 不空帧，截图照旧空一帧", async () => {
    await readyHyperframes();
    expect(await adapter().seek(2, 'live')).toMatchObject({ ok: true, value: { sampledSeconds: 2 } });
    expect(log).toEqual(['render:2:', 'frame:', 'frame:']);
    log = [];
    expect(await adapter().seek(2)).toMatchObject({ ok: true });
    expect(log).toEqual(['frame:0', 'frame:0', 'render:2:', 'frame:', 'frame:']);
  });

  it('经桥的 seek（编辑器实时层）走 live：连续播放的每一帧都不把页面压成透明', async () => {
    await readyNative();
    const posted: Array<{ kind: string; id?: number; result?: AdapterResult }> = [];
    let onMessage: ((event: { source: unknown; data: unknown }) => void) | null = null;
    const parent = { postMessage: (data: (typeof posted)[number]) => posted.push(data) };
    const page = {
      parent,
      __baocutAdapter: adapter(),
      addEventListener: (_type: string, listener: typeof onMessage) => (onMessage = listener),
    };
    new Function('window', COMPOSITION_BRIDGE_SCRIPT)(page);
    expect(posted[0]).toMatchObject({ kind: 'hello' });
    // 实时层一次只发一个在路上的 seek，回信到了再发下一帧。
    for (let frame = 1; frame <= 3; frame++) {
      onMessage!({ source: parent, data: { channel: COMPOSITION_BRIDGE_CHANNEL, kind: 'seek', id: frame, seconds: frame / 30 } });
      await vi.waitFor(() => expect(posted).toHaveLength(frame + 1));
      expect(posted[frame]).toMatchObject({ kind: 'result', id: frame, result: { ok: true } });
    }
    expect(log.filter((entry) => entry.startsWith('render:'))).toHaveLength(3);
    expect(log.some((entry) => entry.endsWith(':0'))).toBe(false);
  });
});
