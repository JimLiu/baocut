import { describe, expect, it } from 'vitest';
import type { JobRecord, ModelCapabilitiesView, PipelineStepState, SpaceEntry, TimelineItem } from '@baocut/protocol';
import { buildThread } from './thread.ts';
import {
  asrFacts,
  asrLine,
  asrModelName,
  cardRows,
  conversationJobVideos,
  conversationVideoJobs,
  downloadCardView,
  foldRows,
  jobRowView,
  needsAction,
  threadCards,
  videoStatus,
  type JobRowView,
} from './video-cards.ts';

const CONV = 'conv_1';
const at = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s)).toISOString();

const user = (id: string, taskId: string, sent = 0): TimelineItem => ({
  kind: 'user-message',
  id,
  createdAt: at(sent),
  taskId,
  text: '你好',
});
const reply = (id: string, taskId: string): TimelineItem => ({
  kind: 'agent-message',
  id,
  createdAt: at(0),
  taskId,
  text: '好的',
  streaming: false,
});
const tool = (id: string, taskId: string, title = 'baocut.transcribe'): TimelineItem => ({
  kind: 'tool-call',
  id,
  createdAt: at(0),
  taskId,
  tool: 'mcp',
  title,
  detail: null,
  output: '',
  status: 'completed',
  exitCode: null,
  durationMs: null,
});
const created = (videoId: string, taskId: string): TimelineItem => ({
  kind: 'video-created',
  id: `created/${videoId}`,
  createdAt: at(0),
  taskId,
  videoId,
  videoName: `新视频 ${videoId}`,
  target: { conversationId: CONV, path: `新视频 ${videoId}` },
  videoRevision: '1',
});
const change = (id: string, videoId: string, taskId: string): TimelineItem => ({
  kind: 'video-change',
  id: `change/${id}`,
  createdAt: at(0),
  taskId,
  videoId,
  videoName: '样片',
  target: { projectId: 'p1', path: '样片' },
  transactionId: id,
  label: '剪掉口误',
  previousRevision: '1',
  videoRevision: '2',
  createdIds: [],
  updatedIds: [],
  deletedIds: [],
  durationSeconds: { before: 10, after: 8 },
  undoOf: null,
});

const step = (name: string, status: PipelineStepState['status'], extra: Partial<PipelineStepState> = {}): PipelineStepState => ({
  name,
  label: name,
  status,
  jobId: null,
  attempts: 1,
  output: null,
  ...extra,
});

let n = 0;
function job(patch: Partial<JobRecord> = {}): JobRecord {
  n++;
  return {
    jobId: `job_${n}`,
    kind: 'transcribe',
    state: 'running',
    phase: 'transcribing',
    progress: null,
    videoId: 'mov_1',
    assetId: null,
    assetRevision: null,
    contentHash: '',
    providerId: 'local',
    modelId: 'large-v3',
    bundleId: null,
    inputHash: '',
    submitter: { kind: 'agent', id: CONV, taskId: 't1' },
    attempt: 1,
    createdAt: at(n),
    updatedAt: at(n),
    startedAt: at(n),
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    ...patch,
  } as JobRecord;
}

function linkJob(patch: Partial<JobRecord> = {}): JobRecord {
  return job({
    kind: 'pipeline',
    phase: 'downloading',
    videoId: null,
    providerId: 'yt-dlp',
    pipeline: {
      name: 'link-import',
      params: { url: 'https://www.youtube.com/watch?v=abc', host: 'youtube.com', audioOnly: false, outDir: '/d' },
      steps: [step('resolve', 'completed'), step('download', 'running', { jobId: 'job_dl' }), step('publish', 'pending')],
      current: 1,
      stoppedAt: null,
      summary: null,
    },
    ...patch,
  });
}

const cards = (items: TimelineItem[], jobs: JobRecord[], entries: SpaceEntry[] = []) => {
  const blocks = buildThread(items);
  const map = threadCards({ blocks, items, jobs, conversationId: CONV, entries });
  return Object.fromEntries(
    [...map].map(([id, list]) => [
      id,
      list.map((c) => (c.kind === 'video' ? `video:${c.video.id}[${c.jobIds.join(',')}]` : `download:${c.jobId}`)),
    ]),
  );
};

describe('threadCards：放置', () => {
  it('内部检查导出在任何状态都不进卡或产物；正式的 1 秒分段与旧记录仍显示', () => {
    const items = [user('u1', 't1'), tool('c1', 't1', 'baocut.export'), reply('a1', 't1')];
    const preview = (state: JobRecord['state']) => job({
      kind: 'export', state,
      export: { settings: { kind: 'video', format: 'mp4', purpose: 'preview', ranges: [{ start: 1.7, end: 2.7 }, { start: 29.5, end: 30.5 }, { start: 46, end: 47 }] } } as JobRecord['export'],
    });
    const hidden = ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].map((s) => preview(s as JobRecord['state']));
    expect(cards(items, hidden)).toEqual({});
    expect(conversationVideoJobs('mov_1', hidden, CONV)).toEqual([]);
    expect(conversationJobVideos(hidden, CONV)).toEqual([]);
    expect(cardRows(hidden.map((j) => j.jobId), hidden)).toEqual([]);
    const delivered = job({ kind: 'export', state: 'completed', export: { settings: { kind: 'video', format: 'mp4', purpose: 'deliverable', ranges: [{ start: 0, end: 1 }] } } as JobRecord['export'] });
    const legacy = job({ kind: 'export', state: 'completed', export: { settings: { kind: 'video', format: 'mp4', range: { start: 0, end: 1 } } } as JobRecord['export'] });
    const jobs = [delivered, legacy, ...hidden];
    expect(cards(items, jobs)).toEqual({ 'steps/c1': [`video:mov_1[${delivered.jobId},${legacy.jobId}]`] });
    expect(conversationVideoJobs('mov_1', jobs, CONV)).toEqual([delivered.jobId, legacy.jobId]);
    const rows = cardRows(jobs.map((j) => j.jobId), jobs).map((j) => jobRowView(j, jobs, 0));
    expect(foldRows(rows).earlier.map((r) => r.jobId)).toEqual([delivered.jobId]);
  });

  it('一轮一部视频一张卡，挂在这一轮最后一个引用它的块后面', () => {
    const items = [
      user('u1', 't1'),
      tool('c1', 't1'),
      change('x1', 'mov_1', 't1'),
      reply('a1', 't1'),
      tool('c2', 't1'),
      change('x2', 'mov_1', 't1'),
    ];
    expect(cards(items, [])).toEqual({ 'change/x2': ['video:mov_1[]'] });
  });

  it('新建视频的记录挂在它前面最近的一块后面；之后的转录 Job 把卡挪到这个任务最后一组步骤', () => {
    const t = job({ videoId: 'mov_2' });
    const items = [
      user('u1', 't1'),
      tool('c1', 't1', 'baocut.videos_create'),
      created('mov_2', 't1'),
      reply('a1', 't1'),
      tool('c2', 't1'),
      reply('a2', 't1'),
    ];
    expect(cards(items, [t])).toEqual({ 'steps/c2': [`video:mov_2[${t.jobId}]`] });
    // 还没有 Job 时卡在新建那一步后面。
    expect(cards(items, [])).toEqual({ 'steps/c1': ['video:mov_2[]'] });
  });

  it('别的会话、用户自己提交的 Job 不进卡；流程的步骤不单独成行', () => {
    const other = job({ submitter: { kind: 'agent', id: 'conv_2', taskId: 't1' } });
    const mine = job({ submitter: { kind: 'connection', id: 'app' } });
    const items = [user('u1', 't1'), tool('c1', 't1'), reply('a1', 't1')];
    expect(cards(items, [other, mine])).toEqual({});
  });

  it('下载卡：父任务还没有视频时一张；视频建出来后同一位置换成视频卡，流程提交的转录成为一行', () => {
    const items = [user('u1', 't1'), tool('c1', 't1', 'baocut.download'), reply('a1', 't1')];
    const parent = linkJob();
    const dl = job({
      jobId: 'job_dl',
      kind: 'pipeline',
      parentJobId: parent.jobId,
      submitter: { kind: 'pipeline', id: parent.jobId },
    } as Partial<JobRecord>);
    expect(cards(items, [parent, dl])).toEqual({ 'steps/c1': [`download:${parent.jobId}`] });

    const withVideo = { ...parent, videoId: 'mov_9', phase: 'transcribing' as const };
    const tr = job({ videoId: 'mov_9', submitter: { kind: 'pipeline', id: parent.jobId } });
    expect(cards(items, [withVideo, dl, tr])).toEqual({ 'steps/c1': [`video:mov_9[${parent.jobId},${tr.jobId}]`] });
  });

  it('同一个位置的几张卡按第一次引用的先后', () => {
    const items = [user('u1', 't1'), change('x1', 'mov_b', 't1'), change('x2', 'mov_a', 't1'), tool('c1', 't1'), reply('a1', 't1')];
    const a = job({ videoId: 'mov_a' });
    const b = job({ videoId: 'mov_b' });
    expect(cards(items, [a, b])).toEqual({ 'steps/c1': [`video:mov_b[${b.jobId}]`, `video:mov_a[${a.jobId}]`] });
  });
});

describe('threadCards：一条会话一部视频一张卡（产品设计 §3.2.2）', () => {
  it('后面的回合再引用时卡挪到最新的引用，前面的回合不再有它', () => {
    const items = [
      user('u1', 't1', 10),
      change('x1', 'mov_1', 't1'),
      reply('a1', 't1'),
      user('u2', 't2', 20),
      reply('a2', 't2'),
      change('x2', 'mov_1', 't2'),
      user('u3', 't3', 30),
      reply('a3', 't3'),
    ];
    expect(cards(items, [])).toEqual({ 'change/x2': ['video:mov_1[]'] });
    // 只到第一轮时卡在第一轮的引用后面
    expect(cards(items.slice(0, 3), [])).toEqual({ 'change/x1': ['video:mov_1[]'] });
  });

  // 第一轮的任务提交了转录，第二轮只是聊天：卡跟不跟过去，看转录在第二轮开始时结束没有。
  const twoTurns = [user('u1', 't1', 10), tool('c1', 't1'), reply('a1', 't1'), user('u2', 't2', 20), reply('a2', 't2')];

  it('转录在下一条用户消息时还在跑：卡挂到最新一轮的最后一块；排队中同样算没结束', () => {
    const running = job({ state: 'running' });
    expect(cards(twoTurns, [running])).toEqual({ a2: [`video:mov_1[${running.jobId}]`] });
    const queued = job({ state: 'queued', startedAt: null });
    expect(cards(twoTurns, [queued])).toEqual({ a2: [`video:mov_1[${queued.jobId}]`] });
    // 新一轮只有用户那一句时挂在它后面
    expect(cards(twoTurns.slice(0, 4), [running])).toEqual({ u2: [`video:mov_1[${running.jobId}]`] });
  });

  it('转录在下一条用户消息之前已经结束：卡留在原处；失败、取消同样按结束时刻算', () => {
    const done = job({ state: 'completed', endedAt: at(15) });
    expect(cards(twoTurns, [done])).toEqual({ 'steps/c1': [`video:mov_1[${done.jobId}]`] });
    const failed = job({ state: 'failed', endedAt: at(18) });
    expect(cards(twoTurns, [failed])).toEqual({ 'steps/c1': [`video:mov_1[${failed.jobId}]`] });
  });

  it('转录在第二轮里结束：第三轮开始后卡仍在第二轮，不挪回去；一直在跑就一直跟到最新一轮', () => {
    const three = [...twoTurns, user('u3', 't3', 30), reply('a3', 't3')];
    const ended = job({ state: 'completed', endedAt: at(25) });
    expect(cards(three, [ended])).toEqual({ a2: [`video:mov_1[${ended.jobId}]`] });
    const running = job();
    expect(cards(three, [running])).toEqual({ a3: [`video:mov_1[${running.jobId}]`] });
  });

  it('还在跑的活在它被引用的那一轮里不挪：卡留在最后的引用后面', () => {
    const running = job();
    expect(cards(twoTurns.slice(0, 3), [running])).toEqual({ 'steps/c1': [`video:mov_1[${running.jobId}]`] });
  });

  it('第一轮的转录还在跑、第二轮中间又引用了它：仍是一张，挂在第二轮的最后一块', () => {
    const running = job();
    const items = [...twoTurns.slice(0, 4), change('x2', 'mov_1', 't2'), reply('a2', 't2')];
    expect(cards(items, [running])).toEqual({ a2: [`video:mov_1[${running.jobId}]`] });
  });

  it('卡上是整条会话在这部视频上的活：前面回合结束的收进「之前的 N 项」', () => {
    const items = [
      user('u1', 't1', 10),
      tool('c1', 't1'),
      reply('a1', 't1'),
      user('u2', 't2', 20),
      tool('c2', 't2', 'baocut.export'),
      reply('a2', 't2'),
    ];
    const tx = job({ state: 'completed', endedAt: at(15), result: { documentId: 'doc_1', artifactId: 'art_doc' } });
    const ex = job({ kind: 'export', state: 'running', submitter: { kind: 'agent', id: CONV, taskId: 't2' } });
    const jobs = [tx, ex];
    expect(cards(items, jobs)).toEqual({ 'steps/c2': [`video:mov_1[${tx.jobId},${ex.jobId}]`] });
    expect(conversationVideoJobs('mov_1', jobs, CONV)).toEqual([tx.jobId, ex.jobId]);
    const f = foldRows(cardRows([tx.jobId, ex.jobId], jobs).map((j) => jobRowView(j, jobs, 0)));
    expect([f.shown.map((r) => r.jobId), f.earlier.map((r) => r.jobId)]).toEqual([[ex.jobId], [tx.jobId]]);
  });
});

describe('videoOutput（经 threadCards）', () => {
  it('流程新建的视频按 Space 条目的 ref.videoId 找名字与位置；找不到时位置为 null', () => {
    const items = [user('u1', 't1'), tool('c1', 't1'), reply('a1', 't1')];
    const tr = job({ videoId: 'mov_9' });
    const entry = {
      id: 'e1',
      kind: 'video',
      name: '访谈第一集',
      fileName: '访谈第一集',
      source: { projectId: 'p1', conversationId: null },
      relPath: 'videos/访谈第一集',
      size: 1,
      lastActivityAt: at(0),
      status: null,
      ref: { videoId: 'mov_9' },
      user: { favorite: false, displayName: null, trashedAt: null },
    } as unknown as SpaceEntry;
    const first = (entries: SpaceEntry[]) => {
      const blocks = buildThread(items);
      const card = [...threadCards({ blocks, items, jobs: [tr], conversationId: CONV, entries }).values()][0]![0]!;
      return card.kind === 'video' ? card.video : null;
    };
    expect(first([entry])).toMatchObject({ name: '访谈第一集', video: { projectId: 'p1', path: 'videos/访谈第一集' } });
    expect(first([])).toMatchObject({ name: '视频', video: null });
  });
});

describe('videoStatus', () => {
  it('在跑的转录优先，带百分比；排队；有文稿是已转录；失败过是失败；不知道时不显示', () => {
    expect(videoStatus('mov_1', [job({ progress: { done: 45, total: 100, unit: 'seconds' } })], false)?.text).toBe('转录中 · 45%');
    expect(videoStatus('mov_1', [job({ progress: { done: 3, total: null, unit: 'segments' } })], false)?.text).toBe('转录中');
    expect(videoStatus('mov_1', [job({ state: 'queued' })], false)?.text).toBe('排队中');
    const done = job({ state: 'completed', result: { documentId: 'doc_1', artifactId: 'art_doc' } });
    expect(videoStatus('mov_1', [done], false)?.key).toBe('transcribed');
    expect(videoStatus('mov_1', [], true)?.key).toBe('transcribed');
    const failed = job({ state: 'failed', error: { code: 'X', message: '模型崩了', details: null } as JobRecord['error'] });
    expect(videoStatus('mov_1', [failed], false)?.text).toBe('失败');
    expect(videoStatus('mov_1', [failed, done], false)?.key).toBe('transcribed');
    expect(videoStatus('mov_1', [], false)).toBeNull();
    expect(videoStatus('mov_1', [job({ kind: 'export' })], false)).toBeNull();
  });
});

describe('jobRowView', () => {
  const now = Date.parse(at(0)) + 90_000;

  it('转录在跑：阶段与按秒的计数、百分比、已用时长、能取消；没有「预计还要」', () => {
    const j = job({ progress: { done: 62, total: 206, unit: 'seconds' }, startedAt: at(0) });
    const row = jobRowView(j, [j], now);
    expect(row).toMatchObject({
      name: '转录',
      state: 'running',
      tail: '30%',
      pct: 30,
      elapsed: '已用 1:30',
      canCancel: true,
      canRetry: false,
    });
    expect(row.line).toContain('已识别 1:02 / 3:26');
  });

  it('没有总量时不写百分比；按片段计数', () => {
    const j = job({ progress: { done: 12, total: null, unit: 'segments' } });
    const row = jobRowView(j, [j], now);
    expect(row.pct).toBeNull();
    expect(row.tail).toBeNull();
    expect(row.line).toContain('已识别 12 段');
  });

  it('同一部视频之前转录过的叫重新转录', () => {
    const old = job({ state: 'completed', endedAt: at(1) });
    const again = job();
    expect(jobRowView(again, [old, again], now).name).toBe('重新转录');
    expect(jobRowView(old, [old, again], now).name).toBe('转录');
  });

  it('完成写结果事实与警告，不给取消', () => {
    const j = job({
      state: 'completed',
      endedAt: at(9),
      result: { documentId: 'doc_1', artifactId: 'art_doc' },
      warnings: [{ code: 'diarization-unavailable' }] as JobRecord['warnings'],
    });
    expect(jobRowView(j, [j], now)).toMatchObject({
      state: 'done',
      tail: '完成',
      facts: ['文稿已写进视频'],
      warnings: ['这个模型不能区分说话人'],
      canCancel: false,
      elapsed: null,
    });
  });

  it('失败写原因，有确定去处时给补救；中断的转录能重试，失败的不能', () => {
    const failed = job({
      state: 'failed',
      endedAt: at(9),
      error: { code: 'MODEL_NOT_READY', message: '模型没装好', details: null } as JobRecord['error'],
    });
    const row = jobRowView(failed, [failed], now);
    expect(row).toMatchObject({ state: 'failed', error: '模型没装好', canRetry: false });
    expect(row.remedy?.target).toEqual({ tab: 'models', category: 'asr', page: 'local' });
    const interrupted = job({ state: 'interrupted', endedAt: at(9) });
    expect(jobRowView(interrupted, [interrupted], now)).toMatchObject({
      state: 'interrupted',
      tail: '已中断',
      canRetry: true,
      remedy: null,
    });
    const retrying = job({ state: 'interrupted', endedAt: null });
    expect(jobRowView(retrying, [retrying], now)).toMatchObject({ state: 'running', canRetry: false, canCancel: false });
  });

  it('取消写已取消，没有按钮', () => {
    const j = job({ state: 'cancelled', endedAt: at(9) });
    expect(jobRowView(j, [j], now)).toMatchObject({ tail: '已取消', canCancel: false, canRetry: false, remedy: null, error: null });
  });

  it('导出完成列文件，成片能播放，便携包不能', () => {
    const j = job({
      kind: 'export',
      state: 'completed',
      endedAt: at(9),
      export: {
        settings: { kind: 'video', format: 'mp4' },
        destination: { dir: '/out', files: ['访谈.mp4'] },
      } as unknown as JobRecord['export'],
      result: {
        documentId: null,
        artifactId: null,
        outputs: [
          {
            artifactId: 'art_1',
            path: '/out/访谈.mp4',
            byteLength: 2_000_000,
            media: { kind: 'video', width: 1920, height: 1080, durationSec: 206 },
          },
          {
            artifactId: 'art_2',
            path: '/out/访谈.baocut',
            byteLength: 1000,
            media: { kind: 'package', files: 3, assets: 2, missingAssets: 0 },
          },
        ],
      } as unknown as JobRecord['result'],
    });
    const row = jobRowView(j, [j], now);
    expect(row.files.map((f) => f.name)).toEqual(['访谈.mp4', '访谈.baocut']);
    expect(row.files[0]!.meta).toContain('1920×1080');
    expect(row.playable).toEqual({ [row.files[0]!.key]: 'art_1' });
  });

  it('只有成片和音频能播放：字幕与浏览器放不了的 AVI 只在文件夹中显示（产品设计 §3.2.2）', () => {
    const out = (artifactId: string, path: string, media: object) => ({ artifactId, path, byteLength: 1000, media });
    const j = job({
      kind: 'export',
      state: 'completed',
      endedAt: at(9),
      result: {
        documentId: null,
        artifactId: null,
        outputs: [
          out('art_srt', '/out/访谈-en.srt', { kind: 'text', entries: 40, durationSec: 206 }),
          out('art_m4a', '/out/旁白.m4a', { kind: 'audio', durationSec: 206, sampleRate: 48000, channels: 2 }),
          out('art_avi', '/out/访谈.avi', {
            kind: 'video',
            durationSec: 206,
            width: 1920,
            height: 1080,
            videoCodec: 'mpeg4',
            audioCodec: null,
          }),
        ],
      } as unknown as JobRecord['result'],
    });
    const row = jobRowView(j, [j], now);
    expect(row.files.map((f) => !!f.path)).toEqual([true, true, true]);
    expect(row.playable).toEqual({ [row.files[1]!.key]: 'art_m4a' });
  });
});

describe('foldRows / needsAction（产品设计 §3.2.2「之前的 N 项」）', () => {
  type R = { id: string; state: JobRowView['state']; remedy: JobRowView['remedy']; canRetry: boolean };
  const fix = { label: '去设置', hint: '', target: { tab: 'models' } } as unknown as JobRowView['remedy'];
  const row = (id: string, state: R['state'], extra: Partial<R> = {}): R => ({ id, state, remedy: null, canRetry: false, ...extra });
  const ids = (f: { shown: R[]; earlier: R[] }) => [f.shown.map((r) => r.id), f.earlier.map((r) => r.id)];

  it('有活在跑或排队：只摊开进行中的（按原先后），已结束的新的在前收起', () => {
    expect(ids(foldRows([row('a', 'done'), row('b', 'cancelled'), row('c', 'done'), row('d', 'failed'), row('e', 'running')]))).toEqual([
      ['e'],
      ['d', 'c', 'b', 'a'],
    ]);
    expect(ids(foldRows([row('a', 'done'), row('b', 'running'), row('c', 'done'), row('d', 'queued')]))).toEqual([
      ['b', 'd'],
      ['c', 'a'],
    ]);
  });

  it('都结束了只摊开最后一件；只有一件时没有收起的', () => {
    expect(ids(foldRows([row('a', 'failed'), row('b', 'done'), row('c', 'cancelled')]))).toEqual([['c'], ['b', 'a']]);
    expect(ids(foldRows([row('a', 'done')]))).toEqual([['a'], []]);
    expect(ids(foldRows([row('a', 'running')]))).toEqual([['a'], []]);
    expect(foldRows([])).toEqual({ shown: [], earlier: [], pending: 0 });
  });

  it('pending 只数收起里失败或中断、且有补救或重试的；摊开着的不算', () => {
    const f = foldRows([
      row('a', 'failed', { remedy: fix }),
      row('b', 'interrupted', { canRetry: true }),
      row('c', 'failed'),
      row('d', 'cancelled'),
      row('e', 'done'),
    ]);
    expect([f.shown.map((r) => r.id), f.pending]).toEqual([['e'], 2]);
    expect(foldRows([row('a', 'done'), row('b', 'failed', { remedy: fix })]).pending).toBe(0);
    expect(foldRows([row('a', 'failed', { canRetry: true }), row('b', 'running')]).pending).toBe(1);
    expect(needsAction(row('x', 'failed', { remedy: fix }))).toBe(true);
    expect(needsAction(row('x', 'failed'))).toBe(false);
    expect(needsAction(row('x', 'cancelled', { canRetry: true }))).toBe(false);
  });

  it('接在 cardRows 与 jobRowView 后面：之前一件转录失败可去设置、收起了，卡上带出 pending', () => {
    const failed = job({
      state: 'failed',
      endedAt: at(9),
      error: { code: 'MODEL_NOT_READY', message: '模型没装好', details: null } as JobRecord['error'],
    });
    const cancelled = job({ kind: 'export', state: 'cancelled', endedAt: at(9) });
    const jobs = [failed, cancelled];
    const views = cardRows([failed.jobId, cancelled.jobId], jobs).map((j) => jobRowView(j, jobs, 0));
    const f = foldRows(views);
    expect([f.shown.map((r) => r.jobId), f.earlier.map((r) => r.jobId), f.pending]).toEqual([[cancelled.jobId], [failed.jobId], 1]);
  });
});

describe('cardRows', () => {
  it('从链接导入的父任务：流程的转录出来后不再占一行，完成后不列，失败时留着', () => {
    const parent = linkJob({ videoId: 'mov_9' });
    const tr = job({ videoId: 'mov_9', submitter: { kind: 'pipeline', id: parent.jobId } });
    expect(cardRows([parent.jobId], [parent]).map((j) => j.jobId)).toEqual([parent.jobId]);
    expect(cardRows([parent.jobId, tr.jobId], [parent, tr]).map((j) => j.jobId)).toEqual([tr.jobId]);
    expect(cardRows([parent.jobId], [{ ...parent, state: 'completed' }])).toEqual([]);
    const failed = { ...parent, state: 'failed' as const };
    expect(cardRows([failed.jobId], [failed]).map((j) => j.jobId)).toEqual([parent.jobId]);
  });
});

describe('转录用的模型与参数（产品设计 §3.2.2「转录与重新转录另写一行」）', () => {
  const words = { auto: '自动检测', speakers: '识别说话人' };
  const view = {
    transcribe: {
      providers: [
        { providerId: 'local', kind: 'local', label: '本机', models: [{ modelId: 'moss-transcribe', label: 'MOSS Transcribe' }] },
        { providerId: 'openai', kind: 'online', label: 'OpenAI', models: [{ modelId: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' }] },
      ],
    },
  } as unknown as ModelCapabilitiesView;
  const bundles = [{ bundleId: 'qwen3-asr-0.6b', label: 'Qwen3-ASR 0.6B' }];
  const line = (j: JobRecord, jobs: JobRecord[] = [j]) => {
    const f = asrFacts(j, jobs);
    return f ? asrLine(f, asrModelName(view, bundles, f.providerId, f.modelId), words) : null;
  };

  it('模型名 · 本机或云端 · 语言 · 识别说话人；在跑与结束后都写，自动检测照转录工具的说法', () => {
    const run = job({
      providerId: 'local',
      modelId: 'moss-transcribe',
      transcribe: { language: { mode: 'assert', tag: 'zh' }, diarize: true },
    });
    expect(line(run)).toBe('MOSS Transcribe · 本机 · 中文 · 识别说话人');
    const done = { ...run, state: 'completed' as const, endedAt: at(9) };
    expect(line(done)).toBe('MOSS Transcribe · 本机 · 中文 · 识别说话人');
    expect(jobRowView(done, [done], 0).asr).not.toBeNull();
    const cloud = job({
      providerId: 'openai',
      modelId: 'gpt-4o-transcribe',
      bundleId: null,
      transcribe: { language: { mode: 'prefer', tag: null }, diarize: false },
    });
    expect(line(cloud)).toBe('OpenAI · gpt-4o-transcribe · 云端 · 自动检测');
    // 模型包取它的名字；能力视图里没有的照写 ID
    expect(line(job({ modelId: 'qwen3-asr-0.6b', transcribe: { language: { mode: 'prefer', tag: null }, diarize: false } }))).toBe(
      'Qwen3-ASR 0.6B · 本机 · 自动检测',
    );
    expect(line(job({ modelId: 'mystery-asr', transcribe: { language: { mode: 'prefer', tag: null }, diarize: false } }))).toBe(
      'mystery-asr · 本机 · 自动检测',
    );
  });

  it('模型不能区分说话人（报了警告）时不写识别说话人；之前的记录没写语言时这一段不写', () => {
    const asked = job({
      modelId: 'moss-transcribe',
      state: 'completed',
      endedAt: at(9),
      transcribe: { language: { mode: 'prefer', tag: null }, diarize: true },
      warnings: [{ code: 'diarization-unavailable' }] as JobRecord['warnings'],
    });
    expect(line(asked)).toBe('MOSS Transcribe · 本机 · 自动检测');
    expect(line(job({ modelId: 'moss-transcribe' }))).toBe('MOSS Transcribe · 本机');
  });

  it('不是转录的没有这一行', () => {
    expect(asrFacts(job({ kind: 'export' }), [])).toBeNull();
    expect(jobRowView(job({ kind: 'export' }), [], 0).asr).toBeNull();
  });

  it('转录流程：父任务那一行取它提交的转录 Job；还没提交时取冻结的参数；从链接导入的转录记录旧时退回父任务的参数', () => {
    const parent = job({
      kind: 'pipeline',
      providerId: 'local',
      modelId: 'moss-transcribe',
      pipeline: {
        name: 'transcribe',
        params: { videoId: 'mov_1', language: 'en', diarize: true },
        steps: [],
        current: 0,
        stoppedAt: null,
        summary: null,
      },
    });
    expect(line(parent, [parent])).toBe('MOSS Transcribe · 本机 · 英语 · 识别说话人');
    const child = job({
      modelId: 'qwen3-asr-0.6b',
      submitter: { kind: 'pipeline', id: parent.jobId },
      transcribe: { language: { mode: 'assert', tag: 'en' }, diarize: false },
    });
    expect(line(parent, [parent, child])).toBe('Qwen3-ASR 0.6B · 本机 · 英语');
    const link = linkJob({ videoId: 'mov_1' });
    link.pipeline = { ...link.pipeline!, params: { ...link.pipeline!.params, transcribe: true } };
    const old = job({ modelId: 'moss-transcribe', submitter: { kind: 'pipeline', id: link.jobId } });
    expect(line(old, [link, old])).toBe('MOSS Transcribe · 本机 · 自动检测');
  });

  it('转录流程的父任务与它提交的转录 Job 只占一行：转录做完、流程还在建字幕层或之后失败时父任务那一行留着', () => {
    const parent = job({
      kind: 'pipeline',
      pipeline: { name: 'transcribe', params: { videoId: 'mov_1' }, steps: [], current: 0, stoppedAt: null, summary: null },
    });
    const ids = (jobs: JobRecord[]) =>
      cardRows(
        jobs.map((j) => j.jobId),
        jobs,
      ).map((j) => j.jobId);
    expect(ids([parent])).toEqual([parent.jobId]);
    const child = job({ submitter: { kind: 'pipeline', id: parent.jobId } });
    expect(ids([parent, child])).toEqual([child.jobId]);
    const childDone = { ...child, state: 'completed' as const, endedAt: at(9) };
    expect(ids([parent, childDone])).toEqual([parent.jobId, child.jobId]);
    expect(ids([{ ...parent, state: 'completed', endedAt: at(9) }, childDone])).toEqual([child.jobId]);
    expect(ids([{ ...parent, state: 'failed', endedAt: at(9) }, childDone])).toEqual([parent.jobId, child.jobId]);
  });
});

describe('downloadCardView', () => {
  const now = Date.parse(at(0)) + 10_000;

  it('下载中：站点、链接、字节与百分比、能取消', () => {
    const parent = linkJob({ startedAt: at(0) });
    const dl = job({
      jobId: 'job_dl',
      kind: 'pipeline',
      parentJobId: parent.jobId,
      progress: { done: 12_000_000, total: 48_000_000, unit: 'bytes' },
    } as Partial<JobRecord>);
    const view = downloadCardView(parent, [parent, dl], now);
    expect(view).toMatchObject({
      state: 'running',
      title: '正在下载视频',
      name: 'youtube.com',
      source: 'https://www.youtube.com/watch?v=abc',
      pct: 25,
      canCancel: true,
      canRetry: false,
    });
    expect(view.line).toContain('MB');
    expect(view.elapsed).toBe('已用 0:10');
  });

  it('失败写原因，固定流程不给重试', () => {
    const parent = linkJob({
      state: 'failed',
      endedAt: at(9),
      error: { code: 'X', message: '网络断了', details: null } as JobRecord['error'],
    });
    const view = downloadCardView(parent, [parent], now);
    expect(view.state).toBe('failed');
    expect(view.error).toBeTruthy();
    expect(view).toMatchObject({ canRetry: false, canCancel: false, pct: null });
  });

  it('只下载不建视频：完成写落地的文件', () => {
    const parent = linkJob({ state: 'completed', endedAt: at(9) });
    parent.pipeline = {
      ...parent.pipeline!,
      summary: {
        url: 'https://www.youtube.com/watch?v=abc',
        title: '访谈第一集',
        platform: 'youtube',
        files: { media: '/d/访谈第一集.mp4', subtitles: ['/d/访谈第一集.en.vtt'] },
        tool: { name: 'yt-dlp', version: '1', source: 'managed' },
        downloadedAt: at(9),
        videoId: null,
        assetId: null,
        transcribeJobId: null,
      },
    };
    const view = downloadCardView(parent, [parent], now);
    expect(view).toMatchObject({ state: 'done', title: '下载完成', name: '访谈第一集' });
    expect(view.files).toEqual([
      { name: '访谈第一集.mp4', path: '/d/访谈第一集.mp4' },
      { name: '访谈第一集.en.vtt', path: '/d/访谈第一集.en.vtt' },
    ]);
  });
});

describe('会话里的视频活（产物弹层）', () => {
  it('列整条会话归这部视频的活，含流程提交的；别的会话的不列', () => {
    const parent = linkJob({ videoId: 'mov_9', submitter: { kind: 'agent', id: CONV, taskId: 't1' } });
    const tr = job({ videoId: 'mov_9', submitter: { kind: 'pipeline', id: parent.jobId } });
    const ex = job({ kind: 'export', videoId: 'mov_9', submitter: { kind: 'agent', id: CONV, taskId: 't2' } });
    const other = job({ videoId: 'mov_9', submitter: { kind: 'agent', id: 'conv_2', taskId: 't1' } });
    const jobs = [parent, tr, ex, other];
    expect(conversationVideoJobs('mov_9', jobs, CONV)).toEqual([parent.jobId, tr.jobId, ex.jobId]);
    expect(conversationJobVideos(jobs, CONV)).toEqual(['mov_9']);
  });
});
