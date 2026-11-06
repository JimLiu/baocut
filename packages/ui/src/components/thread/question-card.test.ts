// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@baocut/protocol';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { QuestionCard } from './question-card.tsx';

type Approval = Extract<TimelineItem, { kind: 'approval' }>;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const question: Approval = {
  kind: 'approval', id: 'approval/q1', taskId: 'task_1', approvalId: 'q1',
  createdAt: '2026-01-01T00:00:00Z', decidedAt: '2026-01-01T00:01:00Z', status: 'cancelled',
  request: { kind: 'question', reason: null, rule: null, questions: [
    { id: 'plan', header: 'Plan', question: 'Which production plan?', multiSelect: false, allowOther: true, options: [
      { label: 'Make a sample', description: 'Review a short sample first.' },
      { label: 'Make the full video', description: 'Use the agreed storyboard.' },
    ] },
    { id: 'tracks', header: 'Tracks', question: 'Which tracks?', multiSelect: true, allowOther: false, options: [
      { label: 'Voice', description: 'Use the selected voice.' }, { label: 'Music', description: null },
    ] },
    { id: 'notes', header: 'Notes', question: 'Anything else?', multiSelect: false, allowOther: true, options: [] },
  ] },
};

let host: HTMLElement;
let root: Root;
const answerQuestion = vi.fn();
const respondToApproval = vi.fn();
const runtime = { answerQuestion, respondToApproval } as unknown as RuntimeSession;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  answerQuestion.mockClear();
  respondToApproval.mockClear();
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
});

async function show(item: Approval) {
  await act(() => root.render(createElement(RuntimeContext.Provider, { value: runtime },
    createElement(QuestionCard, { item, conversationId: 'conv_1' }))));
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await act(() => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
}

describe('question history', () => {
  it.each(['cancelled', 'declined', 'accepted'] as const)('%s questions retain their original options and descriptions as read-only content', async (status) => {
    await show({ ...question, status, ...(status === 'accepted' ? { answers: { plan: ['Make a sample'], tracks: ['Voice'], notes: ['Keep the ending.'] } } : {}) });
    expect(host.textContent).toContain('Which production plan?');
    expect(host.textContent).toContain('Make a sample');
    expect(host.textContent).toContain('Review a short sample first.');
    expect(host.textContent).toContain('Make the full video');
    expect(host.textContent).toContain('Use the agreed storyboard.');
    expect(host.textContent).toContain('Tracks');
    expect(host.textContent).toContain('Use the selected voice.');
    expect(host.textContent).toContain('Anything else?');
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(4);
    expect(host.querySelector('input, textarea, [role="radio"], [role="checkbox"]')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(1);
    if (status === 'accepted') expect(host.textContent).toContain('Keep the ending.');
    expect(answerQuestion).not.toHaveBeenCalled();
    expect(respondToApproval).not.toHaveBeenCalled();
  });
});
