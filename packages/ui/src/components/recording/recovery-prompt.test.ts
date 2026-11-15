// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RECORDING_DEFAULTS, type RecordingSummary } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { RC } from './recording-copy.ts';
import { RecoveryList, RecoveryPrompt } from './recovery-prompt.tsx';

const rec = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  recordingId: 'rec_1',
  state: 'importable',
  jobId: 'job_1',
  options: RECORDING_DEFAULTS,
  target: { create: { projectId: 'p' } },
  requestedBy: null,
  createdAt: '2026-11-15T10:00:00.000Z',
  startedAt: '2026-11-15T10:00:03.000Z',
  elapsed: 95,
  streams: [],
  videoId: null,
  unfinished: true,
  dir: '/tmp/rec_1',
  error: null,
  result: null,
  ...over,
});

const desktop = { host: { platform: 'darwin', recording: { openSystemSettings: async () => {}, configure: () => {} } } } as unknown as RuntimeSession;
const web = { host: { platform: 'web' } } as unknown as RuntimeSession;

const render = (runtime: RuntimeSession, recordings: RecordingSummary[]) =>
  renderToStaticMarkup(createElement(RuntimeContext.Provider, { value: runtime }, createElement(RecoveryList, { recordings })));

describe('RecoveryPrompt', () => {
  it('没收完的录制：提最新的一条，给恢复与删除，其余写还有几条', () => {
    const html = render(desktop, [rec(), rec({ recordingId: 'rec_2', createdAt: '2026-11-15T11:00:00.000Z' }), rec({ recordingId: 'rec_3', state: 'in-timeline', unfinished: false })]);
    expect(html).toContain(RC.recoverTitle);
    expect(html).toContain('data-recording="rec_2"');
    expect(html).toContain(RC.recover);
    expect(html).toContain(RC.delete);
    expect(html).toContain(RC.recoverMore(1));
  });

  it('没有没收完的、或在 Web 上：什么都不显示', () => {
    expect(render(desktop, [rec({ state: 'failed', unfinished: false })])).toBe('');
    expect(renderToStaticMarkup(createElement(RuntimeContext.Provider, { value: web }, createElement(RecoveryPrompt)))).toBe('');
  });
});
