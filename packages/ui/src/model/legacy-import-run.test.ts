import { describe, expect, it } from 'vitest';
import type { LegacyImportItem, LegacyImportRun } from '@baocut/protocol';
import {
  cardHint,
  cardNote,
  finishToast,
  itemNote,
  legacyTaskRow,
  pendingPaths,
  problemGroups,
  revealTarget,
  runBanner,
  runCounts,
  runSub,
} from './legacy-import-run.ts';

const DRIVE = { root: '/Volumes/Extreme SSD', name: 'Extreme SSD' };

function item(title: string, state: LegacyImportItem['state'], problem: LegacyImportItem['problem'] = null): LegacyImportItem {
  return { path: `/old/projects/${title}`, title, editedAt: null, state, problem };
}

function run(items: LegacyImportItem[], state: LegacyImportRun['state'] = 'finished'): LegacyImportRun {
  return {
    runId: 'r1',
    directory: '/Users/me/Documents/BaoCut',
    state,
    startedAt: '2026-10-08T10:00:00.000Z',
    finishedAt: state === 'finished' ? '2026-10-08T10:05:00.000Z' : null,
    items,
  };
}

const kyoto = item('京都', 'not-imported', {
  kind: 'offline',
  volume: DRIVE,
  missing: ['/Volumes/Extreme SSD/2025/京都/A001.MP4', '/Volumes/Extreme SSD/2025/京都/A002.MP4'],
  missingCount: 7,
});
const iceland = item('冰岛', 'not-imported', { kind: 'offline', volume: DRIVE, missing: ['/Volumes/Extreme SSD/冰岛.MP4'], missingCount: 1 });
const course = item('课程', 'not-imported', { kind: 'missing', missing: ['/Users/me/Movies/第 2 讲.mov'], missingCount: 1 });
const broken = item('读书会', 'not-imported', { kind: 'unreadable' });
const failed = item('发布会', 'not-imported', { kind: 'failed', report: '/Users/me/Documents/BaoCut/发布会/import-report.json' });

const finished = run([item('a', 'imported'), item('b', 'imported'), kyoto, iceland, course, broken, failed, item('c', 'skipped')]);

describe('legacy-import-run', () => {
  it('计数：没导入的不含跳过的；这一轮要导入的不算跳过的', () => {
    expect(runCounts(finished)).toEqual({ imported: 2, pending: 5, skipped: 1, queued: 0, importing: 0, live: 0, total: 7 });
  });

  it('原因分组：每块没接上的硬盘一组，其余按原因各一组，每组有原因与怎么办', () => {
    const groups = problemGroups(finished);
    expect(groups.map((g) => [g.kind, g.items.length])).toEqual([
      ['offline', 2],
      ['missing', 1],
      ['unreadable', 1],
      ['failed', 1],
    ]);
    expect(groups[0]!.title).toBe('移动硬盘「Extreme SSD」没接上');
    expect(groups[0]!.why).toBe('这 2 个项目用到的视频在这块硬盘上（/Volumes/Extreme SSD），现在读不到。');
    expect(groups[0]!.fix).toMatch(/下次启动 BaoCut 会自动再试/);
    for (const g of groups) expect(g.title && g.why && g.fix && g.short).toBeTruthy();
  });

  it('卡片上的原因与怎么办：有没接上的硬盘先说接上它', () => {
    expect(cardNote(finished)).toBe(
      '2 个项目的素材在没接上的「Extreme SSD」上，1 个项目的素材文件找不到，1 个项目的文件读不出来，1 个项目导入到一半出错。',
    );
    expect(cardHint(finished)).toMatch(/^接上「Extreme SSD」后点「全部重试」/);
    expect(cardHint(run([course]))).toBe('每个的原因和处理办法在详情里；不需要的可以跳过。');
    expect(cardNote(run([item('a', 'imported')]))).toBe('');
  });

  it('每一行的说明与「在文件夹中显示」的目标', () => {
    expect(itemNote(kyoto)).toBe('缺 7 个文件，例如 /Volumes/Extreme SSD/2025/京都/A001.MP4');
    expect(itemNote(course)).toBe('缺 /Users/me/Movies/第 2 讲.mov');
    expect(itemNote(broken)).toBe(broken.path);
    expect(itemNote(failed)).toBe('导入记录：/Users/me/Documents/BaoCut/发布会/import-report.json');
    expect(revealTarget(kyoto)).toBeNull();
    expect(revealTarget(broken)).toBe(broken.path);
    expect(revealTarget(failed)).toBe('/Users/me/Documents/BaoCut/发布会/import-report.json');
  });

  it('任务页那一行：在跑念阶段与进度；跑完留了没导入的念「N 个待处理」、用提醒色', () => {
    const live = run([item('a', 'imported'), item('b', 'importing'), item('c', 'queued'), item('d', 'queued')], 'importing');
    const row = legacyTaskRow(live, 'darwin');
    expect(row).toMatchObject({ id: 'legacy-import:r1', origin: 'legacy-import', live: true, tone: 'accent', pct: 25, progress: 25 });
    expect(row.label).toBe('导入中 · 25%');
    expect(row.where).toBe('已导入 1/4 · 导入到 ~/Documents/BaoCut');
    expect(row.action).toBeNull();

    const waiting = legacyTaskRow({ ...live, state: 'waiting' }, 'darwin');
    expect(waiting.label).toBe('等其他任务 · 25%');

    const done = legacyTaskRow(finished, 'darwin');
    expect(done).toMatchObject({ live: false, tone: 'notice', label: '5 个待处理', progress: null });
    expect(done.where).toBe('已导入 2 · 待处理 5 · 已跳过 1 · 导入到 ~/Documents/BaoCut');

    expect(legacyTaskRow(run([item('a', 'imported')]), 'darwin')).toMatchObject({ tone: 'positive', label: '已完成' });
  });

  it('Windows 的导入目录原样写盘符', () => {
    expect(runSub({ ...run([item('a', 'imported')]), directory: 'C:\\Users\\me\\Documents\\BaoCut' }, 'win32')).toBe(
      '已导入 1 · 导入到 C:\\Users\\me\\Documents\\BaoCut',
    );
  });

  it('Home 顶上那一条：在跑报进度，跑完有没导入的报结果，全导入了不出', () => {
    const live = run([item('a', 'imported'), item('b', 'importing'), item('c', 'queued')], 'importing');
    expect(runBanner(live, 'darwin')).toMatchObject({
      state: 'running',
      title: '正在导入旧版项目 · 1/3',
      detail: '正在导入「b」 · 导入到 ~/Documents/BaoCut',
      pct: 33,
    });
    expect(runBanner({ ...live, state: 'waiting' }, 'darwin')?.detail).toMatch(/等它们结束后自动继续/);
    const result = runBanner(finished, 'darwin');
    expect(result).toMatchObject({ state: 'result', title: '旧版项目导入结束：2 个已导入，5 个没导入', detail: cardNote(finished) });
    expect(result?.key).toBe('r1:2026-10-08T10:05:00.000Z');
    expect(runBanner(run([item('a', 'imported'), item('c', 'skipped')]), 'darwin')).toBeNull();
    expect(runBanner(null, 'darwin')).toBeNull();
  });

  it('跑完的 toast：整次导入报整体；重试只报重试的那几个', () => {
    const all = new Set(finished.items.filter((it) => it.state !== 'skipped').map((it) => it.path));
    expect(finishToast(finished, all)).toEqual({ text: '导入结束：2 个已导入，5 个没导入', tone: 'neutral', action: 'result' });
    const clean = run([item('a', 'imported'), item('b', 'imported')]);
    expect(finishToast(clean, null)).toEqual({ text: '2 个旧版项目已导入', tone: 'positive', action: 'open' });

    const retried = run([item('a', 'imported'), { ...kyoto, state: 'imported', problem: null }, iceland]);
    expect(finishToast(retried, new Set([kyoto.path, iceland.path]))).toEqual({
      text: '重试的 2 个里 1 个已导入，1 个还是没导入',
      tone: 'neutral',
      action: 'result',
    });
    expect(finishToast(retried, new Set([kyoto.path]))).toEqual({ text: '重试的 1 个项目都已导入', tone: 'positive', action: 'open' });
    expect(finishToast(retried, new Set([iceland.path]))).toEqual({ text: '重试的 1 个还是没导入', tone: 'neutral', action: 'result' });
  });

  it('点到的、还没导入的项目', () => {
    expect(pendingPaths(finished)).toEqual([kyoto.path, iceland.path, course.path, broken.path, failed.path]);
    expect(pendingPaths(finished, [kyoto.path, item('a', 'imported').path])).toEqual([kyoto.path]);
    expect(pendingPaths(null)).toEqual([]);
  });
});
