// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captionChips } from '../../model/caption-tracks.ts';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { captionItem, documentRecord, sequence, track } from '../../testing/sequence-records.ts';
import { useCaptionGallery } from './caption-gallery.tsx';
import { EditorContext, type EditorActions } from './editor-context.tsx';
import { LiteSidePanel } from './lite-side-panel.tsx';
import { SubtitleStrip } from './subtitle-strip.tsx';
import { CAPTION_STYLE_COPY, SUBTITLE_COPY } from './subtitle-copy.ts';

// Navigation does not depend on the WASM thumbnail renderer.
vi.mock('./caption-thumb.tsx', () => ({ CaptionThumb: () => null }));

const seq = sequence([track('subs', 'subtitle', 0)], [captionItem('caption', 'subs', 'orig')]);
const documents = { orig: documentRecord('orig', 'caption', 'Original') };
const chips = captionChips(seq, documents);
const runtime = {
  videos: { documents: { load: () => {}, peek: () => undefined, subscribe: () => () => {} } },
} as unknown as RuntimeSession;
const actions = { apply: vi.fn(), undo: vi.fn() } as unknown as EditorActions;
let container: HTMLDivElement;
let root: Root;
const editorBefore = useEditor.getState();
const videoBefore = useVideo.getState();

async function render(child: ReactNode) {
  await act(() => root.render(createElement(RuntimeContext.Provider, { value: runtime },
    createElement(EditorContext.Provider, { value: actions }, child))));
}

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label);
  expect(found).toBeDefined();
  return found!;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useEditor.setState({ selection: ['keep-selection'], panelTab: 'subtitle', captionsHidden: false, captionLayersHidden: { original: false, translation: false } });
  useVideo.getState().begin({ projectId: 'project', path: '/tmp/caption-style-entry' });
  useVideo.getState().update({ videoId: 'v1' });
  useCaptionGallery.setState({ open: {} });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useEditor.setState(editorBefore);
  useVideo.setState(videoBefore);
  useCaptionGallery.setState({ open: {} });
  vi.unstubAllGlobals();
});

it('opens the style list from the review sidebar and returns to lines', async () => {
  await render(createElement(LiteSidePanel, { segments: [], videoId: 'v1', sequence: seq, documents, assets: {} }));
  await act(async () => button('字幕样式').click());
  expect(container.textContent).toContain(CAPTION_STYLE_COPY.title);
  expect(container.textContent).toContain('Pretty Little Marketer');
  expect(container.textContent).toContain('Shorts');
  expect(useEditor.getState().selection).toEqual(['keep-selection']);
  expect(useCaptionGallery.getState().open).toEqual({});
  await act(async () => button('返回台词').click());
  expect(container.textContent).not.toContain('Pretty Little Marketer');
  await act(async () => button('字幕样式').click());
  expect(container.textContent).toContain('Pretty Little Marketer');
});

it('opens the style list from the timeline entry without switching to properties', async () => {
  await render(createElement(SubtitleStrip, { sequence: seq, documents, chips, selected: chips[0]!.key, onSelect: vi.fn() }));
  await act(async () => button(SUBTITLE_COPY.styleEntryLabel).click());
  expect(useCaptionGallery.getState().open.v1).toBe(true);
  expect(useEditor.getState().panelTab).toBe('subtitle');
  expect(useEditor.getState().selection).toEqual(['keep-selection']);
});
