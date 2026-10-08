/**
 * 假的 Model Worker：一个 Node 脚本，按 Model Worker 协议规范说话（hello、load、unload、status、run、cancel，
 * `model.phase` / `job.phase` / `job.progress` / `job.segment` / `job.language` / `job.warning` 事件，
 * staging 里的 `segments.jsonl` 与 `result.json`）。测试不需要真实的 Rust Worker。
 *
 * 用法：`node fake-model-worker.ts [--control <file>] --parent-pid <pid>`
 *
 * 故障注入：模型包 ID 里 `#` 之后用逗号分隔的标记，或者控制文件 `{ "faults": [...], "transcript": "..." }`
 * （控制文件在每次 `model.load` / `job.run` 时重新读取）：
 *
 * - `crash-on-run`：第一段之后 `process.exit(70)`；
 * - `crash-once`：只在 `runGeneration === 1` 时这样崩溃（Runtime 的自动重试用 2，所以第二次成功）；
 * - `hang-on-cancel`：收到 `job.cancel` 照常确认，但任务再也不返回（Runtime 要在期限后结束进程）；
 * - `slow`：20 段，每 300 ms 一段；
 * - `slow-load`：`model.load` 要 1 秒；
 * - `invalid-output`：第二段的 start 早于第一段的 end（违反单调）；
 * - `load-fail:<code>`：`model.load` 返回这个错误码；
 * - `run-error:<code>`：`job.run` 返回这个错误码（`WORKER_PANIC` 之后进程退出，与规范一致）；
 * - `no-speech`：`outcome: 'no-speech'`，没有分段。
 *
 * 说话人区分（`options.diarize`）：模型包带 `segmentation` 与 `speaker` 组件（装了「说话人区分」模型包）时，识别之后进
 * `diarizing` 阶段，单数段是 `spk-1`、双数段是 `spk-2`（段与词都标；流式的段不带）；不带这两个组件时报
 * `diarization-unavailable` 警告。
 *
 * 本地语音合成（`job.run` 的 `capability: 'synthesize'`）：控制文件的 `capabilities` 含 `synthesize` 时 `worker.hello`
 * 才报告它（默认只报告 `transcribe`），这时 `synthesizeFamilies` 默认列出全部合成 family，控制文件的 `synthesizeFamilies`
 * 可以收窄。识别同样：`capabilities`（默认 `['transcribe']`）含 `transcribe` 时 `transcribeFamilies` 默认列出全部识别 family，
 * 控制文件的 `transcribeFamilies` 可以收窄。合成写一段 1 秒的 24 kHz 单声道 WAV（440 Hz 正弦），故障标记 `silent-output` 写全零的静音，`slow` 每步 200 ms；
 * 控制文件的 `readingsDropped` 原样放进结果；`record` 给出时，每次 `job.run` 的参数追加一行到那个文件。
 *
 * 人声分离（`capability: 'separate'`）：`capabilities` 含 `separate` 时报告它，`separateFamilies` 默认 `['htdemucs-ft']`。
 * 分离按 `options.sampleRate`（null 为 44100）写 16-bit 立体声 `vocals.wav`（440 Hz）与 `background.wav`（110 Hz，
 * 比人声低 12 dB），长度是控制文件的 `separateSeconds`，没有时输入是 WAV 就取它的时长，否则 1 秒；4 步进度；输入不存在时
 * `INPUT_UNREADABLE`，`slow` 每步 200 ms，`silent-output` 时人声是静音。
 *
 * 已有转写的说话人区分（`capability: 'diarize'`）：`capabilities` 含 `diarize` 时报告它。前一半的词是 `spk-1`、后一半是
 * `spk-2`（只有一个词时只有 `spk-1`），写 staging 里的 `speakers.json`；2 步进度，输入不存在时 `INPUT_UNREADABLE`，`slow` 每步 200 ms。
 *
 * 本地文生图（`capability: 'image'`）：控制文件的 `capabilities` 含 `image` 时 `worker.hello` 才报告它，`imageFamilies`
 * 默认列出全部文生图 family，控制文件的 `imageFamilies` 可以收窄。生图按请求的宽高写一张渐变的 RGB PNG，故障标记
 * `flat-output` 写一整片纯色，`slow` 每步 200 ms。
 *
 * 本文件不引用仓库里的任何包：它作为独立脚本运行。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

const WORKER_VERSION = '0.0.0-fake';
const DEFAULT_TRANSCRIPT = 'testing one two three baocut is ready';
const TRANSCRIBE_FAMILIES = ['qwen3-asr', 'whisper-mlx', 'whisper-coreml', 'whisper-ggml', 'moss-transcribe-diarize'];
const SYNTHESIZE_FAMILIES = ['qwen3-tts', 'indextts2', 'indextts2.5', 'gpt-sovits', 'voxcpm2', 'omnivoice'];
const SEPARATE_FAMILIES = ['htdemucs-ft'];
const IMAGE_FAMILIES = ['qwen-image'];

interface Request {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface Control {
  faults?: string[];
  transcript?: string;
  capabilities?: string[];
  transcribeFamilies?: string[];
  synthesizeFamilies?: string[];
  separateFamilies?: string[];
  separateSeconds?: number;
  imageFamilies?: string[];
  readingsDropped?: unknown[];
  record?: string;
}

interface Bundle {
  bundleId: string;
  backend: string;
  device: string;
  components: Record<string, { family: string; revision: string }>;
}

interface RunningJob {
  jobId: string;
  phase: string;
  startedAt: string;
  cancelled: boolean;
}

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const controlFile = argValue('--control');
const parentPid = Number(argValue('--parent-pid') ?? process.ppid);

let state: 'empty' | 'loading' | 'ready' | 'busy' | 'unloading' = 'empty';
let bundle: Bundle | null = null;
let job: RunningJob | null = null;

const send = (message: unknown): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};
const respond = (id: number, result: unknown) => send({ id, result });
const fail = (id: number, code: string, message: string, retryable = false, details?: unknown) =>
  send({ id, error: { code, message, retryable, ...(details !== undefined ? { details } : {}) } });
const emit = (event: string, params: unknown) => send({ event, params });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function control(): Control {
  if (!controlFile) return {};
  try {
    return JSON.parse(fs.readFileSync(controlFile, 'utf8')) as Control;
  } catch {
    return {};
  }
}

function faults(): string[] {
  const fromId = bundle?.bundleId.includes('#') ? bundle.bundleId.slice(bundle.bundleId.indexOf('#') + 1).split(',') : [];
  return [...fromId, ...(control().faults ?? [])].filter(Boolean);
}

function fault(name: string): boolean {
  return faults().includes(name);
}

function faultArg(prefix: string): string | null {
  const found = faults().find((f) => f.startsWith(`${prefix}:`));
  return found ? found.slice(prefix.length + 1) : null;
}

// ---- 看护：stdin 关闭或父进程不在就退出（协议规范 §1） ----

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let request: Request;
  try {
    request = JSON.parse(line) as Request;
  } catch {
    process.stderr.write('fake-model-worker: 无法解析的请求行\n');
    process.exit(2);
  }
  void handle(request);
});
lines.on('close', () => process.exit(0));
setInterval(() => {
  if (process.ppid !== parentPid) process.exit(0);
}, 2000).unref();
process.stderr.write(`fake-model-worker ${WORKER_VERSION} pid ${process.pid}\n`);

async function handle(request: Request): Promise<void> {
  const { id, method, params } = request;
  switch (method) {
    case 'worker.hello':
      if (params.contractVersion !== 1) return fail(id, 'CONTRACT_MISMATCH', '合同版本不符');
      return respond(id, {
        workerVersion: WORKER_VERSION,
        contractVersion: 1,
        pid: process.pid,
        backends: [
          { id: 'mlx', available: true, devices: ['metal'] },
          { id: 'candle', available: true, devices: ['cpu'] },
          { id: 'ggml', available: true, devices: ['cpu'] },
        ],
        capabilities: control().capabilities ?? ['transcribe'],
        transcribeFamilies: (control().capabilities ?? ['transcribe']).includes('transcribe')
          ? (control().transcribeFamilies ?? TRANSCRIBE_FAMILIES)
          : [],
        synthesizeFamilies: (control().capabilities ?? []).includes('synthesize')
          ? (control().synthesizeFamilies ?? SYNTHESIZE_FAMILIES)
          : [],
        separateFamilies: (control().capabilities ?? []).includes('separate') ? (control().separateFamilies ?? SEPARATE_FAMILIES) : [],
        imageFamilies: (control().capabilities ?? []).includes('image') ? (control().imageFamilies ?? IMAGE_FAMILIES) : [],
      });
    case 'model.load': {
      if (state !== 'empty') return fail(id, 'ALREADY_LOADED', '已经加载了一个模型包');
      const next = params.bundle as Bundle | undefined;
      if (!next || typeof next.bundleId !== 'string') return fail(id, 'INVALID_PARAMS', '缺少 bundle');
      bundle = next;
      const loadFailure = faultArg('load-fail');
      if (loadFailure) {
        bundle = null;
        return fail(id, loadFailure, '模拟的加载失败', false, { file: 'model.safetensors' });
      }
      state = 'loading';
      emit('model.phase', { phase: 'loading-weights' });
      if (fault('slow-load')) await sleep(1000);
      emit('model.phase', { phase: 'warming-up' });
      state = 'ready';
      return respond(id, { loaded: true, residentBytes: null, warmupMs: 1 });
    }
    case 'model.unload':
      state = 'empty';
      bundle = null;
      return respond(id, { unloaded: true });
    case 'worker.status':
      return respond(id, {
        state,
        bundleId: bundle?.bundleId ?? null,
        job: job ? { jobId: job.jobId, phase: job.phase, startedAt: job.startedAt } : null,
        memory: null,
      });
    case 'job.run': {
      if (state !== 'ready') return fail(id, 'WORKER_BUSY', `Worker 状态是 ${state}`);
      const record = control().record;
      if (record) fs.appendFileSync(record, `${JSON.stringify(params)}\n`);
      if (params.capability === 'separate') return separate(id, params);
      if (params.capability === 'image') return image(id, params);
      if (params.capability === 'diarize') return diarize(id, params);
      return params.capability === 'synthesize' ? synthesize(id, params) : run(id, params);
    }
    case 'job.cancel':
      if (!job || job.jobId !== params.jobId) return fail(id, 'NOT_FOUND', '没有这个任务');
      job.cancelled = true;
      return respond(id, { acknowledged: true });
    default:
      return fail(id, 'UNKNOWN_METHOD', `未知方法 ${method}`);
  }
}

interface FakeWord {
  start: number;
  end: number;
  text: string;
  confidence: number | null;
  timingQuality: 'estimated';
  speakerId?: string;
}

async function run(id: number, params: Record<string, unknown>): Promise<void> {
  const jobId = String(params.jobId);
  const runGeneration = Number(params.runGeneration);
  const staging = String(params.staging);
  const input = params.input as { contentHash: string };
  const options = params.options as {
    language: { mode: 'assert'; tag: string } | { mode: 'prefer'; tag: string | null };
    diarize: boolean;
    timescale: number;
  };
  const current: RunningJob = { jobId, phase: 'decoding', startedAt: new Date().toISOString(), cancelled: false };
  job = current;
  state = 'busy';
  const finish = (result: unknown) => {
    job = null;
    state = 'ready';
    respond(id, result);
  };

  const runError = faultArg('run-error');
  if (runError) {
    job = null;
    state = 'ready';
    fail(id, runError, '模拟的推理失败', true);
    if (runError === 'WORKER_PANIC') process.exit(101);
    return;
  }

  const timescale = options.timescale;
  const segmentsFile = path.join(staging, 'segments.jsonl');
  fs.writeFileSync(
    segmentsFile,
    `${JSON.stringify({ header: true, jobId, contentHash: input.contentHash, bundleId: bundle!.bundleId, workerVersion: WORKER_VERSION, timescale })}\n`,
  );
  const phase = (name: string) => {
    current.phase = name;
    emit('job.phase', { jobId, phase: name });
  };
  phase('decoding');
  phase('vad');

  const language =
    options.language.mode === 'assert'
      ? { tag: options.language.tag, source: 'asserted' as const, confidence: null }
      : { tag: options.language.tag ?? 'en', source: 'detected' as const, confidence: 0.87 };
  if (language.source === 'detected') emit('job.language', { jobId, tag: language.tag, confidence: language.confidence });
  const warnings: Array<{ code: string; segmentId?: string; detail?: string }> = [];
  const diarizes = options.diarize && bundle!.components.segmentation !== undefined && bundle!.components.speaker !== undefined;
  if (options.diarize && !diarizes) {
    const warning = { code: 'diarization-unavailable' };
    warnings.push(warning);
    emit('job.warning', { jobId, warning });
  }

  const slow = fault('slow');
  const noSpeech = fault('no-speech');
  const words = (control().transcript ?? DEFAULT_TRANSCRIPT).split(/\s+/).filter(Boolean);
  const groups: string[][] = [];
  if (!noSpeech) {
    if (slow) for (let i = 0; i < 20; i++) groups.push([words[i % words.length]!]);
    else for (let i = 0; i < words.length; i += 3) groups.push(words.slice(i, i + 3));
  }

  const tick = (seconds: number) => Math.round(seconds * timescale);
  const segments: Array<{ id: string; start: number; end: number; text: string; speakerId: string | null; words: FakeWord[] }> = [];
  let cursor = 0;
  phase('transcribing');
  for (const [index, group] of groups.entries()) {
    if (current.cancelled) break;
    await sleep(slow ? 300 : 5);
    if (current.cancelled) break;
    const segmentWords: FakeWord[] = group.map((text, i) => ({
      start: cursor + tick(i * 0.5),
      end: cursor + tick(i * 0.5 + 0.4),
      text,
      confidence: null,
      timingQuality: 'estimated',
    }));
    const start = cursor;
    const end = segmentWords[segmentWords.length - 1]!.end;
    const segment = {
      id: `seg-${String(index + 1).padStart(4, '0')}`,
      start,
      end,
      text: group.join(' '),
      speakerId: null as string | null,
      words: segmentWords,
    };
    if (fault('invalid-output') && index === 1) {
      // 第二段从第一段中间开始：违反「递增且不重叠」。
      const shift = segment.start - Math.floor(segments[0]!.end / 2);
      segment.start -= shift;
      segment.words = segment.words.map((w) => ({ ...w, start: w.start - shift, end: w.end - shift }));
      segment.end -= shift;
    }
    segments.push(segment);
    cursor = end + tick(0.2);
    fs.appendFileSync(segmentsFile, `${JSON.stringify(segment)}\n`);
    emit('job.segment', { jobId, segment });
    emit('job.progress', { jobId, phase: 'transcribing', done: index + 1, total: groups.length, unit: 'segments' });
    if (fault('crash-on-run') || (fault('crash-once') && runGeneration === 1)) {
      process.stderr.write('fake-model-worker: 模拟崩溃（推理途中退出）\n');
      process.exit(70);
    }
  }

  if (current.cancelled) {
    // hang-on-cancel：确认过取消，但再也不返回。
    if (fault('hang-on-cancel')) return;
    return finish({ outcome: 'cancelled', output: null, segmentsFile, stats: stats(0) });
  }

  const speakers: Array<{ id: string; label: null }> = [];
  if (diarizes && segments.length > 0) {
    phase('diarizing');
    for (const [index, segment] of segments.entries()) {
      const speakerId = `spk-${(index % 2) + 1}`;
      segment.speakerId = speakerId;
      segment.words = segment.words.map((w) => ({ ...w, speakerId }));
    }
    speakers.push(...['spk-1', 'spk-2'].slice(0, Math.min(2, segments.length)).map((id) => ({ id, label: null })));
  }

  phase('finalizing');
  const duration = cursor + tick(0.5);
  const components = bundle!.components;
  const result = {
    schema: 'baocut.asr-result/v1',
    outcome: noSpeech ? 'no-speech' : 'transcribed',
    timescale,
    clock: 'source-asset',
    duration,
    language: noSpeech ? { tag: null, source: 'unknown', confidence: null } : language,
    segments,
    speakers,
    coverage: [{ start: 0, end: duration }],
    warnings,
    provenance: {
      provider: 'local',
      bundleId: bundle!.bundleId,
      models: Object.fromEntries(Object.entries(components).map(([k, c]) => [k, { family: c.family, revision: c.revision }])),
      backend: bundle!.backend,
      device: bundle!.device,
      workerVersion: WORKER_VERSION,
      // `job.run` 不携带输入 hash（协议规范 §2.5），Worker 无从回填。
      inputHash: '',
      runGeneration,
    },
  };
  const bytes = Buffer.from(JSON.stringify(result));
  const output = path.join(staging, 'result.json');
  fs.writeFileSync(`${output}.tmp`, bytes);
  fs.renameSync(`${output}.tmp`, output);
  finish({
    outcome: 'completed',
    output: { path: output, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    segmentsFile,
    stats: stats(duration / timescale),
  });
}

/** 合成：参考录音（有时）→ 4 步合成（`job.progress` 的 `steps`）→ 编码，写 staging 里的 `speech.wav`。 */
async function synthesize(id: number, params: Record<string, unknown>): Promise<void> {
  const jobId = String(params.jobId);
  const staging = String(params.staging);
  const input = params.input as { file: string } | null;
  const current: RunningJob = { jobId, phase: 'synthesizing', startedAt: new Date().toISOString(), cancelled: false };
  job = current;
  state = 'busy';
  const finish = (result: unknown) => {
    job = null;
    state = 'ready';
    respond(id, result);
  };
  const runError = faultArg('run-error');
  if (runError) {
    job = null;
    state = 'ready';
    return fail(id, runError, '模拟的合成失败', runError === 'INFERENCE_FAILED');
  }
  const phase = (name: string) => {
    current.phase = name;
    emit('job.phase', { jobId, phase: name });
  };
  if (input) {
    phase('preparing-reference');
    if (!fs.existsSync(input.file)) {
      job = null;
      state = 'ready';
      return fail(id, 'INPUT_UNREADABLE', '参考录音读不出来');
    }
  }
  phase('synthesizing');
  const steps = 4;
  for (let step = 1; step <= steps; step++) {
    await sleep(fault('slow') ? 200 : 2);
    if (current.cancelled) {
      if (fault('hang-on-cancel')) return;
      return finish({
        outcome: 'cancelled',
        output: null,
        audio: null,
        stats: { referenceMs: 0, synthesisMs: 0, encodeMs: 0 },
        readingsDropped: [],
      });
    }
    emit('job.progress', { jobId, phase: 'synthesizing', done: step, total: steps, unit: 'steps' });
  }
  phase('encoding');
  const sampleRate = 24_000;
  const samples = sampleRate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(samples * 2, 40);
  if (!fault('silent-output')) {
    for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8_000), 44 + i * 2);
  }
  const output = path.join(staging, 'speech.wav');
  fs.writeFileSync(`${output}.tmp`, bytes);
  fs.renameSync(`${output}.tmp`, output);
  finish({
    outcome: 'completed',
    output: { path: output, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    audio: { sampleRate, channels: 1, durationSec: 1 },
    stats: { referenceMs: input ? 1 : 0, synthesisMs: steps, encodeMs: 1 },
    readingsDropped: control().readingsDropped ?? [],
  });
}

/** 16-bit PCM WAV：`frames` 帧、`channels` 声道，样本由 `sample(i)` 给出（各声道相同）。 */
function pcmWav(sampleRate: number, channels: number, frames: number, sample: (i: number) => number): Buffer {
  const dataBytes = frames * channels * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(sample(i));
    for (let c = 0; c < channels; c++) bytes.writeInt16LE(v, 44 + (i * channels + c) * 2);
  }
  return bytes;
}

/** WAV 文件的时长（秒）；不是 WAV 或读不了时 null。 */
function wavSeconds(file: string): number | null {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return null;
  }
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null;
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = bytes.readUInt32LE(offset + 16);
    else if (id === 'data') return byteRate > 0 ? Math.min(size, bytes.length - offset - 8) / byteRate : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** 分离：解码 → 4 步分离（`steps`）→ 编码，写 staging 里的 `vocals.wav` 与 `background.wav`。 */
async function separate(id: number, params: Record<string, unknown>): Promise<void> {
  const jobId = String(params.jobId);
  const staging = String(params.staging);
  const input = params.input as { file: string };
  const sampleRate = (params.options as { sampleRate: number | null }).sampleRate ?? 44_100;
  const current: RunningJob = { jobId, phase: 'decoding', startedAt: new Date().toISOString(), cancelled: false };
  job = current;
  state = 'busy';
  const done = () => {
    job = null;
    state = 'ready';
  };
  const runError = faultArg('run-error');
  if (runError) {
    done();
    return fail(id, runError, '模拟的分离失败', runError === 'INFERENCE_FAILED');
  }
  const phase = (name: string) => {
    current.phase = name;
    emit('job.phase', { jobId, phase: name });
  };
  phase('decoding');
  if (!fs.existsSync(input.file)) {
    done();
    return fail(id, 'INPUT_UNREADABLE', '素材读不出来', false, { reason: 'unreadable' });
  }
  phase('separating');
  const steps = 4;
  emit('job.progress', { jobId, phase: 'separating', done: 0, total: steps, unit: 'steps' });
  for (let step = 1; step <= steps; step++) {
    await sleep(fault('slow') ? 200 : 2);
    if (current.cancelled) {
      if (fault('hang-on-cancel')) return;
      done();
      return respond(id, { outcome: 'cancelled', stems: null, audio: null, stats: { decodeMs: 1, separationMs: 0, encodeMs: 0 } });
    }
    emit('job.progress', { jobId, phase: 'separating', done: step, total: steps, unit: 'steps' });
  }
  phase('encoding');
  const seconds = control().separateSeconds ?? wavSeconds(input.file) ?? 1;
  const frames = Math.round(seconds * sampleRate);
  const stems: Record<string, { path: string; sha256: string; byteLength: number }> = {};
  for (const [name, freq, amplitude] of [
    ['vocals', 440, fault('silent-output') ? 0 : 6_000],
    ['background', 110, 1_500],
  ] as const) {
    const bytes = pcmWav(sampleRate, 2, frames, (i) => Math.sin((2 * Math.PI * freq * i) / sampleRate) * amplitude);
    const file = path.join(staging, `${name}.wav`);
    fs.writeFileSync(`${file}.tmp`, bytes);
    fs.renameSync(`${file}.tmp`, file);
    stems[name] = { path: file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length };
  }
  done();
  respond(id, {
    outcome: 'completed',
    stems,
    audio: { sampleRate, channels: 2, durationSec: frames / sampleRate },
    stats: { decodeMs: 1, separationMs: steps, encodeMs: 1 },
  });
}

/** 说话人区分：解码 → 2 步区分 → 整理，写 staging 里的 `speakers.json`（`baocut.speakers/v1`）。 */
async function diarize(id: number, params: Record<string, unknown>): Promise<void> {
  const jobId = String(params.jobId);
  const staging = String(params.staging);
  const input = params.input as { file: string };
  const options = params.options as { timescale: number; words: Array<[number, number]> };
  const current: RunningJob = { jobId, phase: 'decoding', startedAt: new Date().toISOString(), cancelled: false };
  job = current;
  state = 'busy';
  const done = () => {
    job = null;
    state = 'ready';
  };
  const phase = (name: string) => {
    current.phase = name;
    emit('job.phase', { jobId, phase: name });
  };
  phase('decoding');
  if (!fs.existsSync(input.file)) {
    done();
    return fail(id, 'INPUT_UNREADABLE', '素材读不出来', false, { reason: 'unreadable' });
  }
  phase('diarizing');
  for (let step = 1; step <= 2; step++) {
    await sleep(fault('slow') ? 200 : 2);
    if (current.cancelled) {
      done();
      return respond(id, { outcome: 'cancelled', output: null, speakers: 0, stats: { decodeMs: 1, diarizeMs: 0 } });
    }
    emit('job.progress', { jobId, phase: 'diarizing', done: step, total: 2, unit: 'steps' });
  }
  phase('finalizing');
  const half = Math.ceil(options.words.length / 2);
  const words = options.words.map((_, i) => (i < half ? 'spk-1' : 'spk-2'));
  const ids = [...new Set(words)];
  const body = {
    schema: 'baocut.speakers/v1',
    clock: 'source-asset',
    timescale: options.timescale,
    speakers: ids.map((sid) => ({ id: sid, words: words.filter((w) => w === sid).length, seconds: 1 })),
    ranges: [],
    words,
    provenance: { workerVersion: WORKER_VERSION },
  };
  const bytes = Buffer.from(JSON.stringify(body));
  const file = path.join(staging, 'speakers.json');
  fs.writeFileSync(file, bytes);
  done();
  respond(id, {
    outcome: 'completed',
    output: { path: file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    speakers: ids.length,
    stats: { decodeMs: 1, diarizeMs: 2 },
  });
}

/** 生图：编码提示词 → 去噪（`job.progress` 的 `steps`，从 0 开始）→ 解码，写 staging 里的 `image.png`。 */
async function image(id: number, params: Record<string, unknown>): Promise<void> {
  const jobId = String(params.jobId);
  const staging = String(params.staging);
  const options = params.options as { width: number; height: number; steps: number | null; seed: number };
  const current: RunningJob = { jobId, phase: 'encoding-prompt', startedAt: new Date().toISOString(), cancelled: false };
  job = current;
  state = 'busy';
  const finish = (result: unknown) => {
    job = null;
    state = 'ready';
    respond(id, result);
  };
  const runError = faultArg('run-error');
  if (runError) {
    job = null;
    state = 'ready';
    return fail(id, runError, '模拟的生图失败', runError === 'INFERENCE_FAILED');
  }
  const phase = (name: string) => {
    current.phase = name;
    emit('job.phase', { jobId, phase: name });
  };
  phase('encoding-prompt');
  phase('denoising');
  const steps = options.steps ?? 20;
  emit('job.progress', { jobId, phase: 'denoising', done: 0, total: steps, unit: 'steps' });
  for (let step = 1; step <= steps; step++) {
    await sleep(fault('slow') ? 200 : 1);
    if (current.cancelled) {
      if (fault('hang-on-cancel')) return;
      return finish({ outcome: 'cancelled', output: null, image: null, stats: { generationMs: 0, encodeMs: 0 } });
    }
    emit('job.progress', { jobId, phase: 'denoising', done: step, total: steps, unit: 'steps' });
  }
  phase('decoding');
  const bytes = fakePng(options.width, options.height, fault('flat-output'));
  const output = path.join(staging, 'image.png');
  fs.writeFileSync(`${output}.tmp`, bytes);
  fs.renameSync(`${output}.tmp`, output);
  finish({
    outcome: 'completed',
    output: { path: output, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    image: { width: options.width, height: options.height, format: 'png', seed: options.seed, steps },
    stats: { generationMs: steps, encodeMs: 1 },
  });
}

/** 一张 8 位 RGB PNG：横竖两个方向的渐变；`flat` 时一整片灰。 */
function fakePng(width: number, height: number, flat: boolean): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const at = row + 1 + x * 3;
      raw[at] = flat ? 128 : (x * 255) / Math.max(1, width - 1);
      raw[at + 1] = flat ? 128 : (y * 255) / Math.max(1, height - 1);
      raw[at + 2] = 128;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function stats(speechSeconds: number) {
  return { decodeMs: 1, vadMs: 1, asrMs: 1, alignMs: 0, speechSeconds };
}
