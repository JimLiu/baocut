import { describe, expect, it } from 'vitest';
import type { JobRecord, TaskSummary } from '@baocut/protocol';
import type { AppUpdateInfo, AppUpdateState } from '../host.ts';
import {
  AUTO_ROW,
  FAILURE_TEXT,
  autoUpdatePatch,
  availableToast,
  barrierTasks,
  dialog,
  notesAll,
  notesFor,
  notesText,
  readyToast,
  relTime,
  restartAsk,
  retryAction,
  runsRemotely,
  sideButton,
  verifying,
  view,
  type BarrierTask,
} from './app-update.ts';

/* 设计稿 model-app-update.test.js 里与界面有关的断言逐条搬过来；状态机本身在主进程（app-update-rules.test.ts）。 */

const info: AppUpdateInfo = {
  version: '2.3.0',
  build: 57,
  date: '2026-10-01',
  minimumSystemVersion: '14.0',
  notes:
    'Settings › About checks for updates and installs them for you.\nExports keep subtitle styles on every track.\nTimeline zoom remembers where you left it.\nThe Agent picks up the video you are looking at.\nFaster first frame when opening long videos.\nSmaller download for the speech models.\nAssorted fixes.',
  notesLocalized: {
    'zh-Hans':
      '设置 › 关于可以检查更新，下载好后替你安装。\n导出时每条字幕轨都保留各自的样式。\n时间轴缩放记住你上次停在哪。\nAgent 默认接手你正在看的视频。\n打开长视频时第一帧出得更快。\n语音模型的下载变小了。\n其他修复。',
  },
  format: 'zip',
  url: 'https://baocut.app/downloads/BaoCut-2.3.0-build.57-aarch64-apple-darwin.zip',
  size: 168204331,
  sha256: 'a'.repeat(64),
};

const ctx = { lang: 'zh-Hans', lastCheck: null, now: 0 };

describe('版本说明', () => {
  it('取当前语言，缺了按主语言、英文、notes 回落；关于页最多 6 行', () => {
    const zh = notesFor(info, 'zh-Hans');
    expect(zh.lines).toHaveLength(6);
    expect(zh.more).toBe(true);
    expect(zh.lines[0]).toMatch(/^设置 › 关于/);
    expect(notesFor(info, 'de').lines[0]).toMatch(/^Settings › About/);
    expect(notesFor({ ...info, notes: 'a\n\n b ', notesLocalized: {} }, 'en')).toEqual({ lines: ['a', 'b'], more: false });
    const many = { notes: 'Plain', notesLocalized: { 'pt-BR': 'Notas', en: 'English', 'zh-Hans': '  ' } };
    expect(notesText(many, 'pt')).toBe('Notas');
    expect(notesText(many, 'ja')).toBe('English');
    expect(notesText(many, 'zh-Hans')).toBe('English');
    expect(notesText({ notes: 'Plain', notesLocalized: {} }, 'ja')).toBe('Plain');
  });

  it('更新窗列全部条目，剥掉行首的列表记号', () => {
    expect(notesAll(info, 'zh-Hans')).toHaveLength(7);
    expect(notesAll({ ...info, notesLocalized: {}, notes: '• 一\n- 二\n* 三\n四' }, 'zh-Hans')).toEqual(['一', '二', '三', '四']);
    expect(notesAll(null, 'zh-Hans')).toEqual([]);
  });

  it('相对时间', () => {
    expect(relTime(100, 130)).toBe('刚刚');
    expect(relTime(0, 5 * 60)).toBe('5 分钟前');
    expect(relTime(0, 3 * 3600 + 10)).toBe('3 小时前');
    expect(relTime(0, 2 * 86400)).toBe('2 天前');
  });
});

describe('设置 › 关于', () => {
  const labels = (v: ReturnType<typeof view>) => v.actions.map((a) => a.label + (a.disabled ? '(禁用)' : ''));

  it('各态的文案与按钮', () => {
    const idle = view({ k: 'idle' }, { lang: 'zh-Hans', lastCheck: 0, now: 3 * 3600 });
    expect(labels(idle)).toEqual(['检查更新']);
    expect(idle.sub).toBe('上次检查：3 小时前');
    expect(view({ k: 'idle' }, ctx).sub).toBeNull();
    expect(labels(view({ k: 'checking' }, ctx))).toEqual(['正在检查…(禁用)']);
    const up = view({ k: 'upToDate' }, ctx);
    expect([up.line, up.tone, labels(up)]).toEqual(['已是最新版本', 'positive', ['检查更新']]);
    const av = view({ k: 'available', info }, ctx);
    expect(av.line).toBe('有新版本 2.3.0（Build 57）');
    expect(av.notes?.lines).toHaveLength(6);
    expect(av.actions[0]).toEqual({ k: 'download', label: '下载并安装', variant: 'accent', disabled: false });
    const dl = view({ k: 'downloading', info, pct: 42 }, ctx);
    expect([dl.line, dl.progress, labels(dl)]).toEqual(['正在下载 2.3.0 · 42%', 42, ['取消']]);
    const verify = view({ k: 'downloading', info, pct: 100 }, ctx);
    expect([verify.line, verify.progress, labels(verify)]).toEqual(['正在校验 2.3.0…', 100, ['取消']]);
    const ready = view({ k: 'ready', info, path: '/x.zip' }, ctx);
    expect(ready.line).toBe('2.3.0 已下载，退出 BaoCut 时自动安装');
    expect(ready.actions[0]).toEqual({ k: 'restart', label: '重启并更新', variant: 'accent', disabled: false });
    expect(labels(view({ k: 'installing', info }, ctx))).toEqual(['正在安装…(禁用)']);
    const err = view({ k: 'error', failure: 'check', info: null }, ctx);
    expect([err.line, err.tone, labels(err), err.link]).toEqual([
      '连不上更新服务器，检查网络后再试。',
      'negative',
      ['重试'],
      { k: 'downloadPage', label: '前往下载页' },
    ]);
  });

  it('不检查更新时只写一句为什么', () => {
    expect(view({ k: 'unsupported', why: 'dev' }, ctx)).toEqual({ line: '开发构建不检查更新', tone: 'muted', actions: [] });
    expect(view({ k: 'unsupported', why: 'appStore' }, ctx).line).toBe('App Store 版本由 App Store 负责更新');
  });

  it('系统版本不够：红字写要求的 macOS，不给下载', () => {
    const v = view({ k: 'available', info, systemUnmet: '27.0' }, ctx);
    expect([v.line, v.warn, v.actions]).toEqual(['有新版本 2.3.0（Build 57）', '需要 macOS 27.0', []]);
    expect(view({ k: 'available', info }, ctx).warn).toBeUndefined();
  });

  it('静默检查在途（bg）时显示不变', () => {
    expect(view({ k: 'available', info, bg: true }, ctx)).toEqual(view({ k: 'available', info }, ctx));
    expect(sideButton({ k: 'available', info, bg: true })).toEqual(sideButton({ k: 'available', info }));
    const ready: AppUpdateState = { k: 'ready', info, path: '/x.zip' };
    expect(view({ ...ready, bg: true }, ctx)).toEqual(view(ready, ctx));
    expect(sideButton({ ...ready, bg: true })).toEqual(sideButton(ready));
    expect(dialog({ ...ready, bg: true }, { lang: 'zh-Hans', current: null })).toEqual(dialog(ready, { lang: 'zh-Hans', current: null }));
  });

  it('下载到 100% 就是校验段', () => {
    expect(verifying({ k: 'downloading', info, pct: 100 })).toBe(true);
    expect(verifying({ k: 'downloading', info, pct: 99 })).toBe(false);
    expect(verifying({ k: 'ready', info, path: '/x.zip' })).toBe(false);
  });

  it('在等后台任务结束：写还有几个，可以不等了', () => {
    const v = view({ k: 'ready', info, path: '/x.zip' }, { ...ctx, waiting: 2 });
    expect(v.line).toBe('2.3.0 已下载，等后台任务结束后安装');
    expect(v.sub).toBe('还有 2 个后台任务在跑，都结束后自动安装。');
    expect(v.link).toEqual({ k: 'stopWaiting', label: '不等了' });
  });

  it('出错文案每一类都有，重试各回各的那一步', () => {
    for (const text of Object.values(FAILURE_TEXT)) expect(text).toMatch(/。$/);
    expect(retryAction({ k: 'error', failure: 'check', info: null })).toBe('check');
    expect(retryAction({ k: 'error', failure: 'verify', info })).toBe('download');
  });
});

describe('rail 上的更新按钮', () => {
  it('显示表：每一行', () => {
    expect(sideButton({ k: 'available', info })).toEqual({ visible: true, glyph: 'download', dot: 'white', tip: '有新版本 · BaoCut 2.3.0' });
    expect(sideButton({ k: 'available', info, systemUnmet: '27.0' })).toEqual({ visible: false });
    expect(sideButton({ k: 'downloading', info, pct: 42 })).toEqual({ visible: true, glyph: 'ring', pct: 42, dot: null, tip: '正在下载更新 · 42%' });
    expect(sideButton({ k: 'downloading', info, pct: 100 })).toEqual({
      visible: true,
      glyph: 'ring',
      pct: 100,
      dot: null,
      tip: '正在校验更新…',
    });
    expect(sideButton({ k: 'ready', info, path: '/x.zip' })).toEqual({
      visible: true,
      glyph: 'check',
      dot: 'positive',
      tip: '更新已下载 · 退出时自动安装',
    });
    expect(sideButton({ k: 'error', failure: 'verify', info })).toEqual({ visible: true, glyph: 'download', dot: 'negative', tip: '更新出错 · 点击查看' });
    const hidden: AppUpdateState[] = [
      { k: 'error', failure: 'check', info: null },
      { k: 'idle' },
      { k: 'checking' },
      { k: 'upToDate' },
      { k: 'installing', info },
      { k: 'unsupported', why: 'dev' },
      { k: 'unsupported', why: 'appStore' },
    ];
    for (const st of hidden) expect(sideButton(st), st.k).toEqual({ visible: false });
  });
});

describe('更新窗', () => {
  const current = { version: '2.2.1', build: 56 };

  it('头部、正文与全部说明（不截 6 行）', () => {
    const d = dialog({ k: 'available', info }, { lang: 'zh-Hans', current });
    expect(d?.title).toBe('有新版本');
    expect(d?.sub).toBe('BaoCut 2.3.0 · Build 57');
    expect(d?.current).toBe('你现在用的是 BaoCut 2.2.1（Build 56）。');
    expect(d?.notesTitle).toBe('更新内容');
    expect(d?.notes).toHaveLength(7);
    expect(dialog({ k: 'available', info }, { lang: 'de', current })?.notes[0]).toMatch(/^Settings › About/);
    expect(d?.note).toBeNull();
    const ready = dialog({ k: 'ready', info, path: '/x.zip' }, { lang: 'zh-Hans', current });
    expect([ready?.title, ready?.note]).toEqual(['更新已下载', '退出 BaoCut 时会自动安装，不用现在重启。']);
    const readyWaiting = (waiting: number | null | undefined) =>
      dialog({ k: 'ready', info, path: '/x.zip' }, { lang: 'zh-Hans', current, waiting })?.note;
    expect(readyWaiting(3)).toBeNull();
    expect(readyWaiting(0)).toBeNull();
    expect(readyWaiting(null)).toBe('退出 BaoCut 时会自动安装，不用现在重启。');
    expect(readyWaiting(undefined)).toBe('退出 BaoCut 时会自动安装，不用现在重启。');
    expect(dialog({ k: 'downloading', info, pct: 42 }, { lang: 'zh-Hans', current })?.note).toBeNull();
    expect(dialog({ k: 'error', failure: 'verify', info }, { lang: 'zh-Hans', current })?.title).toBe('有新版本');
  });

  it('底栏：每一态', () => {
    const foot = (st: AppUpdateState, waiting?: number) => dialog(st, { lang: 'zh-Hans', current: null, waiting })!.footer;
    const keys = (f: ReturnType<typeof foot>) => f.buttons.map((b) => `${b.k}:${b.label}:${b.variant}`);
    const av = foot({ k: 'available', info });
    expect(av.left).toBeNull();
    expect(keys(av)).toEqual(['later:稍后:secondary', 'download:下载并安装:accent']);
    const dl = foot({ k: 'downloading', info, pct: 42 });
    expect(dl.left).toEqual({ progress: 42, text: '正在下载 · 42%' });
    expect(keys(dl)).toEqual(['cancel:取消:secondary']);
    const verify = foot({ k: 'downloading', info, pct: 100 });
    expect(verify.left).toEqual({ progress: 100, text: '正在校验…' });
    expect(keys(verify)).toEqual(['cancel:取消:secondary']);
    const ready = foot({ k: 'ready', info, path: '/x.zip' });
    expect(ready.left).toBeNull();
    expect(keys(ready)).toEqual(['later:稍后:secondary', 'restart:重启并更新:accent']);
    const err = foot({ k: 'error', failure: 'verify', info });
    expect(err.left).toEqual({ error: '下载的文件没有通过校验，已经删掉。' });
    expect(keys(err)).toEqual(['downloadPage:前往下载页:secondary', 'retry:重试:accent']);
    const waiting = foot({ k: 'ready', info, path: '/x.zip' }, 1);
    expect(waiting.left).toEqual({ note: '还有 1 个后台任务在跑，都结束后自动安装。' });
    expect(keys(waiting)).toEqual(['stopWaiting:不等了:secondary', 'restart:重启并更新:accent']);
  });

  it('按钮不该显示的态一律没有窗', () => {
    const none: AppUpdateState[] = [
      { k: 'idle' },
      { k: 'checking' },
      { k: 'upToDate' },
      { k: 'installing', info },
      { k: 'unsupported', why: 'dev' },
      { k: 'available', info, systemUnmet: '27.0' },
      { k: 'error', failure: 'check', info: null },
    ];
    for (const st of none) expect(dialog(st, { lang: 'zh-Hans', current: null }), st.k).toBeNull();
  });
});

describe('toast', () => {
  it('已下载与可以更新了', () => {
    expect(readyToast(info)).toEqual({ text: 'BaoCut 2.3.0 已下载，退出时自动安装', action: '重启并更新' });
    expect(availableToast(info)).toEqual({ text: 'BaoCut 2.3.0 可以更新了', action: '查看' });
  });
});

describe('停止屏障', () => {
  const job = (jobId: string, state: JobRecord['state'], providerId: string, endedAt: string | null = null) =>
    ({
      jobId,
      kind: 'transcribe',
      state,
      phase: 'running',
      providerId,
      modelId: 'whisper',
      videoId: null,
      assetId: null,
      submitter: { kind: 'user' },
      createdAt: '2026-10-03T00:00:00Z',
      startedAt: '2026-10-03T00:00:00Z',
      endedAt,
    }) as unknown as JobRecord;
  const task = (taskId: string, status: TaskSummary['status']) =>
    ({ taskId, status, goal: `目标 ${taskId}`, conversationId: 'c1', projectId: null, startedAt: '', endedAt: null }) as unknown as TaskSummary;
  const live = (j: JobRecord) => j.state === 'queued' || j.state === 'running';

  it('远端：节点与云端服务商；本机与本机上的智能体不算', () => {
    expect(runsRemotely('local')).toBe(false);
    expect(runsRemotely('agent:codex')).toBe(false);
    expect(runsRemotely('node:studio')).toBe(true);
    expect(runsRemotely('openai')).toBe(true);
  });

  it('在跑的 Agent 任务与 Job 合成一张，带上怎么停', () => {
    const list = barrierTasks(
      [job('j1', 'running', 'local'), job('j2', 'queued', 'openai'), job('j3', 'completed', 'openai', '2026-10-03T01:00:00Z')],
      [task('t1', 'running'), task('t2', 'stopping'), task('t3', 'completed')],
      live,
    );
    expect(list.map((t) => [t.id, t.remote, t.action])).toEqual([
      ['t1', false, { type: 'stop', taskId: 't1' }],
      ['t2', false, null],
      ['j1', false, { type: 'cancel', jobId: 'j1' }],
      ['j2', true, { type: 'cancel', jobId: 'j2' }],
    ]);
  });

  it('没有任务在跑时直接装；有时问，并列出远端的', () => {
    expect(restartAsk([])).toBeNull();
    const tasks: BarrierTask[] = [
      { id: 'a', title: '转录', where: 'whisper · 本机', remote: false, action: null },
      { id: 'b', title: '配音', where: 'tts-1 · 云端', remote: true, action: { type: 'cancel', jobId: 'b' } },
      { id: 'c', title: '生成', where: 'img · 远端节点', remote: true, action: { type: 'cancel', jobId: 'c' } },
    ];
    const ask = restartAsk(tasks)!;
    expect(ask.title).toBe('现在重启并更新？');
    expect(ask.body).toBe('有 3 个后台任务正在运行，重启会中断它们，之后可以重新开始。');
    expect(ask.remote.map((t) => t.id)).toEqual(['b', 'c']);
    expect(ask.remoteTitle).not.toBeNull();
    expect([ask.stopLabel, ask.waitLabel, ask.cancelLabel]).toEqual(['现在停止并安装', '等任务结束后安装', '稍后']);
    expect(restartAsk(tasks.slice(0, 1))?.remoteTitle).toBeNull();
  });
});

describe('设置 › 通用的开关', () => {
  it('文案照设计稿；打开写两个键，关上只关自动下载', () => {
    expect(AUTO_ROW.label).toBe('自动检查并下载更新');
    expect(AUTO_ROW.desc).toBe('启动时和之后每 6 小时检查一次；下载好的更新在你下次退出时安装，也可以马上重启更新，不会自己重启。');
    expect(autoUpdatePatch(true)).toEqual({ 'updates.autoCheck': true, 'updates.autoDownload': true });
    expect(autoUpdatePatch(false)).toEqual({ 'updates.autoDownload': false });
  });
});
