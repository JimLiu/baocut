import fs from 'node:fs/promises';
import path from 'node:path';
import type { AsrResult } from '@baocut/models';
import type { GeneratedOutput } from '@baocut/protocol';
import { JobsDownloadTranscript } from '@baocut/protocol/messages/jobs/download-transcript.ts';
import { asLocalized } from '../job-text.ts';
import { PipelineStepError, type PipelineStepContext } from './pipeline.ts';
import type { PipelineTranscriber } from './video-create.ts';

/**
 * 文件的转录（架构设计 §7.9）：认回这次运行提交过的转写，重试发布不重复识别。
 *
 * 命名：`job`（从链接下载时）是 `<源文件名>-<运行 ID>.txt/.srt`；`source`（只给文件的转录）是 `<源文件名>.txt/.srt`，
 * 两个文件用同一个序号（`<源文件名>-2.txt` 与 `.srt`），找两者都空着、或已有的内容正是这一份（重试）的那个序号。
 */
export async function downloadTranscript(
  jobs: PipelineTranscriber,
  context: PipelineStepContext<unknown>,
  request: {
    file: string;
    directory: string;
    provider?: string;
    model?: string;
    language?: string;
    hint?: string;
    naming?: 'job' | 'source';
  },
): Promise<{ jobId: string; files: string[]; outputs: GeneratedOutput[]; language: string | null }> {
  if (!jobs.submitFile) throw new PipelineStepError('CAPABILITY_NOT_CONFIGURED', JobsDownloadTranscript.fileTranscribeUnavailable(), {});
  const { signal, parentJobId, artifacts } = context;
  signal.throwIfAborted();
  context.progress(null, 'transcribing');
  const previous = jobs.list?.().find((j) => j.kind === 'transcribe' && j.videoId === null &&
    j.submitter.kind === 'pipeline' && j.submitter.id === parentJobId && ['queued', 'running', 'completed'].includes(j.state));
  const submit = {
    file: request.file,
    ...(request.provider !== undefined ? { provider: request.provider } : {}),
    ...(request.model !== undefined ? { model: request.model } : {}),
    ...(request.language !== undefined ? { language: request.language } : {}),
    ...(request.hint !== undefined ? { hint: request.hint } : {}),
  };
  const { jobId } = previous ?? await jobs.submitFile(submit, { kind: 'pipeline', id: parentJobId });
  const abort = () => { void jobs.cancel(jobId).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) abort();
    const state = await jobs.settled(jobId);
    signal.throwIfAborted();
    if (state !== 'completed') {
      const error = jobs.inspect(jobId).error;
      throw new PipelineStepError(
        error?.code ?? 'TRANSCRIBE_FAILED',
        error ? asLocalized(error.message, error.messageRef) : JobsDownloadTranscript.notCompleted(),
        { cause: error?.details, jobId },
      );
    }
  } finally { signal.removeEventListener('abort', abort); }
  const artifactId = jobs.inspect(jobId).result?.artifactId;
  const bytes = artifactId ? await artifacts.read(artifactId) : null;
  if (!bytes) throw new PipelineStepError('TRANSCRIBE_RESULT_MISSING', JobsDownloadTranscript.resultMissing(), { jobId });
  const result = JSON.parse(bytes.toString('utf8')) as AsrResult;
  const content = transcriptText(result);
  await fs.mkdir(request.directory, { recursive: true });
  const stem = request.naming === 'source'
    ? await freeStem(request.directory, path.parse(request.file).name || 'transcript', content)
    : `${path.parse(request.file).name}-${parentJobId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const outputs: GeneratedOutput[] = [];
  for (const [ext, text] of Object.entries(content)) {
    signal.throwIfAborted();
    const file = path.join(request.directory, `${stem}.${ext}`);
    // Exclusive publication; retries accept only identical content, never overwrite a user's edit.
    try { await fs.writeFile(file, text, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await fs.readFile(file, 'utf8') !== text) throw error;
    }
    const stored = await artifacts.put(Buffer.from(text), ext as 'txt' | 'srt');
    outputs.push({ artifactId: stored.artifactId, path: file, mediaType: ext === 'srt' ? 'application/x-subrip' : 'text/plain', byteLength: Buffer.byteLength(text), assetId: null, media: { kind: 'text', entries: result.segments.length, durationSec: result.segments.reduce((end, segment) => Math.max(end, segment.end), 0) / result.timescale } });
  }
  return { jobId, files: outputs.map((o) => o.path!), outputs, language: result.language?.tag ?? null };
}

/** `source` 命名的序号：TXT 与 SRT 都空着，或已有的正是这一份内容（重试时认回）。 */
async function freeStem(directory: string, base: string, content: Record<string, string>): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const stem = n === 1 ? base : `${base}-${n}`;
    let usable = true;
    for (const [ext, text] of Object.entries(content)) {
      const existing = await fs.readFile(path.join(directory, `${stem}.${ext}`), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (existing !== null && existing !== text) {
        usable = false;
        break;
      }
    }
    if (usable) return stem;
  }
  throw new PipelineStepError('TRANSCRIBE_FAILED', JobsDownloadTranscript.tooManySameName({ name: base }), {});
}

export function transcriptText(result: Pick<AsrResult, 'segments' | 'timescale'>): { txt: string; srt: string } {
  const stamp = (ticks: number) => {
    const ms = Math.max(0, Math.round(ticks * 1000 / result.timescale));
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return {
    txt: result.segments.map((s) => s.text.trim()).join('\n') + '\n',
    srt: result.segments.map((s, i) => `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text.trim()}\n`).join('\n'),
  };
}
