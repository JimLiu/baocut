import { describe, expect, it } from 'vitest';
import type { ExternalToolStatus, GeneratedOutput, JobRecord, PipelineRun } from '@baocut/protocol';
import { RpcError } from '@baocut/protocol';
import { toolOfJob } from './tool-runs.ts';
import { toolJob } from './tools-test-fixtures.ts';
import {
  addEntryInput,
  addInputs,
  addNotice,
  againTranscodeDraft,
  BLANK_COMPRESS,
  BLANK_EXTRACT,
  BLANK_MERGE,
  commandText,
  crfOf,
  entryIdOfInput,
  elapsedText,
  failureDetail,
  failureRemedy,
  ffmpegLine,
  humanBytes,
  inputSizes,
  isAbsolutePath,
  mergeModeLine,
  moveInput,
  moveInputs,
  parsePathInput,
  rejectionText,
  removeInput,
  retryParams,
  settingsLine,
  sortByName,
  spaceInput,
  transcodeJobs,
  transcodeMeta,
  transcodeProblems,
  transcodeProgress,
  transcodeRequest,
  transcodeResults,
  transcodeStateWord,
  transcodeTitle,
  type TranscodeDraft,
} from './tools-transcode.ts';

const STEPS = [
  { name: 'probe', label: '读取输入' },
  { name: 'encode', label: '编码' },
  { name: 'verify', label: '校验输出' },
  { name: 'publish', label: '发布' },
];

function run(params: Record<string, unknown>, patch: Partial<PipelineRun> = {}): PipelineRun {
  return {
    name: 'transcode',
    params,
    steps: STEPS.map((s) => ({ ...s, status: 'pending', jobId: null, attempts: 0, output: null })),
    current: null,
    stoppedAt: null,
    summary: null,
    ...patch,
  };
}

function transcodeJob(params: Record<string, unknown>, patch: Partial<JobRecord> = {}, pipeline: Partial<PipelineRun> = {}): JobRecord {
  return toolJob({
    jobId: 'job_t',
    kind: 'pipeline',
    phase: 'probing',
    providerId: 'ffmpeg',
    modelId: '8.0.1',
    generation: undefined,
    pipeline: run(params, pipeline),
    ...patch,
  });
}

function videoOut(path: string, byteLength: number, patch: Partial<Extract<GeneratedOutput['media'], { kind: 'video' }>> = {}): GeneratedOutput {
  return {
    artifactId: 'sha256:ff',
    mediaType: 'video/mp4',
    byteLength,
    assetId: null,
    path,
    media: { kind: 'video', durationSec: 42, width: 1280, height: 720, videoCodec: 'h264', audioCodec: 'aac', ...patch },
  };
}

const draft = (patch: Partial<TranscodeDraft> = {}): TranscodeDraft => ({ ...BLANK_COMPRESS, inputs: ['/v/a.mp4'], ...patch });

describe('选文件', () => {
  it('手动输入的路径去掉引号、还原终端转义与 file:// 网址', () => {
    expect(parsePathInput('  "/Users/me/My Movies/a.mov" ')).toBe('/Users/me/My Movies/a.mov');
    expect(parsePathInput('/Users/me/My\\ Movies/a.mov')).toBe('/Users/me/My Movies/a.mov');
    expect(parsePathInput('file:///Users/me/My%20Movies/a.mov')).toBe('/Users/me/My Movies/a.mov');
    expect(parsePathInput('   ')).toBeNull();
    expect(isAbsolutePath('/a.mp4')).toBe(true);
    expect(isAbsolutePath('C:\\v\\a.mp4')).toBe(true);
    expect(isAbsolutePath('a.mp4')).toBe(false);
  });

  it('加文件：去重、不是视频的与相对路径不收，并说清楚', () => {
    const r = addInputs(['/v/a.mp4'], ['/v/a.mp4', '/v/b.mov', '/v/song.mp3', 'c.mp4', '/v/raw.mts']);
    // 扩展名认不出的（.mts）放行，交给 ffprobe 判断。
    expect(r.inputs).toEqual(['/v/a.mp4', '/v/b.mov', '/v/raw.mts']);
    expect(addNotice(r)).toBe('song.mp3 不是视频文件；c.mp4 不是绝对路径；a.mp4 已经在列表里');
    expect(addNotice(addInputs([], ['/v/x.mkv']))).toBeNull();
  });

  it('提取音频另收音频文件', () => {
    expect(addInputs([], ['/v/song.mp3', '/v/a.mp4'], true).inputs).toEqual(['/v/song.mp3', '/v/a.mp4']);
    expect(addInputs([], ['/v/cover.png'], true).rejected).toEqual(['/v/cover.png']);
  });

  it('最多 100 个文件', () => {
    const many = Array.from({ length: 99 }, (_, i) => `/v/${i}.mp4`);
    const r = addInputs(many, ['/v/x.mp4', '/v/y.mp4', '/v/z.mp4']);
    expect(r.inputs).toHaveLength(100);
    expect(r.overflow).toBe(2);
    expect(addNotice(r)).toBe('一次最多 100 个文件，多出的 2 个没有加');
  });

  it('上移、下移、移出、拖着排、按文件名排', () => {
    const list = ['/a', '/b', '/c'];
    expect(moveInput(list, 2, -1)).toEqual(['/a', '/c', '/b']);
    expect(moveInput(list, 0, -1)).toEqual(list);
    expect(removeInput(list, 1)).toEqual(['/a', '/c']);
    expect(moveInputs(list, ['/c'], '/a', 'before')).toEqual(['/c', '/a', '/b']);
    expect(moveInputs(list, ['/a'], '/c', 'after')).toEqual(['/b', '/c', '/a']);
    expect(moveInputs(list, ['/a'], '/a', 'after')).toEqual(list);
    expect(sortByName(['/x/clip10.mp4', '/y/clip2.mp4', '/z/Clip1.mp4'])).toEqual(['/z/Clip1.mp4', '/y/clip2.mp4', '/x/clip10.mp4']);
  });
});

describe('提交', () => {
  it('没选文件、合并只有一段、码率越界、输出目录不是绝对路径时拦下', () => {
    expect(transcodeProblems(draft({ inputs: [] }), 'compress')).toEqual(['先选一个视频文件']);
    expect(transcodeProblems(draft({ inputs: [] }), 'merge')).toEqual(['至少要两段视频']);
    expect(transcodeProblems(draft(), 'merge')).toEqual(['至少要两段视频，再加一段']);
    expect(transcodeProblems(draft({ rate: 'bitrate', videoKbps: 50 }), 'compress')).toEqual(['视频码率要在 100–200000 kbps 之间']);
    expect(transcodeProblems(draft({ outDir: 'out' }), 'compress')).toEqual(['输出目录要写绝对路径']);
    expect(transcodeProblems(draft({ outDir: '  ' }), 'compress')).toEqual([]);
    expect(transcodeProblems(draft({ inputs: ['/a.mp4', '/b.mp4'] }), 'merge')).toEqual([]);
  });

  it('按画质只给 CRF，按码率只给码率；没选目录与不缩放时不给', () => {
    expect(transcodeRequest(draft(), 'compress')).toEqual({ inputs: ['/v/a.mp4'], action: 'compress', codec: 'h264', crf: 26, audioBitrateKbps: 128 });
    expect(transcodeRequest(draft({ codec: 'hevc', quality: 'smaller', maxHeight: 720, outDir: ' /out ' }), 'compress')).toEqual({
      inputs: ['/v/a.mp4'],
      action: 'compress',
      codec: 'hevc',
      maxHeight: 720,
      crf: 35,
      audioBitrateKbps: 128,
      outDir: '/out',
    });
    const byRate = transcodeRequest({ ...BLANK_MERGE, inputs: ['/a.mp4', '/b.mp4'], rate: 'bitrate', videoKbps: 2500, audioKbps: 192 }, 'merge');
    expect(byRate).toEqual({ inputs: ['/a.mp4', '/b.mp4'], action: 'merge', codec: 'h264', videoBitrateKbps: 2500, audioBitrateKbps: 192 });
    expect('crf' in byRate).toBe(false);
    expect(crfOf('high', 'h264')).toBe(22);
  });

  it('提取音频只给文件、音频码率与输出目录；没选文件时说视频或音频', () => {
    expect(transcodeRequest({ ...BLANK_EXTRACT, inputs: ['/v/a.mp4'], maxHeight: 720, outDir: '/out' }, 'extract-audio')).toEqual({
      inputs: ['/v/a.mp4'],
      action: 'extract-audio',
      audioBitrateKbps: 128,
      outDir: '/out',
    });
    expect(transcodeProblems({ ...BLANK_EXTRACT }, 'extract-audio')).toEqual(['先选一个视频或音频文件']);
  });

  it('Space 条目在列表里记成 space:<entryId>：不算相对路径、不重复加，提交时换成 { entryId }', () => {
    expect(spaceInput('ent_1')).toBe('space:ent_1');
    expect(entryIdOfInput('space:ent_1')).toBe('ent_1');
    expect(entryIdOfInput('/v/a.mp4')).toBeNull();
    const inputs = addEntryInput(addEntryInput(['/v/a.mp4'], 'ent_1'), 'ent_1');
    expect(inputs).toEqual(['/v/a.mp4', 'space:ent_1']);
    expect(transcodeProblems({ ...BLANK_MERGE, inputs }, 'merge')).toEqual([]);
    expect(transcodeRequest({ ...BLANK_EXTRACT, inputs }, 'extract-audio').inputs).toEqual(['/v/a.mp4', { entryId: 'ent_1' }]);
    const names: Record<string, string> = { 'space:ent_1': 'clip10.mp4', 'space:ent_2': 'clip2.mp4' };
    expect(sortByName(['space:ent_1', 'space:ent_2'], (i) => names[i] ?? i)).toEqual(['space:ent_2', 'space:ent_1']);
    const done = transcodeJob(
      { inputs: ['/v/a.mp4', '/v/b.mp4'], action: 'extract-audio' },
      {
        state: 'completed',
        result: {
          documentId: null,
          artifactId: 'sha256:aa',
          outputs: [{ artifactId: 'sha256:aa', mediaType: 'audio/mp4', byteLength: 2 * 1024 * 1024, assetId: null, path: '/dl/a.m4a', media: { kind: 'audio', durationSec: 42, sampleRate: 48000, channels: 2 } }],
        },
      },
    );
    expect(transcodeMeta(done)).toBe('提取音频 2 个');
    expect(transcodeResults(done)).toEqual([{ path: '/dl/a.m4a', name: 'a.m4a', meta: '0:42 · 48 kHz', size: '2.0 MB' }]);
    expect(toolOfJob(done)).toBe('extract-audio');
  });

  it('设置的一行摘要', () => {
    expect(settingsLine(draft())).toBe('原始分辨率 · H.264 · 均衡 · 音频 128 kbps');
    expect(settingsLine(draft({ maxHeight: 720, codec: 'hevc', rate: 'bitrate', videoKbps: 3000 }))).toBe('720p · H.265 · 3000 kbps · 音频 128 kbps');
  });

  it('被拒时点名 ffmpeg，其余照 Runtime 的原话', () => {
    expect(rejectionText(new RpcError('conflict', '找不到 ffmpeg', { code: 'MEDIA_TOOL_UNAVAILABLE' }))).toBe('ffmpeg 不能用：找不到 ffmpeg');
    expect(rejectionText(new RpcError('not-found', '找不到输入文件 /v/a.mp4'))).toBe('找不到输入文件 /v/a.mp4');
  });
});

describe('ffmpeg 的现状', () => {
  const status = (patch: Partial<ExternalToolStatus>): ExternalToolStatus =>
    ({ name: 'ffmpeg', label: 'ffmpeg', state: 'installed', version: '8.0.1', reason: null, remedy: null, ...patch }) as ExternalToolStatus;
  it('就绪、没装、太旧', () => {
    expect(ffmpegLine(status({}))).toEqual({ ready: true, text: 'ffmpeg 8.0.1 就绪', remedy: null });
    expect(ffmpegLine(status({ state: 'missing', version: null, remedy: '安装 ffmpeg' }))).toEqual({ ready: false, text: '要先装 ffmpeg', remedy: '安装 ffmpeg' });
    expect(ffmpegLine(status({ state: 'outdated', version: '3.4', reason: '低于 4.0' })).ready).toBe(false);
    expect(ffmpegLine(null).ready).toBe(false);
  });
});

describe('记录', () => {
  const compress = transcodeJob({ inputs: ['/v/holiday.mov'], action: 'compress', codec: 'h264', maxHeight: 720, crf: 26, audioBitrateKbps: 128 });
  const merge = transcodeJob(
    { inputs: ['/v/a.mp4', '/v/b.mp4', '/v/c.mp4'], action: 'merge', codec: 'h264', crf: 23, audioBitrateKbps: 128 },
    { jobId: 'job_m', createdAt: '2026-10-03T00:01:00.000Z' },
  );

  it('只列界面提交的 transcode 父任务，新的在前；别的流程、子任务、视频里的、藏起来的不列', () => {
    const translate = transcodeJob({}, { jobId: 'job_x' }, { name: 'translate' });
    const step = toolJob({ jobId: 'job_s', kind: 'pipeline-step', parentJobId: 'job_t' });
    const inVideo = transcodeJob({ inputs: ['/a'], action: 'compress' }, { jobId: 'job_v', videoId: 'vid_1' });
    const byAgent = transcodeJob({ inputs: ['/a'], action: 'compress' }, { jobId: 'job_g', submitter: { kind: 'agent', id: 'a1' } as JobRecord['submitter'] });
    const list = transcodeJobs([compress, merge, translate, step, inVideo, byAgent], []);
    expect(list.map((j) => j.jobId)).toEqual(['job_m', 'job_t']);
    expect(transcodeJobs([compress, merge], ['job_m']).map((j) => j.jobId)).toEqual(['job_t']);
  });

  it('标题与设置行', () => {
    expect(transcodeTitle(compress)).toBe('holiday.mov');
    expect(transcodeTitle(merge)).toBe('a.mp4 + 2 段');
    expect(transcodeMeta(compress)).toBe('压缩 · ≤720p · H.264 · 均衡（CRF 26）');
    expect(transcodeMeta(merge)).toBe('合并 3 段 · H.264 · CRF 23');
    const done = { ...compress, result: { documentId: null, artifactId: 'sha256:ff', outputs: [videoOut('/v/holiday-compressed.mp4', 1000)] } };
    expect(transcodeTitle(done)).toBe('holiday-compressed.mp4');
  });

  it('编码时读子任务按秒的进度；别的步骤写第几步', () => {
    const child = toolJob({ jobId: 'job_enc', kind: 'pipeline-step', phase: 'encoding', progress: { done: 12.4, total: 42, unit: 'seconds' } });
    const running = transcodeJob(
      { inputs: ['/a.mp4'], action: 'compress' },
      { phase: 'encoding', progress: { done: 1, total: 4, unit: 'steps' } },
      { current: 1, steps: STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'completed' : i === 1 ? 'running' : 'pending', jobId: i === 1 ? 'job_enc' : null, attempts: i <= 1 ? 1 : 0, output: null })) },
    );
    expect(transcodeProgress(running, [running, child])).toEqual({ text: '编码中 0:12 / 0:42 · 29%', percent: 29 });
    // 子任务还没到：不伪造百分比。
    expect(transcodeProgress(running, [running])).toEqual({ text: '编码中', percent: null });
    const probing = transcodeJob({ inputs: ['/a.mp4'], action: 'compress' }, {}, { current: 0 });
    expect(transcodeProgress(probing, [probing])).toEqual({ text: '读取输入 · 第 1/4 步', percent: null });
    expect(transcodeProgress(transcodeJob({ inputs: ['/a.mp4'], action: 'compress' }, { state: 'queued', phase: 'queued' }), []).text).toBe('排队中');
    // 这一步的子任务在排队：照 Runtime 记着的原因写。
    const waiting = toolJob({ jobId: 'job_enc', kind: 'pipeline-step', state: 'queued', phase: 'queued', wait: { reason: 'concurrency', detail: '等 ffmpeg 空出名额', since: '2026-10-03T00:00:01.000Z' } });
    expect(transcodeProgress(running, [running, waiting])).toEqual({ text: '编码 · 等 ffmpeg 空出名额', percent: null });
  });

  it('压缩的结果行：输出规格与省了多少（源文件大小来自读取输入那一步）', () => {
    const probe = { ...STEPS[0]!, status: 'completed' as const, jobId: 'job_p', attempts: 1, output: { stats: [{ size: 68.4 * 1024 * 1024, mtimeMs: 1 }], mode: 're-encode', reason: null } };
    const params = { inputs: ['/v/holiday.mov'], action: 'compress', codec: 'h264', crf: 26, audioBitrateKbps: 128 };
    const steps = [probe, ...STEPS.slice(1).map((s) => ({ ...s, status: 'completed' as const, jobId: null, attempts: 1, output: null }))];
    const finished = (bytes: number) =>
      transcodeJob(params, { state: 'completed', result: { documentId: null, artifactId: 'sha256:ff', outputs: [videoOut('/v/holiday-compressed.mp4', bytes)] } }, { steps });
    const done = finished(21.8 * 1024 * 1024);
    expect(transcodeResults(done)).toEqual([
      { path: '/v/holiday-compressed.mp4', name: 'holiday-compressed.mp4', meta: '1280×720 · 0:42 · H.264 / AAC', size: '68.4 MB → 21.8 MB（小 68%）' },
    ]);
    // 读不到源文件大小时只写输出大小。
    const bare = transcodeJob({ inputs: ['/v/a.mov'], action: 'compress' }, { result: done.result });
    expect(inputSizes(bare)).toBeNull();
    expect(transcodeResults(bare)[0]!.size).toBe('21.8 MB');
    expect(humanBytes(512 * 1024)).toBe('512 KB');
    // 只小了不到 1%：不写「小 0%」。
    expect(transcodeResults(finished(68.3 * 1024 * 1024))[0]!.size).toBe('68.4 MB → 68.3 MB（几乎没变）');
    expect(transcodeResults(finished(70 * 1024 * 1024))[0]!.size).toBe('68.4 MB → 70.0 MB（没有变小）');
  });

  it('合并的结果行写源文件一共多大，不算省了多少；流复制时设置行只写段数与流复制', () => {
    const probe = { ...STEPS[0]!, status: 'completed' as const, jobId: 'job_p', attempts: 1, output: { stats: [{ size: 400 * 1024, mtimeMs: 1 }, { size: 443 * 1024, mtimeMs: 1 }], mode: 'stream-copy', reason: null } };
    const params = { inputs: ['/v/a.mp4', '/v/b.mp4'], action: 'merge', codec: 'h264', crf: 22, audioBitrateKbps: 128 };
    const running = transcodeJob(params, { state: 'running' }, { steps: [probe, ...STEPS.slice(1).map((s) => ({ ...s, status: 'pending' as const, jobId: null, attempts: 0, output: null }))] });
    expect(transcodeMeta(running)).toBe('合并 2 段 · 流复制');
    const done = transcodeJob(
      params,
      { state: 'completed', result: { documentId: null, artifactId: 'sha256:ff', outputs: [videoOut('/v/a-merged.mp4', 842 * 1024)] } },
      {
        steps: [probe, ...STEPS.slice(1).map((s) => ({ ...s, status: 'completed' as const, jobId: null, attempts: 1, output: null }))],
        summary: { action: 'merge', mode: 'stream-copy', reason: null, executor: { tool: 'ffmpeg', version: '8.0.1', commands: [] }, files: ['/v/a-merged.mp4'] },
      },
    );
    expect(transcodeMeta(done)).toBe('合并 2 段 · 流复制');
    expect(transcodeResults(done)[0]!.size).toBe('842 KB（源文件共 843 KB）');
    // 重新编码的合并照常写编码与画质。
    const reencoded = transcodeJob(params, {}, { summary: { action: 'merge', mode: 're-encode', reason: '分辨率不一致', executor: { tool: 'ffmpeg', version: '8.0.1', commands: [] }, files: [] } });
    expect(transcodeMeta(reencoded)).toBe('合并 2 段 · H.264 · 高画质（CRF 22）');
  });

  it('合并写流复制还是重新编码与原因；完成前读取输入那一步判定了的先写出来', () => {
    const copied = transcodeJob({ inputs: ['/a.mp4', '/b.mp4'], action: 'merge' }, {}, {
      summary: { action: 'merge', mode: 'stream-copy', reason: null, executor: { tool: 'ffmpeg', version: '8.0.1', commands: [] }, files: ['/a-merged.mp4'] },
    });
    expect(mergeModeLine(copied)).toEqual({ mode: 'stream-copy', text: '各段参数一致：直接流复制，没有重新编码，画质不变' });
    const probing = transcodeJob({ inputs: ['/a.mp4', '/b.mp4'], action: 'merge' }, {}, {
      steps: STEPS.map((s, i) => ({ ...s, status: i ? 'pending' : 'completed', jobId: null, attempts: 0, output: i ? null : { mode: 're-encode', reason: '分辨率不一致（1920x1080 / 1280x720）', stats: [] } })),
    });
    expect(mergeModeLine(probing)).toEqual({ mode: 're-encode', text: '重新编码：分辨率不一致（1920x1080 / 1280x720）' });
    expect(mergeModeLine(compress)).toBeNull();
    expect(mergeModeLine(merge)).toBeNull();
  });

  it('复制命令：每条一行，带空格的参数加引号', () => {
    const done = transcodeJob({ inputs: ['/a.mp4'], action: 'compress' }, {}, {
      summary: { action: 'compress', mode: 're-encode', reason: null, executor: { tool: 'ffmpeg', version: '8', commands: [['-i', 'file:my clip.mp4', '-crf', '26', 'my clip-compressed.mp4']] }, files: [] },
    });
    expect(commandText(done)).toBe("ffmpeg -i 'file:my clip.mp4' -crf 26 'my clip-compressed.mp4'");
    expect(commandText(compress)).toBeNull();
  });

  it('状态词、用时、失败的修法与原文', () => {
    expect(transcodeStateWord({ state: 'running', endedAt: null })).toBe('处理中');
    expect(transcodeStateWord({ state: 'queued', endedAt: null })).toBe('排队中');
    expect(transcodeStateWord({ state: 'completed', endedAt: 'x' })).toBeNull();
    expect(elapsedText({ startedAt: '2026-10-03T00:00:00.000Z', endedAt: '2026-10-03T00:01:05.000Z' })).toBe('用了 1 分 5 秒');
    expect(elapsedText({ startedAt: '2026-10-03T00:00:00.000Z', endedAt: '2026-10-03T00:00:00.400Z' })).toBe('不到 1 秒');
    const failed = transcodeJob({ inputs: ['/a.mp4'], action: 'compress' }, {
      state: 'failed',
      error: { code: 'EXPORT_VALIDATION_FAILED', message: 'a.mp4 的输出没有通过校验', details: { problems: ['时长 1.00 秒，应约为 5.00 秒'] } },
    });
    expect(failureRemedy(failed)).toMatch(/没有通过校验/);
    expect(failureDetail(failed)).toBe('时长 1.00 秒，应约为 5.00 秒');
    expect(failureDetail({ error: { code: 'TRANSCODE_FAILED', message: 'x', details: { stderr: ' No space left on device \n' } } })).toBe('No space left on device');
    expect(failureRemedy({ state: 'interrupted', error: null })).toBeNull();
    // 缺 ffmpeg：用 Runtime 按它的平台给的那句；没给时只说装什么，不猜平台。
    const winget = '安装 ffmpeg（含 ffprobe，例如 winget install --id Gyan.FFmpeg -e），或用环境变量 BAOCUT_FFMPEG 指定';
    expect(
      failureRemedy({ state: 'failed', error: { code: 'MEDIA_TOOL_UNAVAILABLE', message: '找不到 ffmpeg', details: { remedy: winget } } }),
    ).toBe(`${winget}，然后再试一次`);
    const bare = failureRemedy({ state: 'failed', error: { code: 'MEDIA_TOOL_UNAVAILABLE', message: '找不到 ffmpeg' } });
    expect(bare).toBe('安装 ffmpeg，或用 BAOCUT_FFMPEG 指定路径，然后再试一次');
    expect(ffmpegLine(null).remedy).not.toMatch(/brew|winget|apt/);
  });

  it('带回左边：冻结的参数回到表单，CRF 取最接近的一档；重试照原参数', () => {
    expect(againTranscodeDraft(compress, BLANK_COMPRESS)).toEqual({ ...BLANK_COMPRESS, inputs: ['/v/holiday.mov'], maxHeight: 720, quality: 'balanced' });
    // h264 的 23 离「均衡」26 比离「高画质」22 远：取高画质。
    expect(againTranscodeDraft(merge, BLANK_MERGE)?.quality).toBe('high');
    const byRate = transcodeJob({ inputs: ['/a.mp4'], action: 'compress', codec: 'hevc', videoBitrateKbps: 2500, audioBitrateKbps: 96, outDir: '/out' });
    expect(againTranscodeDraft(byRate, BLANK_COMPRESS)).toMatchObject({ codec: 'hevc', rate: 'bitrate', videoKbps: 2500, audioKbps: 96, outDir: '/out' });
    expect(retryParams(merge)).toEqual(merge.pipeline!.params);
    expect(againTranscodeDraft(toolJob(), BLANK_COMPRESS)).toBeNull();
  });
});
