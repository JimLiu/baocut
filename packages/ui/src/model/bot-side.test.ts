import { describe, expect, it } from 'vitest';
import {
  afterFixedClose,
  botBarBounds,
  closeSideTab,
  fullColumns,
  fullSplit,
  openFixedTab,
  reconcileSideTabs,
  SIDE_MIN,
  sideMode,
  sideTabBook,
  sideTabFromRoute,
  sideWidth,
  type SideTabs,
} from './bot-side.ts';

const task = (id: string) => sideTabFromRoute(id)!;

describe('bot right panel', () => {
  it('keys tab books by channel, the default channel and the inbox', () => {
    expect(sideTabBook({ channelId: 'c1', view: 'channel' })).toBe('c1');
    expect(sideTabBook({ channelId: null, view: 'channel' })).toBe('chan_main');
    expect(sideTabBook({ channelId: 'c1', view: 'inbox' })).toBe('inbox');
    expect(sideTabFromRoute(null)).toBeNull();
    expect(sideTabFromRoute('wi_a')).toEqual({ key: 'task:wi_a', kind: 'task', workItemId: 'wi_a' });
  });

  it('opens the route task at the end, keeps open tabs when the route goes back to a fixed tab, and returns the same book when nothing changed', () => {
    let s = reconcileSideTabs(undefined, task('a'));
    expect(s).toEqual({ tabs: [task('a')], active: 'task:a' });
    s = reconcileSideTabs(s, task('b'));
    expect(s.tabs.map((t) => t.key)).toEqual(['task:a', 'task:b']);
    expect(reconcileSideTabs(s, task('b'))).toBe(s);
    s = reconcileSideTabs(s, task('a'));
    expect(s.tabs.map((t) => t.key)).toEqual(['task:a', 'task:b']);
    expect(s.active).toBe('task:a');
    s = reconcileSideTabs(s, null);
    expect(s.active).toBeNull();
    expect(s.tabs).toHaveLength(2);
    expect(reconcileSideTabs(s, null)).toBe(s);
  });

  it('closes a tab and selects the right neighbour, the left one at the end, nothing when none is left', () => {
    const s: SideTabs = { tabs: ['a', 'b', 'c'].map(task), active: 'task:b' };
    expect(closeSideTab(s, 'task:b').active).toBe('task:c');
    expect(closeSideTab({ ...s, active: 'task:c' }, 'task:c').active).toBe('task:b');
    expect(closeSideTab(s, 'task:a').active).toBe('task:b');
    expect(closeSideTab({ tabs: [task('a')], active: 'task:a' }, 'task:a').active).toBeNull();
    expect(closeSideTab(s, 'task:x')).toBe(s);
  });

  it('puts fixed tabs back in Tasks, Make order and picks the neighbour after closing the shown one', () => {
    expect(openFixedTab(['make'], 'tasks')).toEqual(['tasks', 'make']);
    expect(openFixedTab([], 'make')).toEqual(['make']);
    expect(openFixedTab(['tasks', 'make'], 'make')).toEqual(['tasks', 'make']);
    const tabs = [task('a'), task('b')];
    expect(afterFixedClose(['tasks', 'make'], 'tasks', tabs)).toBe('fixed:make');
    expect(afterFixedClose(['tasks', 'make'], 'make', tabs)).toBe('task:a');
    expect(afterFixedClose(['tasks', 'make'], 'make', [])).toBe('fixed:tasks');
    expect(afterFixedClose(['make'], 'make', [])).toBeNull();
    expect(afterFixedClose(['tasks'], 'make', tabs)).toBeNull();
  });

  it('sizes the panel per mode within [300, main - 360]', () => {
    expect(sideWidth('tasks', undefined, 1200).width).toBe(340);
    expect(sideWidth('make', undefined, 1200).width).toBe(380);
    expect(sideWidth('detail', undefined, 1200).width).toBe(540);
    expect(sideWidth('detail', undefined, 2000).width).toBe(640);
    expect(sideWidth('tasks', 100, 1200).width).toBe(SIDE_MIN);
    expect(sideWidth('tasks', 5000, 1200)).toEqual({ width: 840, min: SIDE_MIN, max: 840 });
    expect(sideWidth('detail', undefined, 600).width).toBe(SIDE_MIN);
    expect(sideMode(null, 'make')).toBe('make');
    expect(sideMode(task('a'), 'make')).toBe('detail');
  });

  it('splits the full view into the parent level and the current tab', () => {
    expect(fullColumns(task('a'), 'make', false)).toEqual({ left: 'tasks', right: task('a') });
    expect(fullColumns(task('a'), 'tasks', true)).toEqual({ left: 'inbox', right: task('a') });
    expect(fullColumns(null, 'make', false)).toEqual({ left: 'make', right: null });
    expect(fullSplit('tasks', undefined, 1200).width).toBe(340);
    expect(fullSplit('make', undefined, 1200).width).toBe(380);
    expect(fullSplit('inbox', 2000, 1200)).toEqual({ width: 720, min: SIDE_MIN, max: 720 });
  });
});

describe('bot title bar', () => {
  const base = { origin: 0, width: 1400, navRight: 120, content: { left: 260, right: 1400 }, shown: true, single: false };
  it('puts the head over the middle column and the tabs from the right panel’s left edge', () => {
    const out = botBarBounds({ ...base, main: { left: 260, right: 1000 }, side: { left: 1000, right: 1400 } });
    expect(out).toEqual({ head: { left: 260, width: 740 }, strip: { left: 1000, right: 8 }, divider: true });
  });
  it('runs the head to the middle column’s right edge when the panel is hidden, and clears the back and forward buttons', () => {
    const out = botBarBounds({ ...base, content: { left: 0, right: 1400 }, main: { left: 0, right: 1400 }, side: null, shown: false });
    expect(out.head).toEqual({ left: 132, width: 1268 });
    expect(out.strip).toBeNull();
  });
  it('drops a head narrower than 160, and starts the strip at the page edge when single or full', () => {
    expect(botBarBounds({ ...base, main: { left: 260, right: 400 }, side: { left: 400, right: 1400 } }).head).toBeNull();
    const single = botBarBounds({ ...base, single: true, main: null, side: { left: 260, right: 1400 } });
    expect(single).toEqual({ head: null, strip: { left: 260, right: 8 }, divider: false });
    const full = botBarBounds({ ...base, main: null, side: { left: 260, right: 1400 } });
    expect(full.divider).toBe(false);
  });
});
