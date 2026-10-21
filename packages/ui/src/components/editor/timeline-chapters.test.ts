// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AssetRecord } from '@baocut/protocol';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useMarkup } from '../../state/markup-store.ts';
import { useVideo, type OpenVideo } from '../../state/video-store.ts';
import { chapter, sequence, track, videoItem } from '../../testing/sequence-records.ts';
import { EditorContext, type EditorActions } from './editor-context.tsx';
import { TimelineChapters } from './timeline-chapters.tsx';

const seq = sequence([track('v', 'visual', 1)], [videoItem('clip', 'v', 0, 1800)], {
  markers: [chapter('intro', 0, 'Intro'), chapter('body', 600, 'Body')],
});
const assets = { asset_v: { id: 'asset_v', revisions: { '1': { video: { width: 1920, height: 1080 } } } } } as unknown as Record<string, AssetRecord>;
const seek = vi.fn();
const apply = vi.fn(async () => null);
const thumbnail = vi.fn(() => 'http://media/frame.jpg');
const runtime = { videos: { media: { thumbnail, subscribe: () => () => {}, version: () => 0 } } } as unknown as RuntimeSession;
const actions = { seek, apply, pause: vi.fn() } as unknown as EditorActions;
const initialEditor = useEditor.getState();
const initialVideo = useVideo.getState();
let container: HTMLDivElement;
let root: Root;
let band: HTMLDivElement;
let bar: HTMLDivElement;

async function mount(markers = seq.markers, editable = true) {
  useVideo.setState({ video: { status: editable ? 'ready' : 'stale', state: { video: { assets } } } as OpenVideo });
  await act(() => root.render(createElement(RuntimeContext.Provider, { value: runtime },
    createElement(EditorContext.Provider, { value: actions }, createElement(TimelineChapters, { sequence: { ...seq, markers } })))));
  band = container.firstElementChild as HTMLDivElement;
  bar = band.firstElementChild as HTMLDivElement;
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 600 } as DOMRect);
}

async function pointer(type: string, x: number, target: EventTarget = bar, buttons = 0) {
  await act(() => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, button: 0, buttons })));
}
async function click(x: number, target: EventTarget = bar) {
  await act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x })));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  useEditor.setState({ playhead: 20, selection: ['clip'] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useEditor.setState(initialEditor, true);
  useVideo.setState(initialVideo, true);
  useMarkup.getState().bind('none');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('seeks to the pointer within a chapter instead of its start, including the padded hit area and seams', async () => {
  await mount();
  await pointer('pointerdown', 450, bar, 1);
  expect(useEditor.getState().selection).toEqual([]);
  await click(450);
  expect(seek).toHaveBeenLastCalledWith(35);
  await click(300);
  expect(seek).toHaveBeenLastCalledWith(20);
  expect(container.querySelector(`[aria-label="Add chapter at playhead"]`)).toBeNull();
  expect(band.querySelector('button')).toBeNull();
});

it('previews the pointer frame and chapter, then clears the card on leaving the bar', async () => {
  await mount();
  await pointer('pointermove', 450);
  expect(container.textContent).toContain('Body');
  expect(container.textContent).toContain('00:35');
  expect(thumbnail).toHaveBeenLastCalledWith({ id: 'asset_v', revision: '1' }, 35);
  expect(container.querySelector('[style*="frame.jpg"]')).not.toBeNull();
  expect(seek).not.toHaveBeenCalled();
  await pointer('pointerout', 750);
  expect(container.querySelector('[style*="frame.jpg"]')).toBeNull();
});

it('keeps position seeking and preview available without chapters or editing permission', async () => {
  await mount([], false);
  await pointer('pointermove', 450);
  expect(thumbnail).toHaveBeenLastCalledWith({ id: 'asset_v', revision: '1' }, 35);
  await click(450);
  expect(seek).toHaveBeenLastCalledWith(35);
});

it('moves a chapter boundary without seeking when its resulting click bubbles', async () => {
  await mount();
  const edge = bar.querySelectorAll('[title]')[1]!;
  await pointer('pointerdown', 300, edge, 1);
  await pointer('pointermove', 350, window, 1);
  await pointer('pointerup', 350, window);
  await click(350);
  expect(apply).toHaveBeenCalledWith([expect.objectContaining({ type: 'upsertChapter', at: { unit: 'frames', value: 750 } })], expect.anything());
  expect(seek).not.toHaveBeenCalled();
});

it('offers only rename and remove for an existing chapter', async () => {
  await mount();
  await act(() => bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 450 })));
  expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)).toEqual(['改标题…', '删除这一章']);
});

it('stamps the frames marked in markup mode; crowded frames share one stamp that cycles through them', async () => {
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 600 } as DOMRect);
  const box = { kind: 'box' as const, x: 0.1, y: 0.1, w: 0.1, h: 0.1, color: 'red' as const, width: 4 as const };
  useMarkup.getState().bind('v1');
  useMarkup.getState().apply((s) => ({
    ...s,
    marks: [
      { ...box, id: 'a', timeMs: 30_000 },
      { ...box, id: 'b', timeMs: 30_300 },
      { ...box, id: 'c', timeMs: 31_000 },
      { ...box, id: 'd', timeMs: 50_000 },
    ],
  }));
  useEditor.setState({ annotating: false, playhead: 0 });
  useVideo.setState({ video: { videoId: 'v1', status: 'ready', state: { video: { assets } } } as unknown as OpenVideo });
  await act(() => root.render(createElement(RuntimeContext.Provider, { value: runtime },
    createElement(EditorContext.Provider, { value: actions }, createElement(TimelineChapters, { sequence: seq })))));
  // 不在标注模式时不画
  expect(container.querySelector('[data-bookmark-stamp]')).toBeNull();
  await act(() => useEditor.setState({ annotating: true }));
  const stamps = [...container.querySelectorAll<HTMLElement>('[data-bookmark-stamp]')];
  // 60 s on 600 px: 30.0 s and 31.0 s are 10 px apart and merge; 50 s stands alone
  expect(stamps.map((el) => el.getAttribute('aria-label'))).toEqual(['2 个标记过的帧，从 00:30.0 起', '标记过的帧 00:50.0']);
  expect(stamps.map((el) => el.style.left)).toEqual(['50%', `${(50 / 60) * 100}%`]);
  expect(stamps[0]!.textContent).toBe('2');
  const press = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
      el.click();
    });
  };
  await press(stamps[0]!);
  // the stamp seeks to the marked frame itself, and its click does not reach the band's seek-to-pointer
  expect(seek.mock.calls).toEqual([[30]]);
  await act(() => useEditor.setState({ playhead: 30 }));
  await press(stamps[0]!);
  expect(seek).toHaveBeenLastCalledWith(31);
  expect(seek).toHaveBeenCalledTimes(2);
});
