import type { ForkVideoOption } from '@baocut/protocol';
import type { Turn } from './agent-turn.ts';
import { FORK_COPY as F } from '../components/thread/fork-copy.ts';

/*
 * 分叉（产品设计 §3.2.2「分叉」，原型 model-agent-fork.js）里界面要算的东西：哪一轮能分叉、「把视频回到那时」每部视频的一行说明、
 * 菜单第二项的状态。回得去、回到哪一版由 Runtime 按版本记录算（`conversations.forkVideos`）。
 */

/** 这一轮能不能分叉：已经结束（不在跑、不在停、不在等你），有你的话也有回复。 */
export function forkable(turn: Turn, live: boolean): boolean {
  const task = turn.task;
  if (live || !task || !turn.hasUser || !turn.replied || turn.waiting) return false;
  return task.endedAt !== null && task.status !== 'running' && task.status !== 'stopping';
}

/** 每部视频的一行说明。 */
export function restoreNote(option: ForkVideoOption): string {
  switch (option.state) {
    case 'ok':
      return F.ok(option.version ?? 0, option.undone ?? 0);
    case 'pruned':
      return F.pruned;
    case 'created-after':
      return F.createdAfter;
    case 'chain-broken':
      return F.chainBroken;
  }
}

/** 菜单第二项：没有要回的视频时不出现；都回不去时变灰并写原因；回得去的只有一部时写它，多部时写几部。 */
export function restoreItem(options: readonly ForkVideoOption[]): { disabled: boolean; note: string } | null {
  if (!options.length) return null;
  const ok = options.filter((o) => o.state === 'ok');
  if (!ok.length) return { disabled: true, note: options.length === 1 ? restoreNote(options[0]!) : F.restoreNone };
  return { disabled: false, note: ok.length === 1 ? F.restoreOne(ok[0]!.videoName) : F.restoreMany(ok.length) };
}
