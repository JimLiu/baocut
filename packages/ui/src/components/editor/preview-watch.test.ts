import { expect, test, vi } from 'vitest';
import { POLL_MS, PreviewWatch, STALL_MS, preparingMark, probeElement, stalledStep, type MediaProbe, type PreviewSnapshot } from './preview-watch.ts';

function snapshot(patch: Partial<PreviewSnapshot> = {}): PreviewSnapshot {
  return {
    status: 'ready',
    planner: 'ready',
    video: true,
    videoError: null,
    plan: true,
    canvas: true,
    playing: false,
    painted: null,
    paintWanted: false,
    media: [],
    documents: [],
    fonts: [],
    ...patch,
  };
}

/** 手动推进的时钟与计时器：`advance` 到点就跑排着的检查。 */
function harness(probe: () => PreviewSnapshot, visible = () => true) {
  let now = 0;
  let pending: { run: () => void; at: number } | null = null;
  const warn = vi.fn();
  const error = vi.fn();
  const watch = new PreviewWatch(probe, {
    now: () => now,
    visible,
    warn,
    error,
    schedule: (run, ms) => {
      const entry = { run, at: now + ms };
      pending = entry;
      return () => {
        if (pending === entry) pending = null;
      };
    },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    while (pending && pending.at <= end) {
      const entry: { run: () => void; at: number } = pending;
      pending = null;
      now = entry.at;
      entry.run();
    }
    now = end;
  };
  return { watch, warn, error, advance, scheduled: () => pending !== null };
}

test('卡在哪一步：载入中按内核、视频、计划分；出错不算卡住', () => {
  expect(stalledStep(snapshot({ status: 'loading', planner: 'loading' }), false)).toBe('planner-loading');
  expect(stalledStep(snapshot({ status: 'loading', video: false }), false)).toBe('no-video');
  expect(stalledStep(snapshot({ status: 'loading', videoError: '坏了' }), false)).toBe('video-error');
  expect(stalledStep(snapshot({ status: 'loading' }), false)).toBe('no-plan');
  expect(stalledStep(snapshot({ status: 'error', planner: 'loading' }), false)).toBeNull();
});

test('卡在哪一步：就绪之后看媒体、文档、字体，再看要画的帧有没有画上去', () => {
  const media = [{ itemId: 'clip', kind: 'video' as const, wait: 'no-element' as const, wantedSeconds: 1, element: null }];
  expect(stalledStep(snapshot({ media, documents: ['doc'] }), false)).toBe('media-pending');
  expect(stalledStep(snapshot({ documents: ['doc'] }), false)).toBe('documents-pending');
  expect(stalledStep(snapshot({ fonts: ['Inter'] }), false)).toBe('fonts-loading');
  expect(stalledStep(snapshot({ paintWanted: true }), false)).toBe('not-painted');
  expect(stalledStep(snapshot({ paintWanted: true, canvas: false }), false)).toBe('no-canvas');
  // 画布上换过帧（播放中每帧都要画）就不算卡住。
  expect(stalledStep(snapshot({ paintWanted: true, playing: true }), true)).toBeNull();
  expect(stalledStep(snapshot(), false)).toBeNull();
});

/** 在等兼容副本的媒体：`progress` 是转换到了几成，null 是 Runtime 还不知道。 */
const preparing = (progress: number | null, assetId = 'asset_a'): MediaProbe => ({
  itemId: `clip_${assetId}`,
  assetId,
  kind: 'video',
  wait: 'preparing',
  progress,
  wantedSeconds: 0,
  element: null,
});

test('卡在哪一步：都在等兼容副本时看进度；夹着别的媒体还是在等媒体', () => {
  expect(stalledStep(snapshot({ media: [preparing(0.3)] }), false)).toBe('media-preparing');
  // Runtime 还不知道进度：不算卡住（转换有自己的超时）。
  expect(stalledStep(snapshot({ media: [preparing(null)] }), false)).toBeNull();
  expect(stalledStep(snapshot({ media: [preparing(0.3), preparing(null, 'asset_b')] }), false)).toBeNull();
  const other = { itemId: 'clip', kind: 'video' as const, wait: 'no-data' as const, wantedSeconds: 0, element: null };
  expect(stalledStep(snapshot({ media: [preparing(0.3), other] }), false)).toBe('media-pending');
  // 记号按原始比值、与顺序无关。
  expect(preparingMark({ media: [preparing(0.301, 'b'), preparing(0.3)] })).toBe(preparingMark({ media: [preparing(0.3), preparing(0.301, 'b')] }));
  expect(preparingMark({ media: [preparing(0.3)] })).not.toBe(preparingMark({ media: [preparing(0.3001)] }));
});

test('转换中：进度一直在走就不报；停在同一处满门槛才报，再走起来算卡住结束', () => {
  let progress = 0;
  const { watch, warn, advance } = harness(() => snapshot({ media: [preparing(progress)] }));
  const seen: (string | null)[] = [];
  watch.onChange((report) => seen.push(report ? report.step : null));
  watch.start();
  for (let i = 0; i < 20; i++) {
    progress += 0.0001;
    advance(POLL_MS);
  }
  expect(warn).not.toHaveBeenCalled();
  advance(STALL_MS + POLL_MS);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]![0]).toContain('转换没有进展');
  expect(watch.ongoing).toMatchObject({ step: 'media-preparing', media: [{ wait: 'preparing', progress }] });
  progress += 0.0001;
  advance(POLL_MS);
  expect(seen).toEqual(['media-preparing', null]);
});

test('转换中：Runtime 一直不知道进度就一直不报', () => {
  const { watch, warn, advance } = harness(() => snapshot({ media: [preparing(null)] }));
  watch.start();
  advance(STALL_MS * 5);
  expect(warn).not.toHaveBeenCalled();
});

test('同一步卡过门槛只报一次，带上快照；有进展之后重新计时、再卡再报', () => {
  let current = snapshot({ status: 'loading', planner: 'loading' });
  const { watch, warn, advance } = harness(() => current);
  watch.start();
  // 第一次看到卡住才开始计时。
  advance(STALL_MS);
  expect(warn).not.toHaveBeenCalled();
  advance(POLL_MS);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(watch.report?.stalledMs).toBe(STALL_MS);
  expect(warn.mock.calls[0]![0]).toContain('渲染内核还没载入完');
  expect(watch.report).toMatchObject({ step: 'planner-loading', ongoing: true, planner: 'loading' });
  expect(watch.report).not.toHaveProperty('painted');
  advance(STALL_MS * 3);
  expect(warn).toHaveBeenCalledTimes(1);

  // 内核载入了，换成卡在下一步：上一份标成过去了，这一步重新计时。
  current = snapshot({ status: 'loading' });
  advance(POLL_MS);
  expect(watch.report).toMatchObject({ step: 'planner-loading', ongoing: false });
  advance(STALL_MS);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(watch.report).toMatchObject({ step: 'no-plan', ongoing: true });

  // 好了，之后再卡又报。
  current = snapshot();
  advance(POLL_MS);
  expect(watch.report?.ongoing).toBe(false);
  current = snapshot({ documents: ['doc'] });
  advance(STALL_MS + POLL_MS);
  expect(warn).toHaveBeenCalledTimes(3);
  expect(watch.report).toMatchObject({ step: 'documents-pending', documents: ['doc'] });
});

test('要画的帧：画布上一直没换才算卡住，播放中每次都换了就不报', () => {
  let painted = {};
  let current = () => snapshot({ playing: true, paintWanted: true, painted });
  const { watch, warn, advance } = harness(() => current());
  watch.start();
  for (let i = 0; i < 10; i++) {
    painted = {};
    advance(POLL_MS);
  }
  expect(warn).not.toHaveBeenCalled();
  const stuck = {};
  current = () => snapshot({ playing: true, paintWanted: true, painted: stuck });
  advance(STALL_MS + 2 * POLL_MS);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(watch.report?.step).toBe('not-painted');
});

test('页面隐藏时不计时，回来之后重新算', () => {
  let visible = true;
  const { watch, warn, advance } = harness(
    () => snapshot({ status: 'loading', planner: 'loading' }),
    () => visible,
  );
  watch.start();
  advance(STALL_MS - POLL_MS);
  visible = false;
  advance(STALL_MS * 2);
  expect(warn).not.toHaveBeenCalled();
  visible = true;
  advance(STALL_MS - POLL_MS);
  expect(warn).not.toHaveBeenCalled();
  advance(2 * POLL_MS);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('停了就不再排检查；意外的错一阵只打一次，记进报告', () => {
  const { watch, error, warn, advance, scheduled } = harness(() => snapshot({ status: 'loading', planner: 'loading' }));
  watch.start();
  expect(scheduled()).toBe(true);
  watch.noteError('播放', new Error('炸了'));
  watch.noteError('播放', new Error('炸了'));
  expect(error).toHaveBeenCalledTimes(1);
  watch.noteError('重画', new Error('又炸了'));
  expect(error).toHaveBeenCalledTimes(2);
  advance(STALL_MS + POLL_MS);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(watch.report?.lastError).toBe('重画: 又炸了');
  watch.stop();
  expect(scheduled()).toBe(false);
});

test('诊断自己抛错不影响之后的检查', () => {
  let calls = 0;
  const { watch, error, advance } = harness(() => {
    calls++;
    if (calls === 1) throw new Error('快照坏了');
    return snapshot();
  });
  watch.start();
  advance(POLL_MS * 3);
  expect(error).toHaveBeenCalledTimes(1);
  expect(calls).toBe(3);
});

test('媒体元素的状态：不带地址，只说有没有', () => {
  expect(probeElement(null)).toEqual({ wait: 'no-element', element: null });
  const video = {
    readyState: 1,
    networkState: 2,
    error: null,
    seeking: false,
    currentTime: 0,
    currentSrc: 'http://127.0.0.1:1/media?token=secret',
  };
  const probe = probeElement(video as never);
  expect(probe).toEqual({
    wait: 'no-data',
    element: { readyState: 1, networkState: 2, errorCode: null, seeking: false, currentTime: 0, hasSource: true },
  });
  expect(JSON.stringify(probe)).not.toContain('secret');
  expect(probeElement({ ...video, readyState: 4, seeking: true } as never).wait).toBe('seeking');
  expect(probeElement({ ...video, error: { code: 4 } } as never)).toMatchObject({ wait: 'error', element: { errorCode: 4 } });
  expect(probeElement({ ...video, readyState: 4 } as never).wait).toBe('position');
  expect(probeElement({ complete: false, naturalWidth: 0, src: '' } as never)).toMatchObject({
    wait: 'no-data',
    element: { hasSource: false },
  });
  expect(probeElement({ complete: true, naturalWidth: 0, src: 'x' } as never).wait).toBe('error');
});

test('报出卡住与卡住结束都通知订阅者；报告带开始卡住的时刻', () => {
  let current = snapshot({
    media: [{ itemId: 'clip', assetId: 'asset_a', kind: 'video', wait: 'no-element', wantedSeconds: 0, element: null }],
  });
  const { watch, advance } = harness(() => current);
  const seen: (string | null)[] = [];
  watch.onChange((report) => seen.push(report ? report.step : null));
  watch.start();
  advance(STALL_MS + POLL_MS);
  expect(seen).toEqual(['media-pending']);
  expect(watch.ongoing).toMatchObject({ step: 'media-pending', since: POLL_MS, stalledMs: STALL_MS, ongoing: true });
  current = snapshot();
  advance(POLL_MS);
  expect(seen).toEqual(['media-pending', null]);
  expect(watch.ongoing).toBeNull();
  // 历史报告还留着，只是不再是还卡着的。
  expect(watch.report?.ongoing).toBe(false);
});

test('重试从头计时：手上的卡住算结束，还卡着要再满门槛才报', () => {
  const current = snapshot({ status: 'loading', planner: 'loading' });
  const { watch, warn, advance } = harness(() => current);
  const seen: (string | null)[] = [];
  watch.onChange((report) => seen.push(report ? report.step : null));
  watch.start();
  advance(STALL_MS + POLL_MS);
  expect(watch.ongoing?.step).toBe('planner-loading');
  watch.reset();
  expect(watch.ongoing).toBeNull();
  expect(seen).toEqual(['planner-loading', null]);
  advance(STALL_MS);
  expect(warn).toHaveBeenCalledTimes(1);
  advance(POLL_MS);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(seen).toEqual(['planner-loading', null, 'planner-loading']);
});

test('订阅者抛错不影响诊断', () => {
  const current = snapshot({ status: 'loading', planner: 'loading' });
  const { watch, warn, error, advance } = harness(() => current);
  watch.onChange(() => {
    throw new Error('listener');
  });
  watch.start();
  advance(STALL_MS + POLL_MS);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(1);
  expect(watch.ongoing?.step).toBe('planner-loading');
});
