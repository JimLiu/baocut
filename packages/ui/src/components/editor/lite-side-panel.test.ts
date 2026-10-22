// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AssetRecord, Id, JobRecord } from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiteSegment } from '../../model/lite-segments.ts';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { audioItem, sequence, track } from '../../testing/sequence-records.ts';
import { job } from '../../testing/task-records.ts';
import { EditorContext, type EditorActions } from './editor-context.tsx';
import { LiteSidePanel } from './lite-side-panel.tsx';

const cancelJob = vi.fn(async () => {});
const runtime = {
  cancelJob,
  videos: { documents: { load: () => {}, peek: () => undefined, subscribe: () => () => {} } },
} as unknown as RuntimeSession;
const actions = { seek: vi.fn() } as unknown as EditorActions;
const seq = sequence([track('t1', 'audio', 0)], [audioItem('i1', 't1', 0, 60)]);
const assets = { asset_a: { id: 'asset_a', kind: 'audio', name: 'talk.wav' } } as unknown as Record<Id, AssetRecord>;
const segment = (lines: LiteSegment['lines']): LiteSegment => ({ id: 'whole', index: 0, source: 'whole', title: 'v', start: 0, end: 60, lines });

let container: HTMLDivElement;
let root: Root;

async function render(segments: LiteSegment[]) {
  await act(() =>
    root.render(
      createElement(
        RuntimeContext.Provider,
        { value: runtime },
        createElement(
          EditorContext.Provider,
          { value: actions },
          createElement(LiteSidePanel, { segments, videoId: 'v1', sequence: seq, documents: {}, assets }),
        ),
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useJobs.setState({ jobs: [] });
  vi.unstubAllGlobals();
  cancelJob.mockClear();
});

describe('轻量视图侧栏', () => {
  it('转录与翻译在跑时，侧栏顶上各一块运行态头；取消连得上 Runtime', async () => {
    const transcribe = job({ jobId: 'j1', assetId: 'asset_a', progress: { unit: 'seconds', done: 30, total: 60 } });
    const translate = job({
      jobId: 'p1',
      kind: 'pipeline',
      assetId: null,
      phase: 'starting',
      pipeline: { name: 'translate', params: { targetLanguage: 'en', documentId: 'd1' }, steps: [] },
    } as Partial<JobRecord> & Pick<JobRecord, 'jobId'>);
    useJobs.setState({ jobs: [transcribe, translate] });
    await render([segment([])]);
    const text = container.textContent ?? '';
    expect(text).toContain('转录中 · talk.wav');
    expect(text).toContain('50%');
    expect(text).toContain('转录完成后，台词按句出现在这里。');
    expect(text).toContain('翻译完成后，译文显示在每句原文下面。');
    // 转录中的空态不再指去时间线编辑器。
    expect(text).toContain('还没有文稿');
    expect(text).not.toContain('在时间线编辑器里转写');
    const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === label);
    await act(async () => button('取消转录')!.click());
    await act(async () => button('取消翻译')!.click());
    expect(cancelJob.mock.calls).toEqual([['j1'], ['p1']]);
  });

  it('没有在跑的任务时不占地方；有译文的句在原文下面多一行，只读', async () => {
    await render([segment([{ id: 'l1', start: 0, end: 2, text: 'Hello there.', translation: '你好。' }])]);
    expect(container.querySelector('[role="status"]')).toBeNull();
    const row = container.querySelector('button[aria-current], button[aria-label*="Hello"]');
    expect(row?.textContent).toContain('Hello there.');
    expect(row?.textContent).toContain('你好。');
    expect(container.querySelector('input, textarea, [contenteditable="true"]')).toBeNull();
  });
});
