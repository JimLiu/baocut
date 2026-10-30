import { describe, expect, it } from 'vitest';
import type { ForkVideoOption, TimelineItem } from '@baocut/protocol';
import { FORK_COPY as F } from '../components/thread/fork-copy.ts';
import { forkable, restoreItem, restoreNote } from './agent-fork.ts';
import type { Turn } from './agent-turn.ts';

/** 分叉菜单（产品设计 §3.2.2「分叉」）：哪一轮能分叉、「把视频回到那时」那一项的状态与每部视频的说明。 */

const task = (status: 'running' | 'completed' | 'stopped' | 'failed', endedAt: string | null) =>
  ({ kind: 'task', id: 't1', createdAt: '', taskId: 't1', goal: '', status, startedAt: '', endedAt, error: null }) as Extract<
    TimelineItem,
    { kind: 'task' }
  >;
const turn = (patch: Partial<Turn>): Turn => ({
  start: 0,
  end: 1,
  hasUser: true,
  replied: true,
  text: 'ok',
  task: task('completed', '2026-10-30T08:00:00.000Z'),
  waiting: false,
  answer: false,
  ...patch,
});

describe('forkable', () => {
  it('结束了、有你的话也有回复的一轮才能分叉', () => {
    expect(forkable(turn({}), false)).toBe(true);
    expect(forkable(turn({ task: task('stopped', '2026-10-30T08:00:00.000Z') }), false)).toBe(true);
    expect(forkable(turn({}), true)).toBe(false);
    expect(forkable(turn({ task: task('running', null) }), false)).toBe(false);
    expect(forkable(turn({ replied: false }), false)).toBe(false);
    expect(forkable(turn({ hasUser: false }), false)).toBe(false);
    expect(forkable(turn({ waiting: true }), false)).toBe(false);
    expect(forkable(turn({ task: null }), false)).toBe(false);
  });
});

describe('restoreItem', () => {
  const ok: ForkVideoOption = { videoId: 'a', videoName: 'Trailer', state: 'ok', version: 3, undone: 2 };
  const pruned: ForkVideoOption = { videoId: 'b', videoName: 'Teaser', state: 'pruned' };

  it('没有要回的视频时不出现；回得去的只有一部时写它，多部时写几部', () => {
    expect(restoreItem([])).toBeNull();
    expect(restoreItem([ok])).toEqual({ disabled: false, note: F.restoreOne('Trailer') });
    expect(restoreItem([pruned, ok])).toEqual({ disabled: false, note: F.restoreOne('Trailer') });
    expect(restoreItem([ok, { ...ok, videoId: 'c' }, pruned])).toEqual({ disabled: false, note: F.restoreMany(2) });
  });

  it('都回不去时变灰：一部写它的原因，多部写总的', () => {
    expect(restoreItem([pruned])).toEqual({ disabled: true, note: restoreNote(pruned) });
    expect(restoreItem([pruned, { ...pruned, videoId: 'c', state: 'chain-broken' }])).toEqual({
      disabled: true,
      note: F.restoreNone,
    });
  });

  it('每部视频一行说明', () => {
    expect(restoreNote(ok)).toBe(F.ok(3, 2));
    expect(restoreNote(pruned)).toBe(F.pruned);
    expect(restoreNote({ ...pruned, state: 'created-after' })).toBe(F.createdAfter);
  });
});
