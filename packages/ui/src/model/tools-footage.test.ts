import { describe, expect, it } from 'vitest';
import type { JobRecord, ToolInputFacts, ToolStatus } from '@baocut/protocol';
import {
  BLANK_FOOTAGE_FORM,
  FOOTAGE_TOOL_IDS,
  againFootage,
  etaText,
  footageBlockers,
  footageCardStatus,
  footageJobs,
  footageNextSteps,
  footageRequest,
  leftText,
  managedToolsFor,
  planOf,
  rangeOf,
  recordProgress,
  recordSummary,
  recordTitle,
  sentences,
  sourceLine,
  sourcesFor,
  workload,
  type FootageForm,
  type FootageToolId,
  type Stabilizer,
  type FootageSource,
} from './tools-footage.ts';
import { M } from './tools-footage-copy.ts';

/** 素材处理六个工具的表单规则（设计稿 model-footage.js）：缺省值、帧数、上限、工作量与提交参数。 */

const video = (over: Partial<ToolInputFacts> = {}): ToolInputFacts => ({
  kind: 'video',
  name: 'a.mp4',
  bytes: 88_000_000,
  durationSec: 42,
  width: 1920,
  height: 1080,
  frameRate: 30,
  hdr: false,
  hasAudio: true,
  ...over,
});
const image: ToolInputFacts = { kind: 'image', name: 'p.png', bytes: 1000, durationSec: null, width: 2048, height: 2048, frameRate: null, hdr: false, hasAudio: false };
const audio: ToolInputFacts = { kind: 'audio', name: 's.mp3', bytes: 5_000_000, durationSec: 214, width: null, height: null, frameRate: null, hdr: false, hasAudio: true };
const src = (facts: ToolInputFacts, input = `/${facts.name}`): FootageSource => ({ input, facts });
const form = (over: Partial<FootageForm> = {}): FootageForm => ({ ...BLANK_FOOTAGE_FORM, ...over });

describe('缺省值与要下载的工具', () => {
  it('缺省值照协议', () => {
    expect(BLANK_FOOTAGE_FORM).toMatchObject({ strength: 'medium', scale: 2, model: 'video', factor: 2, mode: 'slowmo', method: 'hm-mkl-hm', amount: 1, matteModel: 'fast', temporal: 0.3, stems: 'vocals' });
  });
  it('去抖、统一色调、分轨不用下载；抠像按选的权重各下各的', () => {
    expect(managedToolsFor('stabilize-video', form())).toEqual([]);
    expect(managedToolsFor('match-color', form())).toEqual([]);
    expect(managedToolsFor('separate-audio', form())).toEqual([]);
    expect(managedToolsFor('upscale-video', form())).toEqual(['realesrgan-ncnn-vulkan']);
    expect(managedToolsFor('interpolate-video', form())).toEqual(['rife-ncnn-vulkan']);
    expect(managedToolsFor('remove-background', form())).toEqual(['matte-models']);
    expect(managedToolsFor('remove-background', form({ matteModel: 'general' }))).toEqual(['matte-models-isnet']);
  });
  it('换工具时只列这个工具收的输入，别的留在草稿里', () => {
    const draft = { inputs: ['/a.mp4', '/p.png', '/s.mp3'], facts: { '/a.mp4': video(), '/p.png': image, '/s.mp3': audio } };
    expect(sourcesFor('stabilize-video', draft).map((s) => s.input)).toEqual(['/a.mp4']);
    expect(sourcesFor('remove-background', draft).map((s) => s.input)).toEqual(['/a.mp4', '/p.png']);
    expect(sourcesFor('separate-audio', draft).map((s) => s.input)).toEqual(['/a.mp4', '/s.mp3']);
  });
});

describe('计划', () => {
  it('插帧：整段输出 (帧数 − 1) × 倍数 + 1 张；慢动作帧率不变，提高帧率时长不变', () => {
    const slow = planOf('interpolate-video', form({ factor: 4 }), video());
    expect(slow.frames).toBe(1260);
    expect(slow.outFrames).toBe(1259 * 4 + 1);
    expect(slow.outFps).toBe(30);
    expect(slow.outSeconds!).toBeCloseTo(168, 0);
    const smooth = planOf('interpolate-video', form({ factor: 4, mode: 'smooth' }), video());
    expect(smooth.outFps).toBe(120);
    expect(smooth.outSeconds!).toBeCloseTo(42, 0);
  });
  it('只处理一段：帧数按这一段算，结束晚于文件时截到末尾', () => {
    expect(planOf('upscale-video', form({ ranged: true, start: 12, end: 20 }), video()).frames).toBe(240);
    expect(rangeOf(form({ ranged: true, start: 40, end: 100 }), video()).seconds).toBe(2);
    expect(sourceLine('upscale-video', form({ ranged: true, start: 12, end: 20 }), src(video()))).toContain('240');
  });
  it('超分的边长取偶数', () => {
    expect(planOf('upscale-video', form({ scale: 3 }), video({ width: 641, height: 361 }))).toMatchObject({ outWidth: 1922, outHeight: 1082 });
  });
});

describe('开始前的检查', () => {
  it('过不去的一选中就标出来', () => {
    expect(footageBlockers('stabilize-video', form(), [src(video({ hdr: true }))])[0]).toMatch(/HDR/);
    expect(footageBlockers('upscale-video', form({ scale: 3 }), [src(video({ width: 3840, height: 2160 }))])[0]).toMatch(/11520×6480.*7680/);
    expect(footageBlockers('upscale-video', form({ scale: 4 }), [src(video())])).toEqual([]);
    expect(footageBlockers('remove-background', form(), [src(video({ durationSec: 9000 }))])[0]).toMatch(/270,000.*216,000/);
    expect(footageBlockers('stabilize-video', form(), [src(video({ durationSec: 9000 }))]), '只走滤镜链的没有帧数上限').toEqual([]);
    expect(footageBlockers('upscale-video', form({ ranged: true, start: 0, end: 60 }), [src(video({ durationSec: 9000 }))]), '选一段就过了上限').toEqual([]);
    expect(footageBlockers('match-color', form({ ranged: true }), [src(video()), src(image)])[0]).toContain('p.png');
    expect(footageBlockers('stabilize-video', form({ ranged: true, start: 20, end: 10 }), [src(video())]).length).toBe(1);
    expect(footageBlockers('stabilize-video', form({ ranged: true, start: 100, end: 110 }), [src(video())])[0]).toContain('a.mp4');
  });
  it('分轨：要有音轨；只能分两轨的模型不能选四轨', () => {
    expect(footageBlockers('separate-audio', form(), [src(video({ hasAudio: false }))])[0]).toContain('a.mp4');
    const mel = { label: 'Mel-Band RoFormer', usable: true, fourStems: false };
    expect(footageBlockers('separate-audio', form({ stems: 'four' }), [src(audio)], mel)[0]).toContain('Mel-Band RoFormer');
    expect(footageBlockers('separate-audio', form(), [src(audio)], mel)).toEqual([]);
    expect(footageBlockers('separate-audio', form({ stems: 'four' }), [src(audio)], { ...mel, fourStems: true })).toEqual([]);
    // HDR 对分轨没有关系（只取音轨）。
    expect(footageBlockers('separate-audio', form(), [src(video({ hdr: true }))])).toEqual([]);
  });
  it('还差一步的按顺序说：选文件、选参考、下载', () => {
    expect(footageNextSteps('stabilize-video', form(), [], {}).length).toBe(1);
    expect(footageNextSteps('stabilize-video', form(), [src(video())], {})).toEqual([]);
    expect(footageNextSteps('match-color', form(), [src(video())], {}).length).toBe(1);
    expect(footageNextSteps('match-color', form({ reference: '/r.png' }), [src(video())], {})).toEqual([]);
    expect(footageNextSteps('interpolate-video', form(), [src(video())], { missingTool: 'rife-ncnn-vulkan' })[0]).toContain('RIFE');
    expect(footageNextSteps('separate-audio', form(), [src(audio)], { modelReason: '还没有模型' })).toEqual(['还没有模型']);
  });
});

describe('工作量', () => {
  it('抠像按实测每帧约 0.25 秒，IS-Net 慢约 4 倍；长素材提醒，选一段就不提醒', () => {
    const fast = workload('remove-background', form(), [src(video())], null);
    expect(fast.frames).toBe(1260);
    expect(fast.seconds[0]).toBeLessThanOrEqual(1260 * 0.25);
    expect(fast.seconds[1]).toBeGreaterThan(1260 * 0.25);
    const clean = workload('remove-background', form({ matteModel: 'general' }), [src(video())], null);
    expect(clean.seconds[0]).toBeGreaterThanOrEqual(fast.seconds[0] * 4 - 1);
    expect(fast.level).toBe('long');
    const long = video({ durationSec: 3120, frameRate: 25 });
    expect(workload('remove-background', form(), [src(long)], null).level).toBe('veryLong');
    expect(workload('remove-background', form({ ranged: true, start: 0, end: 10 }), [src(long)], null).level).toBe('ok');
  });
  it.each<[string, FootageToolId, Partial<FootageForm>, ToolInputFacts['width'], ToolInputFacts['height'], number, number, Stabilizer]>([
    ['超分 1080p 2× 视频', 'upscale-video', { scale: 2, model: 'video' }, 1920, 1080, 60, 13.5, null],
    ['超分 360p 2× 实拍', 'upscale-video', { scale: 2, model: 'photo' }, 640, 360, 30, 24.7, null],
    ['超分 360p 4× 动画', 'upscale-video', { scale: 4, model: 'anime' }, 640, 360, 30, 8.1, null],
    ['插帧 1080p 2× 提高帧率', 'interpolate-video', { factor: 2, mode: 'smooth' }, 1920, 1080, 60, 6.1, null],
    ['去抖 1080p deshake', 'stabilize-video', {}, 1920, 1080, 150, 2.6, 'deshake'],
    ['统一色调 1080p', 'match-color', {}, 1920, 1080, 150, 1.3, null],
    ['抠像 720p U²-Net', 'remove-background', { matteModel: 'fast' }, 1280, 720, 120, 31.9, null],
    ['抠像 720p IS-Net', 'remove-background', { matteModel: 'general' }, 1280, 720, 30, 33.3, null],
  ])('估算的范围包住实测：%s', (_name, tool, options, width, height, frames, measured, stabilizer) => {
    const clip = video({ width, height, frameRate: 30, durationSec: frames / 30 });
    const { seconds } = workload(tool, form(options), [src(clip)], stabilizer);
    expect(seconds[0]).toBeLessThanOrEqual(measured);
    expect(seconds[1]).toBeGreaterThanOrEqual(measured);
  });
  it('估算的范围包住实测：分轨 30 秒 HTDemucs-FT', () => {
    const { seconds } = workload('separate-audio', form(), [src({ ...audio, durationSec: 30 })], null, 'htdemucs-ft@mlx');
    expect(seconds[0]).toBeLessThanOrEqual(20);
    expect(seconds[1]).toBeGreaterThanOrEqual(22.2);
  });
  it('退回 deshake 比 vid.stab 少一遍，估得也短', () => {
    const deshake = workload('stabilize-video', form(), [src(video())], 'deshake');
    const vidstab = workload('stabilize-video', form(), [src(video())], 'vidstab');
    expect(deshake.seconds[1]).toBeLessThan(vidstab.seconds[1]);
  });
  it('分轨按素材时长算，多轨写的 WAV 多', () => {
    const two = workload('separate-audio', form(), [src(audio)], null, 'htdemucs-ft');
    expect(two.audioSeconds).toBe(214);
    expect(two.hasVideo).toBe(false);
    expect(workload('separate-audio', form({ stems: 'four' }), [src(audio)], null).outBytes).toBeGreaterThan(two.outBytes);
  });
  it('几句话接成一段：中文句号后面不留空格，别的留', () => {
    expect(sentences('第一句。', '第二句。')).toBe('第一句。第二句。');
    expect(sentences('One.', 'Two.')).toBe('One. Two.');
  });
  it('耗时的说法', () => {
    expect(etaText([300, 720])).toMatch(/5.*12/);
    // 1080p 2× 超分：快的电脑十几秒，慢的一分多钟
    expect(etaText([12, 75])).toBe(M.etaUnderMinutes(2));
    expect(etaText([30, 75])).toBe(M.etaMinutes(1, 2));
    expect(etaText([5400, 14400])).toMatch(/1\.5.*4/);
    expect(leftText(600)).toContain('10');
  });
});

describe('提交', () => {
  it('只带这种处理收的参数；Space 条目换成 entryId', () => {
    expect(footageRequest('stabilize-video', form({ strength: 'high' }), [src(video()), src(video(), 'space:e1')], '/out')).toEqual({ inputs: ['/a.mp4', { entryId: 'e1' }], outDir: '/out', strength: 'high' });
    expect(footageRequest('upscale-video', form({ scale: 3, model: 'photo', ranged: true, start: 1, end: 5 }), [src(video())], null)).toEqual({ inputs: ['/a.mp4'], start: 1, end: 5, scale: 3, model: 'photo' });
    expect(footageRequest('interpolate-video', form({ factor: 8, mode: 'smooth' }), [src(video())], null)).toEqual({ inputs: ['/a.mp4'], factor: 8, mode: 'smooth' });
    expect(footageRequest('match-color', form({ reference: 'space:r1', referenceAt: 3, amount: 0.8 }), [src(video())], null)).toEqual({ inputs: ['/a.mp4'], reference: { entryId: 'r1' }, referenceAt: 3, method: 'hm-mkl-hm', amount: 0.8 });
    expect(footageRequest('remove-background', form({ matteModel: 'general' }), [src(video())], null)).toEqual({ inputs: ['/a.mp4'], matteModel: 'general', temporal: 0.3 });
    expect(footageRequest('separate-audio', form({ stems: 'four', ranged: true }), [src(audio)], '/out', 'htdemucs-ft')).toEqual({ inputs: ['/s.mp3'], stems: 'four', model: 'htdemucs-ft', outDir: '/out' });
  });
  it('再做一次：照冻结的参数填回来，认不出的用缺省', () => {
    const job = { pipeline: { params: { inputs: ['/a.mp4', { entryId: 'x' }], start: 1, end: 5, factor: 8, mode: 'nope' } } } as unknown as JobRecord;
    expect(againFootage(job)).toMatchObject({ inputs: ['/a.mp4'], form: { ranged: true, start: 1, end: 5, factor: 8, mode: 'slowmo' } });
    expect(againFootage({ pipeline: undefined } as unknown as JobRecord)).toBeNull();
  });
});

describe('记录', () => {
  const job = (over: Partial<JobRecord>, pipeline: Record<string, unknown> = {}): JobRecord =>
    ({ jobId: 'j1', kind: 'pipeline', submitter: { kind: 'connection' }, createdAt: '2026-11-03T00:00:00Z', phase: 'running', progress: null, ...over, pipeline: { name: 'upscale-video', params: { inputs: ['/a/b.mp4'] }, steps: [], current: null, summary: null, ...pipeline } }) as unknown as JobRecord;
  it('只列这台电脑的界面提交的，去掉藏起来的', () => {
    const list = [job({}), job({ jobId: 'j2', submitter: { kind: 'agent' } as never }), job({ jobId: 'j3' }, { name: 'transcode' }), job({ jobId: 'j4' })];
    expect(footageJobs(list, ['j4']).map((j) => j.jobId)).toEqual(['j1']);
  });
  it('标题：第一个文件名，多个时说一共几个', () => {
    expect(recordTitle(job({}), '')).toBe('b.mp4');
    expect(recordTitle(job({}, { params: { inputs: ['/a/b.mp4', '/c.mp4', '/d.mp4'] } }), '')).toContain('b.mp4');
    expect(recordTitle(job({}, { params: { inputs: ['/a/b.mp4', '/c.mp4', '/d.mp4'] } }), '')).toContain('3');
  });
  it('进行中按子任务的帧数说做到哪，够久才说还要多久', () => {
    const child = { jobId: 'c1', progress: { done: 100, total: 400, unit: 'frames' }, startedAt: '2026-11-03T00:00:00.000Z', state: 'running' } as unknown as JobRecord;
    const parent = job({}, { steps: [{ name: 'process', label: '处理', jobId: 'c1', status: 'running' }], current: 0 });
    const at = (seconds: number) => Date.parse('2026-11-03T00:00:00.000Z') + seconds * 1000;
    expect(recordProgress(parent, [child], at(2)).text).not.toMatch(/分钟|min/);
    const later = recordProgress(parent, [child], at(600));
    expect(later.percent).toBe(25);
    expect(later.text).toMatch(/100 \/ 400/);
    expect(later.text).toMatch(/30/);
  });
  it('分轨一个文件时中途没有进度值：进度条不写 0%，有文件做完才有百分比', () => {
    const parent = job({}, { steps: [{ name: 'separate', label: '分离', jobId: 'c1', status: 'running' }], current: 0 });
    const child = (done: number, total: number) => ({ jobId: 'c1', progress: { done, total, unit: 'units' }, startedAt: '2026-11-03T00:00:00.000Z', state: 'running' }) as unknown as JobRecord;
    expect(recordProgress(parent, [child(0, 1)], 0).percent).toBeNull();
    expect(recordProgress(parent, [child(1, 4)], 0).percent).toBe(25);
  });
  it('摘要：引擎、提醒与不可商用', () => {
    const done = job({}, { params: { inputs: ['/a.mp4'], matteModel: 'general' }, summary: { executor: { engine: 'matte', tool: 'matte-models-isnet', version: 'v0.0.0', weights: 'isnet-general-use' }, warnings: ['x'] } });
    expect(recordSummary(done)).toEqual({ executor: 'matte · v0.0.0 · isnet-general-use', warnings: ['x'], nonCommercial: true });
    expect(recordSummary(job({}, { summary: { executor: { providerId: 'local', modelId: 'htdemucs-ft' } } })).executor).toBe('htdemucs-ft');
  });
});

describe('目录卡片', () => {
  const status = (over: Partial<ToolStatus>): ToolStatus => ({ problems: [], limitations: [], available: true, ...over }) as ToolStatus;
  it('第一次要下载的先说，装好了说就绪，只用 ffmpeg 的说不用下载', () => {
    expect(footageCardStatus('interpolate-video', status({ limitations: [{ code: 'TOOL_NOT_INSTALLED', message: '', tool: 'rife-ncnn-vulkan' }] }), null, null)).toMatchObject({ on: false, text: expect.stringContaining('RIFE') });
    expect(footageCardStatus('interpolate-video', status({}), null, null)).toMatchObject({ on: true, text: expect.stringContaining('RIFE') });
    expect(footageCardStatus('stabilize-video', status({}), null, null)?.on).toBe(true);
  });
  it('不能用时写原因；分轨缺的只是模型时不算不能用', () => {
    expect(footageCardStatus('stabilize-video', status({}), null, '没有 ffmpeg')).toEqual({ on: false, text: '没有 ffmpeg' });
    const noModel = status({ available: false, problems: [{ code: 'CAPABILITY_NOT_CONFIGURED', message: 'x', capability: 'separateAudio' }] });
    expect(footageCardStatus('separate-audio', noModel, null, 'x')?.text).not.toBe('x');
    expect(footageCardStatus('stabilize-video', status({}), null, undefined)).toBeNull();
  });
  it('六个工具都有', () => {
    expect(FOOTAGE_TOOL_IDS).toHaveLength(6);
  });
});
