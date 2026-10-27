import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@baocut/protocol';
import { M } from '../cli-copy.ts';
import { jobRecord } from '../testing/fake-client.ts';
import { ProgressReporter } from './progress.ts';

function capture(mode: 'jsonl' | 'text') {
  const stream = new PassThrough();
  let out = '';
  stream.on('data', (chunk) => (out += String(chunk)));
  return { reporter: new ProgressReporter(mode, stream), read: () => out };
}

const image = (done: number, remainingSec: number | null) =>
  jobRecord({ jobId: 'job_1', state: 'running', phase: 'generating', progress: { done, total: 8, unit: 'steps', remainingSec } });

/** 转录流程在第三步（转写）：父任务数步骤，阶段跟着转写走。 */
const pipeline = (phase: JobRecord['phase']) =>
  jobRecord({
    jobId: 'job_p',
    kind: 'pipeline',
    phase,
    progress: { done: 2, total: 4, unit: 'steps' },
    pipeline: { name: 'transcribe', params: {}, steps: [], current: 2, stoppedAt: null, summary: null },
  });
const stepJob = (done: number, total: number | null, unit: 'seconds' | 'segments') =>
  jobRecord({ jobId: 'job_s', kind: 'pipeline-step', phase: unit === 'seconds' ? 'transcribing' : 'aligning', progress: { done, total, unit } });

describe('ProgressReporter（Agent 面设计 §5.1）', () => {
  it('jsonl：progress 事件带 done、total、unit；本机生图按步时带 remainingSec（算不出时 null）', () => {
    const { reporter, read } = capture('jsonl');
    reporter.update(image(0, null));
    reporter.update(image(3, 20));
    const events = read().trim().split('\n').map((line) => JSON.parse(line));
    expect(events).toEqual([
      { type: 'progress', jobId: 'job_1', state: 'running', stage: 'generating', pct: 0, done: 0, total: 8, unit: 'steps', remainingSec: null },
      { type: 'progress', jobId: 'job_1', state: 'running', stage: 'generating', pct: 37.5, done: 3, total: 8, unit: 'steps', remainingSec: 20 },
    ]);
  });

  it('jsonl：没有预计剩余的进度不写 remainingSec；没有进度不写 done/total/unit', () => {
    const { reporter, read } = capture('jsonl');
    reporter.update(jobRecord({ jobId: 'job_2', state: 'running', phase: 'starting', progress: null }));
    reporter.update(jobRecord({ jobId: 'job_2', state: 'running', phase: 'transcribing', progress: { done: 30, total: 60, unit: 'seconds' } }));
    const [first, second] = read().trim().split('\n').map((line) => JSON.parse(line));
    expect(first).not.toHaveProperty('done');
    expect(second).toMatchObject({ done: 30, total: 60, unit: 'seconds', pct: 50 });
    expect(second).not.toHaveProperty('remainingSec');
  });

  it('固定流程：jsonl 的 pct 仍数步骤，另带正在执行的那一步的阶段与进度；同一整百分比里不重复写', () => {
    const { reporter, read } = capture('jsonl');
    reporter.update(pipeline('aligning'), stepJob(333, 496, 'segments'));
    reporter.update(pipeline('aligning'), stepJob(334, 496, 'segments'));
    reporter.update(pipeline('aligning'), stepJob(340, 496, 'segments'));
    const events = read().trim().split('\n').map((line) => JSON.parse(line));
    expect(events).toEqual([
      {
        type: 'progress', jobId: 'job_p', state: 'running', stage: 'aligning', pct: 50, done: 2, total: 4, unit: 'steps',
        step: { jobId: 'job_s', stage: 'aligning', pct: 67.1, done: 333, total: 496, unit: 'segments' },
      },
      {
        type: 'progress', jobId: 'job_p', state: 'running', stage: 'aligning', pct: 50, done: 2, total: 4, unit: 'steps',
        step: { jobId: 'job_s', stage: 'aligning', pct: 68.5, done: 340, total: 496, unit: 'segments' },
      },
    ]);
  });

  it('固定流程：文字先写完成了几步，再写这一步的阶段与进度；按秒的写成时钟；这一步没有进度时只写阶段', () => {
    const { reporter, read } = capture('text');
    reporter.update(pipeline('transcribing'), null);
    reporter.update(pipeline('transcribing'), stepJob(1234.6, 10627, 'seconds'));
    reporter.update(pipeline('aligning'), stepJob(333, 496, 'segments'));
    reporter.update(pipeline('aligning'), stepJob(12, null, 'segments'));
    expect(read().trim().split('\n')).toEqual([
      'job_p · running · 2/4 · transcribing',
      'job_p · running · 2/4 · transcribing 12% (20:35 / 2:57:07)',
      'job_p · running · 2/4 · aligning 67% (333/496 segments)',
      'job_p · running · 2/4 · aligning 12 segments',
    ]);
  });

  it('文字：按步写 3/8，有预计剩余时接剩余时间', () => {
    const { reporter, read } = capture('text');
    reporter.update(image(0, null));
    reporter.update(image(3, 75));
    expect(read().trim().split('\n')).toEqual([
      'job_1 · running · generating 0% 0/8',
      `job_1 · running · generating 38% 3/8 · ${M.jobRemaining('1:15')}`,
    ]);
  });
});
