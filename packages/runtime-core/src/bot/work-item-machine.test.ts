import { describe, expect, it } from 'vitest';
import type { BotActor, ThreadReport, ThreadStop, WorkItem, WorkItemEvent, WorkItemQuestion } from '@baocut/protocol';
import { TransitionDenied, applyEvent, continueQuestion, newWorkItem, stateName, type MachineContext, type MachineRun } from './work-item-machine.ts';

/** 任务状态机（技术方案 §9.2 转换表）：每条允许的转换与表外被拒的事件。纯函数，不起 Harness。 */

const NOW = '2026-10-31T10:00:00.000Z';
const EARLIER = '2026-10-31T09:00:00.000Z';

function item(patch: Partial<WorkItem> = {}): WorkItem {
  return newWorkItem({ id: 'wi_1', channelId: 'chan_1', title: 'Add captions', owner: 'agent', ...patch }, EARLIER);
}

const active = (state: NonNullable<WorkItem['active']>['state'], patch: Partial<WorkItem> = {}) =>
  item({ status: 'active', active: { state, reason: null, since: EARLIER }, threadId: 'conv_thread', ...patch });

const suggested = (patch: Partial<WorkItem> = {}) =>
  item({
    status: 'suggested',
    suggestion: {
      reason: 'Long video',
      owner: 'agent',
      evidence: [],
      trigger: 'manual',
      kindTag: 'chapters',
      subjectKey: 'chapters:x',
      expiresAt: '2026-11-07T00:00:00.000Z',
    },
    ...patch,
  });

const resolved = (patch: Partial<WorkItem> = {}) =>
  item({
    status: 'resolved',
    resolution: { kind: 'done', by: 'user', at: EARLIER, evidence: null, confirmedBy: null, mergedInto: null },
    threadId: 'conv_thread',
    ...patch,
  });

function run(patch: Partial<MachineRun> = {}): MachineRun {
  return { conversationId: 'conv_thread', origin: 'user', attended: true, tainted: false, userCitations: new Set(), userMessageId: 'msg_user', ...patch };
}

function ctx(actor: BotActor, extra: Partial<MachineContext> = {}): MachineContext {
  return { actor, now: NOW, ...extra };
}

function report(stop: ThreadStop, patch: Partial<ThreadReport> = {}): ThreadReport {
  return {
    id: `rep_${stop}`,
    workItemId: 'wi_1',
    threadId: 'conv_thread',
    taskId: 'task_1',
    stop,
    headline: `Stopped at ${stop}.`,
    text: '',
    question: null,
    outputs: [],
    userTodos: [],
    followUps: [],
    waitingFor: null,
    appliedRules: [],
    fallback: false,
    createdAt: NOW,
    delivery: 'pending',
    ...patch,
  };
}

const question = (patch: Partial<WorkItemQuestion> = {}): WorkItemQuestion => ({
  text: 'Which cover?',
  kind: 'input',
  options: [
    { label: 'A', description: null },
    { label: 'B', description: null },
  ],
  pick: null,
  risky: false,
  askedBy: 'thread',
  approvalId: null,
  ...patch,
});

function denied(current: WorkItem, event: WorkItemEvent, c: MachineContext, reason?: string): void {
  let error: unknown;
  try {
    applyEvent(current, event, c);
  } catch (e) {
    error = e;
  }
  expect(error, `${event.type} by ${c.actor} from ${stateName(current)} should be denied`).toBeInstanceOf(TransitionDenied);
  if (reason) expect((error as TransitionDenied).reason).toBe(reason);
}

const kinds = (effects: { kind: string }[]) => effects.map((e) => e.kind);

describe('stateName', () => {
  it('names active sub-states, resolutions and plain statuses', () => {
    expect(stateName(item())).toBe('upNext');
    expect(stateName(active('needsInput'))).toBe('needsInput');
    expect(stateName({ status: 'active', active: null, resolution: null })).toBe('working');
    expect(stateName(resolved())).toBe('done');
    expect(stateName({ status: 'resolved', active: null, resolution: null })).toBe('done');
  });

  it('continueQuestion asks continue or stop and is system-asked', () => {
    const q = continueQuestion();
    expect(q.options).toHaveLength(2);
    expect(q).toMatchObject({ askedBy: 'system', approvalId: null, risky: false, pick: null });
  });
});

describe('accept', () => {
  it('user accepts a suggestion into upNext and clears it', () => {
    const r = applyEvent(suggested(), { type: 'accept', start: false }, ctx('user'));
    expect(r.item).toMatchObject({ status: 'upNext', suggestion: null, updatedAt: NOW });
    expect(r.effects).toEqual([]);
    expect(r.transitions).toEqual([expect.objectContaining({ from: 'suggested', to: 'upNext', actor: 'user', cause: 'user:accept' })]);
  });

  it('user accepts and starts: working with a thread, title the user edited is locked', () => {
    const r = applyEvent(suggested(), { type: 'accept', start: true, title: 'Chapters please' }, ctx('user'));
    expect(stateName(r.item)).toBe('working');
    expect(r.item).toMatchObject({ title: 'Chapters please', titleBy: 'user', lastProgressAt: NOW });
    expect(kinds(r.effects)).toEqual(['start-thread']);
  });

  it('a user-owned suggestion cannot start a thread', () => {
    denied(suggested(), { type: 'accept', start: true, owner: 'user' }, ctx('user'), 'user-owned');
    const r = applyEvent(suggested(), { type: 'accept', start: false, owner: 'user' }, ctx('user'));
    expect(r.item).toMatchObject({ status: 'upNext', owner: 'user' });
  });

  it('only the user, only from suggested', () => {
    for (const actor of ['coordinator', 'thread', 'system'] as const) denied(suggested(), { type: 'accept', start: false }, ctx(actor), `actor-${actor}`);
    denied(item(), { type: 'accept', start: false }, ctx('user'), 'not-suggested');
  });
});

describe('dismiss and expire', () => {
  it('user dismisses a suggestion and its subject is ignored', () => {
    const r = applyEvent(suggested(), { type: 'dismiss' }, ctx('user'));
    expect(r.item.resolution).toMatchObject({ kind: 'dismissed', by: 'user' });
    expect(r.effects).toEqual([{ kind: 'ignore-subject', subjectKey: 'chapters:x' }]);
  });

  it('dismissing a running task stops its thread; a scheduled one is unscheduled', () => {
    expect(kinds(applyEvent(active('working'), { type: 'dismiss' }, ctx('user')).effects)).toEqual(['stop-thread']);
    const s = applyEvent(item({ status: 'scheduled', startAt: NOW }), { type: 'dismiss' }, ctx('user'));
    expect(kinds(s.effects)).toEqual(['unschedule']);
    expect(s.item.startAt).toBeNull();
  });

  it('dismiss is user-only and not for resolved tasks', () => {
    denied(suggested(), { type: 'dismiss' }, ctx('coordinator'));
    denied(resolved(), { type: 'dismiss' }, ctx('user'), 'resolved');
  });

  it('system expires a suggestion; nobody else, nothing else', () => {
    const r = applyEvent(suggested(), { type: 'expire' }, ctx('system'));
    expect(r.item.resolution).toMatchObject({ kind: 'dismissed', by: 'system' });
    expect(kinds(r.effects)).toEqual(['ignore-subject']);
    denied(suggested(), { type: 'expire' }, ctx('user'));
    denied(item(), { type: 'expire' }, ctx('system'), 'not-suggested');
  });
});

describe('schedule, unschedule, start, due', () => {
  it('user schedules an upNext task and can move the time', () => {
    const r = applyEvent(item(), { type: 'schedule', startAt: NOW }, ctx('user'));
    expect(r.item).toMatchObject({ status: 'scheduled', startAt: NOW });
    expect(r.effects).toEqual([{ kind: 'schedule-once', startAt: NOW }]);
    const again = applyEvent(r.item, { type: 'schedule', startAt: '2026-11-01T00:00:00.000Z' }, ctx('user'));
    expect(again.item.startAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('coordinator schedules only when citing a user-typed time', () => {
    denied(item(), { type: 'schedule', startAt: NOW }, ctx('coordinator'), 'needs-user-time');
    denied(item(), { type: 'schedule', startAt: NOW }, ctx('coordinator', { citedUserTyped: false }), 'needs-user-time');
    expect(applyEvent(item(), { type: 'schedule', startAt: NOW }, ctx('coordinator', { citedUserTyped: true })).item.status).toBe('scheduled');
    denied(item(), { type: 'schedule', startAt: NOW }, ctx('thread', { citedUserTyped: true }));
    denied(active('working'), { type: 'schedule', startAt: NOW }, ctx('user'), 'not-up-next');
  });

  it('user unschedules back to upNext', () => {
    const r = applyEvent(item({ status: 'scheduled', startAt: NOW }), { type: 'unschedule' }, ctx('user'));
    expect(r.item).toMatchObject({ status: 'upNext', startAt: null });
    expect(kinds(r.effects)).toEqual(['unschedule']);
    denied(item(), { type: 'unschedule' }, ctx('user'), 'not-scheduled');
    denied(item({ status: 'scheduled', startAt: NOW }), { type: 'unschedule' }, ctx('coordinator'));
  });

  it('user or system starts an agent task from upNext', () => {
    for (const actor of ['user', 'system'] as const) {
      const r = applyEvent(item(), { type: 'start' }, ctx(actor));
      expect(stateName(r.item)).toBe('working');
      expect(kinds(r.effects)).toEqual(['start-thread']);
    }
    denied(item(), { type: 'start' }, ctx('coordinator'));
    denied(item({ owner: 'user' }), { type: 'start' }, ctx('user'), 'user-owned');
    denied(active('working'), { type: 'start' }, ctx('system'), 'not-up-next');
  });

  it('the user can start a scheduled task early: the timer goes and the thread starts', () => {
    const r = applyEvent(item({ status: 'scheduled', startAt: NOW }), { type: 'start' }, ctx('user'));
    expect(stateName(r.item)).toBe('working');
    expect(r.item.startAt).toBeNull();
    expect(kinds(r.effects)).toEqual(['unschedule', 'start-thread']);
    denied(item({ status: 'scheduled', startAt: NOW }), { type: 'start' }, ctx('system'), 'not-up-next');
  });

  it('due starts an agent task; a user task only gets a reminder (BOT-TK-04)', () => {
    const agent = applyEvent(item({ status: 'scheduled', startAt: NOW }), { type: 'due' }, ctx('system'));
    expect(stateName(agent.item)).toBe('working');
    expect(agent.item.startAt).toBeNull();
    expect(kinds(agent.effects)).toEqual(['start-thread']);
    const user = applyEvent(item({ status: 'scheduled', startAt: NOW, owner: 'user' }), { type: 'due' }, ctx('system'));
    expect(user.item.status).toBe('upNext');
    expect(user.effects).toEqual([{ kind: 'reminder' }, { kind: 'notify', reason: 'reminder' }]);
    denied(item(), { type: 'due' }, ctx('system'), 'not-scheduled');
    denied(item({ status: 'scheduled', startAt: NOW }), { type: 'due' }, ctx('user'));
  });
});

describe('report', () => {
  it.each([
    ['done', 'needsReview', 'needs-review'],
    ['needs-review', 'needsReview', 'needs-review'],
    ['needs-input', 'needsInput', 'needs-input'],
    ['blocked', 'blocked', null],
    ['waiting', 'waitingOnOthers', null],
  ] as const)('working + report(%s) lands in %s', (stop, state, notify) => {
    const r = applyEvent(active('working'), { type: 'report', report: report(stop, { question: question() }) }, ctx('thread', { run: run({ origin: 'relay' }) }));
    expect(stateName(r.item)).toBe(state);
    expect(r.item.lastReportId).toBe(`rep_${stop}`);
    expect(r.item.question === null).toBe(state === 'waitingOnOthers');
    if (state === 'blocked') expect(r.item.active?.reason).toBe('Stopped at blocked.');
    expect(r.effects).toEqual(notify ? [{ kind: 'notify', reason: notify }] : []);
  });

  it('a thread can never close its task with report(done)', () => {
    const r = applyEvent(active('working'), { type: 'report', report: report('done') }, ctx('thread'));
    expect(r.item.status).toBe('active');
  });

  it('the system fallback report is allowed; coordinator and user are not', () => {
    expect(stateName(applyEvent(active('working'), { type: 'report', report: report('needs-review') }, ctx('system')).item)).toBe('needsReview');
    denied(active('working'), { type: 'report', report: report('done') }, ctx('coordinator'));
    denied(active('working'), { type: 'report', report: report('done') }, ctx('user'));
  });

  it('outputs merge without duplicates', () => {
    const out = { kind: 'file' as const, path: 'a.srt', label: 'Captions', version: null };
    const start = active('working', { outputs: [out] });
    const r = applyEvent(start, { type: 'report', report: report('needs-review', { outputs: [out, { ...out, path: 'b.srt' }] }) }, ctx('thread'));
    expect(r.item.outputs.map((o) => (o as { path: string }).path)).toEqual(['a.srt', 'b.srt']);
  });

  it('a report from a waiting sub-state is denied unless the run is a refresh', () => {
    for (const state of ['needsReview', 'needsInput', 'blocked', 'waitingOnOthers'] as const) {
      denied(active(state), { type: 'report', report: report('needs-review') }, ctx('thread', { run: run({ origin: 'relay' }) }), 'not-working');
    }
  });

  it('a refresh report lands from any sub-state and keeps the old question in the updates (BOT-EX-08)', () => {
    const start = active('needsInput', { question: question({ text: 'Old question?' }) });
    const r = applyEvent(start, { type: 'report', report: report('needs-review', { question: question({ kind: 'review', text: 'Look?' }) }) }, ctx('thread', { run: run({ origin: 'refresh' }) }));
    expect(stateName(r.item)).toBe('needsReview');
    expect(r.item.question?.text).toBe('Look?');
    expect(r.item.updates.at(-1)).toMatchObject({ by: 'system' });
    expect(r.item.updates.at(-1)!.text).toContain('Old question?');
  });

  it('while an approval waits, the report is only remembered and lands when it settles (§9.3)', () => {
    const waiting = active('needsInput', { question: question({ approvalId: 'appr_1', askedBy: 'system' }), beforeInput: 'working' });
    const r = applyEvent(waiting, { type: 'report', report: report('needs-review') }, ctx('thread'));
    expect(stateName(r.item)).toBe('needsInput');
    expect(r.item.deferredStop).toBe('needs-review');
    expect(r.transitions).toEqual([]);
    const settled = applyEvent(r.item, { type: 'approval', approvalId: 'appr_1', pending: false }, ctx('system'));
    expect(stateName(settled.item)).toBe('needsReview');
    expect(settled.item.deferredStop).toBeNull();
    expect(settled.transitions.map((t) => t.to)).toEqual(['working', 'needsReview']);
    expect(settled.effects).toEqual([{ kind: 'notify', reason: 'needs-review' }]);
  });

  it('a needs-input report sent during an approval keeps its question once the approval settles (§9.3)', () => {
    const waiting = active('needsInput', { question: question({ approvalId: 'appr_1', askedBy: 'system', text: 'Allow the export?' }), beforeInput: 'working' });
    const asked = report('needs-input', { question: question({ text: 'Which intro do you want?' }) });
    const r = applyEvent(waiting, { type: 'report', report: asked }, ctx('thread'));
    expect(r.item.deferredStop).toBe('needs-input');
    const settled = applyEvent(r.item, { type: 'approval', approvalId: 'appr_1', pending: false, deferredReport: asked }, ctx('system'));
    expect(stateName(settled.item)).toBe('needsInput');
    expect(settled.item.question?.text).toBe('Which intro do you want?');
    expect(settled.item.question?.approvalId ?? null).toBeNull();
    expect(settled.effects).toEqual([{ kind: 'notify', reason: 'needs-input' }]);
  });

  it('a blocked report sent during an approval keeps its reason once the approval settles', () => {
    const waiting = active('needsInput', { question: question({ approvalId: 'appr_1', askedBy: 'system' }), beforeInput: 'working' });
    const stuck = report('blocked', { headline: 'The source file is missing.' });
    const r = applyEvent(waiting, { type: 'report', report: stuck }, ctx('thread'));
    const settled = applyEvent(r.item, { type: 'approval', approvalId: 'appr_1', pending: false, deferredReport: stuck }, ctx('system'));
    expect(stateName(settled.item)).toBe('blocked');
    expect(settled.item.active?.reason).toBe('The source file is missing.');
  });

  it('a resolved task only takes a done report from the refresh that just closed it (D6)', () => {
    const closed = resolved({ resolution: { kind: 'done', by: 'thread', at: NOW, evidence: [], confirmedBy: null, mergedInto: null } });
    const r = applyEvent(closed, { type: 'report', report: report('done') }, ctx('thread', { run: run({ origin: 'refresh' }), resolvedInThisRefresh: true }));
    expect(r.item.status).toBe('resolved');
    expect(r.item.lastReportId).toBe('rep_done');
    expect(r.transitions).toEqual([]);
    denied(closed, { type: 'report', report: report('done') }, ctx('thread', { run: run({ origin: 'refresh' }) }), 'resolved');
    denied(closed, { type: 'report', report: report('needs-review') }, ctx('thread', { resolvedInThisRefresh: true }), 'resolved');
    denied(item(), { type: 'report', report: report('done') }, ctx('thread'), 'not-active');
  });
});

describe('approval', () => {
  it('pending moves working to needsInput and remembers where it was', () => {
    const q = question({ approvalId: 'appr_1', askedBy: 'system', risky: true });
    const r = applyEvent(active('waitingOnOthers'), { type: 'approval', approvalId: 'appr_1', pending: true, question: q }, ctx('system'));
    expect(stateName(r.item)).toBe('needsInput');
    expect(r.item.beforeInput).toBe('waitingOnOthers');
    expect(r.item.question).toEqual(q);
    expect(r.effects).toEqual([{ kind: 'notify', reason: 'needs-input' }]);
    const back = applyEvent(r.item, { type: 'approval', approvalId: 'appr_1', pending: false }, ctx('system'));
    expect(stateName(back.item)).toBe('waitingOnOthers');
    expect(back.item.question).toBeNull();
  });

  it('a settle for another approval or from a non-waiting state changes nothing', () => {
    const waiting = active('needsInput', { question: question({ approvalId: 'appr_1' }), beforeInput: 'working' });
    expect(applyEvent(waiting, { type: 'approval', approvalId: 'appr_2', pending: false }, ctx('system')).item).toBe(waiting);
    const working = active('working');
    expect(applyEvent(working, { type: 'approval', approvalId: 'appr_1', pending: false }, ctx('system')).item).toBe(working);
    const review = active('needsReview');
    expect(applyEvent(review, { type: 'approval', approvalId: 'appr_1', pending: true }, ctx('system')).item).toBe(review);
    expect(applyEvent(item(), { type: 'approval', approvalId: 'appr_1', pending: true }, ctx('system')).item.status).toBe('upNext');
  });

  it('only the runtime reports approvals', () => {
    for (const actor of ['user', 'coordinator', 'thread'] as const) {
      denied(active('working'), { type: 'approval', approvalId: 'appr_1', pending: true }, ctx(actor));
    }
  });
});

describe('user-replied', () => {
  it.each(['needsReview', 'needsInput', 'blocked'] as const)('%s goes back to working with a short note', (state) => {
    const r = applyEvent(active(state, { question: question() }), { type: 'user-replied', note: 'Use the second cover please' }, ctx('system'));
    expect(stateName(r.item)).toBe('working');
    expect(r.item.question).toBeNull();
    expect(r.transitions[0]!.note).toContain('Use the second cover');
  });

  it('does nothing while working, waiting on others, or while an approval card waits', () => {
    for (const current of [active('working'), active('waitingOnOthers'), active('needsInput', { question: question({ approvalId: 'appr_1' }) }), item()]) {
      expect(applyEvent(current, { type: 'user-replied' }, ctx('user')).item).toBe(current);
    }
    denied(active('needsReview'), { type: 'user-replied' }, ctx('coordinator'));
    denied(active('needsReview'), { type: 'user-replied' }, ctx('thread'));
  });
});

describe('unblocked, stalled, stop', () => {
  it('system and thread unblock blocked or waiting tasks without a continue', () => {
    const r = applyEvent(active('waitingOnOthers'), { type: 'unblocked', cause: 'job-finished' }, ctx('system'));
    expect(stateName(r.item)).toBe('working');
    expect(r.effects).toEqual([]);
    expect(r.transitions[0]!.cause).toBe('unblocked:job-finished');
    expect(stateName(applyEvent(active('blocked'), { type: 'unblocked', cause: 'fixed' }, ctx('thread')).item)).toBe('working');
  });

  it('the user continuing a stalled, stopped or runtime-question task sends the matching continue', () => {
    const stalled = applyEvent(active('working'), { type: 'stalled', reason: 'no-progress', note: '20 min' }, ctx('system')).item;
    expect(applyEvent(stalled, { type: 'unblocked', cause: 'user' }, ctx('user')).effects).toEqual([{ kind: 'continue', reason: 'stalled' }]);
    const stopped = applyEvent(active('working'), { type: 'stop' }, ctx('user')).item;
    expect(applyEvent(stopped, { type: 'unblocked', cause: 'user' }, ctx('user')).effects).toEqual([{ kind: 'continue', reason: 'stopped' }]);
    const runtime = active('needsInput', { question: question({ askedBy: 'system' }) });
    expect(applyEvent(runtime, { type: 'unblocked', cause: 'user' }, ctx('user')).effects).toEqual([{ kind: 'continue', reason: 'needs-you' }]);
    // 线程问的问题、审批卡上的问题不能这样「继续」。
    denied(active('needsInput', { question: question() }), { type: 'unblocked', cause: 'user' }, ctx('user'), 'not-blocked');
    denied(active('needsInput', { question: question({ askedBy: 'system', approvalId: 'appr_1' }) }), { type: 'unblocked', cause: 'user' }, ctx('user'), 'not-blocked');
    denied(runtime, { type: 'unblocked', cause: 'x' }, ctx('system'), 'not-blocked');
  });

  it('unblocked is denied for working tasks, inactive tasks and the coordinator', () => {
    denied(active('working'), { type: 'unblocked', cause: 'x' }, ctx('system'), 'not-blocked');
    denied(item(), { type: 'unblocked', cause: 'x' }, ctx('system'), 'not-active');
    denied(active('blocked'), { type: 'unblocked', cause: 'x' }, ctx('coordinator'));
  });

  it('stalled: working → blocked with continue-or-stop, interrupt and notify', () => {
    const r = applyEvent(active('working'), { type: 'stalled', reason: 'no-progress', note: 'No progress for 20 minutes' }, ctx('system'));
    expect(r.item.active).toMatchObject({ state: 'blocked', reason: 'No progress for 20 minutes' });
    expect(r.item.question).toEqual(continueQuestion());
    expect(r.effects).toEqual([{ kind: 'interrupt-thread' }, { kind: 'notify', reason: 'stalled' }]);
    expect(r.transitions[0]!.cause).toBe('stalled:no-progress');
  });

  it('stalled: a hung job stalls a waiting task, nothing else does; budget marks the warning', () => {
    expect(stateName(applyEvent(active('waitingOnOthers'), { type: 'stalled', reason: 'job-hung', note: 'Dub hung' }, ctx('system')).item)).toBe('blocked');
    denied(active('waitingOnOthers'), { type: 'stalled', reason: 'no-progress', note: '' }, ctx('system'), 'not-working');
    denied(active('needsReview'), { type: 'stalled', reason: 'no-progress', note: '' }, ctx('system'), 'not-working');
    denied(item(), { type: 'stalled', reason: 'no-progress', note: '' }, ctx('system'), 'not-active');
    denied(active('working'), { type: 'stalled', reason: 'no-progress', note: '' }, ctx('user'));
    expect(applyEvent(active('working'), { type: 'stalled', reason: 'budget', note: '80%' }, ctx('system')).item.budgetWarnedAt).toBe(NOW);
  });

  it('stop: user only, active only', () => {
    const r = applyEvent(active('waitingOnOthers'), { type: 'stop' }, ctx('user'));
    expect(stateName(r.item)).toBe('blocked');
    expect(r.item.question).toEqual(continueQuestion());
    expect(kinds(r.effects)).toEqual(['stop-thread']);
    denied(item(), { type: 'stop' }, ctx('user'), 'not-active');
    denied(active('working'), { type: 'stop' }, ctx('coordinator'));
  });
});

describe('resolve', () => {
  it('the user closes upNext, scheduled and active tasks', () => {
    expect(applyEvent(item(), { type: 'resolve', evidence: null }, ctx('user')).item.resolution).toMatchObject({ kind: 'done', by: 'user' });
    const s = applyEvent(item({ status: 'scheduled', startAt: NOW }), { type: 'resolve', evidence: null }, ctx('user'));
    expect(kinds(s.effects)).toEqual(['unschedule', 'release-session']);
    const a = applyEvent(active('needsReview'), { type: 'resolve', evidence: null }, ctx('user'));
    expect(kinds(a.effects)).toEqual(['stop-thread', 'release-session']);
    expect(a.item.question).toBeNull();
  });

  it('suggestions and resolved tasks cannot be resolved', () => {
    denied(suggested(), { type: 'resolve', evidence: null }, ctx('user'), 'suggested');
    denied(resolved(), { type: 'resolve', evidence: null }, ctx('user'), 'resolved');
  });

  it('an agent closes for the user only on the typed message that started this clean, attended turn', () => {
    const ok = applyEvent(active('needsReview'), { type: 'resolve', evidence: null, confirmedBy: 'msg_user' }, ctx('coordinator', { run: run(), confirmedIsTyped: true }));
    expect(ok.item.resolution).toMatchObject({ kind: 'done', by: 'user', confirmedBy: 'msg_user' });
    expect(ok.transitions[0]).toMatchObject({ cause: 'user:confirmed', citedMessageId: 'msg_user' });
    expect(kinds(ok.effects)).toEqual(['stop-thread', 'release-session']);
    const event: WorkItemEvent = { type: 'resolve', evidence: null, confirmedBy: 'msg_user' };
    denied(active('needsReview'), event, ctx('coordinator', { run: run({ tainted: true }), confirmedIsTyped: true }), 'not-confirmed');
    denied(active('needsReview'), event, ctx('coordinator', { run: run({ attended: false }), confirmedIsTyped: true }), 'not-confirmed');
    denied(active('needsReview'), event, ctx('coordinator', { run: run({ userMessageId: 'msg_other' }), confirmedIsTyped: true }), 'not-confirmed');
    denied(active('needsReview'), event, ctx('coordinator', { run: run(), confirmedIsTyped: false }), 'not-confirmed');
    denied(active('needsReview'), event, ctx('coordinator'), 'not-confirmed');
    // 线程替用户关不停自己的线程。
    expect(kinds(applyEvent(active('needsReview'), event, ctx('thread', { run: run(), confirmedIsTyped: true })).effects)).toEqual(['release-session']);
  });

  it('a thread closes on evidence only in a refresh turn with verified evidence (§9.5)', () => {
    const evidence = [{ kind: 'past-date' as const, date: '2026-10-30' }];
    const ok = applyEvent(active('needsReview'), { type: 'resolve', evidence }, ctx('thread', { run: run({ origin: 'refresh', attended: false }), evidenceVerified: true }));
    expect(ok.item.resolution).toMatchObject({ kind: 'done', by: 'thread', evidence });
    expect(ok.transitions[0]).toMatchObject({ cause: 'thread:evidence', evidence });
    denied(active('needsReview'), { type: 'resolve', evidence }, ctx('thread', { run: run({ origin: 'relay' }), evidenceVerified: true }), 'needs-refresh');
    denied(active('needsReview'), { type: 'resolve', evidence }, ctx('thread', { run: run({ origin: 'refresh' }), evidenceVerified: false }), 'evidence-rejected');
    denied(active('needsReview'), { type: 'resolve', evidence: [] }, ctx('thread', { run: run({ origin: 'refresh' }), evidenceVerified: true }), 'evidence-rejected');
    denied(item(), { type: 'resolve', evidence }, ctx('thread', { run: run({ origin: 'refresh' }), evidenceVerified: true }), 'needs-refresh');
    denied(active('needsReview'), { type: 'resolve', evidence }, ctx('coordinator', { run: run({ origin: 'refresh' }), evidenceVerified: true }), 'needs-refresh');
    denied(active('needsReview'), { type: 'resolve', evidence: null }, ctx('system'), 'actor-system');
  });
});

describe('reopen', () => {
  it('the user reopens: agent tasks go back to work with a thread, user tasks to upNext', () => {
    const r = applyEvent(resolved(), { type: 'reopen' }, ctx('user'));
    expect(stateName(r.item)).toBe('working');
    expect(r.item.resolution).toBeNull();
    expect(kinds(r.effects)).toEqual(['start-thread']);
    expect(r.transitions[0]!.cause).toBe('user:reopen');
    const u = applyEvent(resolved({ owner: 'user' }), { type: 'reopen' }, ctx('user'));
    expect(u.item).toMatchObject({ status: 'upNext', resolution: null });
  });

  it('a thread reopens only in a typed user turn or with a relayed user citation (§7.3)', () => {
    const typed = applyEvent(resolved(), { type: 'reopen' }, ctx('thread', { run: run() }));
    expect(stateName(typed.item)).toBe('working');
    expect(typed.effects).toEqual([]);
    const cited = applyEvent(
      resolved(),
      { type: 'reopen', citedMessageId: 'msg_c' },
      ctx('thread', { run: run({ origin: 'relay', attended: false, userMessageId: null, userCitations: new Set(['msg_c']) }) }),
    );
    expect(cited.transitions[0]).toMatchObject({ cause: 'thread:reopen', citedMessageId: 'msg_c' });
    const relayRun = run({ origin: 'relay', attended: false, userMessageId: null });
    denied(resolved(), { type: 'reopen' }, ctx('thread', { run: relayRun }), 'needs-user-words');
    denied(resolved(), { type: 'reopen', citedMessageId: 'msg_c' }, ctx('thread', { run: relayRun }), 'needs-user-words');
    denied(resolved(), { type: 'reopen' }, ctx('thread'), 'needs-user-words');
    // 系统的隐式重开按同一条规则。
    expect(applyEvent(resolved(), { type: 'reopen' }, ctx('system', { run: run() })).transitions[0]!.cause).toBe('system:implicit-reopen');
    denied(resolved(), { type: 'reopen' }, ctx('system', { run: relayRun }), 'needs-user-words');
  });

  it('not for unresolved tasks, not for the coordinator', () => {
    denied(active('working'), { type: 'reopen' }, ctx('user'), 'not-resolved');
    denied(resolved(), { type: 'reopen' }, ctx('coordinator', { run: run() }), 'actor-coordinator');
  });
});

describe('merge and set-owner', () => {
  it('coordinator merges with the user consent; user merges directly', () => {
    const r = applyEvent(active('working'), { type: 'merge', into: 'wi_2' }, ctx('coordinator', { citedUserTyped: true }));
    expect(r.item.resolution).toMatchObject({ kind: 'merged', by: 'coordinator', mergedInto: 'wi_2' });
    expect(kinds(r.effects)).toEqual(['stop-thread', 'merge']);
    expect(applyEvent(item(), { type: 'merge', into: 'wi_2' }, ctx('user')).item.resolution?.kind).toBe('merged');
    denied(item(), { type: 'merge', into: 'wi_2' }, ctx('coordinator'), 'needs-user-consent');
    denied(item(), { type: 'merge', into: 'wi_1' }, ctx('user'), 'self');
    denied(resolved(), { type: 'merge', into: 'wi_2' }, ctx('user'), 'resolved');
    denied(item(), { type: 'merge', into: 'wi_2' }, ctx('thread', { citedUserTyped: true }));
  });

  it('handing a running task to the user stops the thread; giving it back may start it', () => {
    const r = applyEvent(active('working', { question: question() }), { type: 'set-owner', owner: 'user' }, ctx('user'));
    expect(r.item).toMatchObject({ status: 'upNext', owner: 'user', question: null });
    expect(kinds(r.effects)).toEqual(['stop-thread']);
    const back = applyEvent(item({ owner: 'user' }), { type: 'set-owner', owner: 'agent' }, ctx('user'));
    expect(back.item.owner).toBe('agent');
    expect(kinds(back.effects)).toEqual(['maybe-start']);
    const same = item();
    expect(applyEvent(same, { type: 'set-owner', owner: 'agent' }, ctx('user')).item).toBe(same);
    denied(item(), { type: 'set-owner', owner: 'user' }, ctx('coordinator'));
    denied(resolved(), { type: 'set-owner', owner: 'user' }, ctx('user'), 'resolved');
  });
});

it('events outside the table are denied', () => {
  denied(active('working'), { type: 'thread-activity', activity: 'running', taskStatus: null }, ctx('system'), 'unknown');
});

it('applyEvent never mutates its input', () => {
  const current = active('working');
  const copy = structuredClone(current);
  applyEvent(current, { type: 'report', report: report('needs-review') }, ctx('thread'));
  expect(current).toEqual(copy);
});
