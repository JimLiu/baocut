import fs from 'node:fs/promises';
import path from 'node:path';
import { applySpeakers, EditorWasmError, speakerProposal, type SpeakerProposal } from '@baocut/editor-wasm';
import { sha256File, type SpeakersFile, type WorkerFootprint } from '@baocut/models';
import { RpcError, type EditOperation, type Id, type ModelBundleStatus, type SpeakersParams, type SpeakersSummary } from '@baocut/protocol';
import { JobsSpeakers as J } from '@baocut/protocol/messages/jobs/speakers.ts';
import type { ArtifactStore } from '../artifact-store.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { withCause, type JobText } from '../job-text.ts';
import type { LocalDiarizeOutcome, LocalDiarizeRun } from '../local-provider.ts';
import { localTranscribeResources } from '../resource-profiles.ts';
import { providerStepError } from './dub-separator.ts';
import { ParamReader } from './params.ts';
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext, type StepResult } from './pipeline.ts';
import { pickSource, type PipelineVideos } from './translate.ts';
import { readArtifact } from './translation-batches.ts';

/**
 * 识别说话人（架构设计 §6.6；AI 工具「识别说话人」的后端）：给视频里已有的一份转写按声纹重新区分说话人，不重新转写。
 *
 * 1. 区分：本机的「说话人区分」模型包单独加载（Pyannote 分段 + WeSpeaker 声纹），整条音轨与转写的词时间交给 Model Worker
 *    （`job.run` 的 `diarize`，Model Worker 协议规范 §2.5.5），它把说话人投影到每个词上（`speakers.json`，存成产物）。
 * 2. 整理：词上的聚类按重叠时长复用已有的说话人（保留 ID 与名字，库里的音色绑定、配音的说话人绑定不断），复用不上的新建；
 *    同时试算一次应用，得出每位说话人的句数、试听片段与会重切的译文条数（字幕与翻译核心经 `@baocut/editor-wasm`）。提案存成
 *    产物，摘要给界面的确认页。
 *
 * 流程不改视频：用户在确认页确认（可以改名）后由 `edits.applySpeakers` 应用（`applySpeakerProposal`），一笔可撤销的编辑。
 */

export const SPEAKERS_PIPELINE = 'speakers';
/** 提案产物的格式。 */
export const SPEAKER_PROPOSAL_SCHEMA = 'baocut.speaker-proposal/1';

/** 冻结的参数：文稿与版本、素材、模型包与它的 Worker 估计都已确定。 */
export interface FrozenSpeakersParams extends SpeakersParams {
  documentId: Id;
  revision: string;
  assetId: Id;
  bundleId: string;
  footprint: WorkerFootprint | null;
}

/** 识别说话人读视频的能力：在翻译的基础上，多了素材的源文件。 */
export interface SpeakersVideos extends PipelineVideos {
  assetFile(videoId: Id, assetId: Id): Promise<{ file: string; revision: string } | null>;
}

export interface SpeakersDeps {
  videos: SpeakersVideos;
  /** 这台机器上的「说话人区分」模型包此刻的状态；没有登记时 null。 */
  pack(): Promise<ModelBundleStatus | null>;
  /** 它的 Model Worker 加载后约常驻多少（`ModelCatalog.workerFootprint`）。 */
  footprint(bundleId: string): Promise<WorkerFootprint | null>;
  diarizer: {
    diarize(
      run: LocalDiarizeRun,
      signal: AbortSignal,
      onProgress?: (done: number, total: number | null, phase: 'decoding' | 'diarizing' | 'finalizing') => void,
    ): Promise<LocalDiarizeOutcome>;
  };
}

/** 提案产物：应用时读它，核对文稿与译文还是识别时的版本。 */
export interface SpeakerProposalFile extends SpeakerProposal {
  schema: typeof SPEAKER_PROPOSAL_SCHEMA;
  videoId: Id;
  documentId: Id;
  revision: string;
  /** 参与试算的译文（`baocut.translation/2`）与它们的版本。 */
  translations: Array<{ documentId: Id; revision: string }>;
  skippedTranslations: number;
  timescale: number;
}

interface DiarizeOutput extends Record<string, unknown> {
  artifactId: string;
  speakers: number;
  diarizeMs: number;
}

interface ProposeOutput extends Record<string, unknown> {
  artifactId: string;
}

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    videoId: { type: 'string', description: '已打开的视频' },
    documentId: { type: 'string', description: '要区分说话人的 speech 文档；视频里只有一份时可以不给' },
    // i18n-ignore-end
  },
  required: ['videoId'],
  additionalProperties: false,
};

/** 本机模型包能不能用（装好、没停用、这台机器支持）。 */
function usable(status: ModelBundleStatus): boolean {
  return status.state === 'installed' || status.state === 'loading' || status.state === 'ready' || status.state === 'busy';
}

export function speakersPipeline(deps: SpeakersDeps): PipelineDefinition<FrozenSpeakersParams, SpeakersParams> {
  return {
    name: SPEAKERS_PIPELINE,
    label: () => J.label(),
    description: () => J.description(),
    paramsSchema: PARAMS_SCHEMA,
    parse(raw) {
      const reader = new ParamReader(raw, ['videoId', 'documentId']);
      const videoId = reader.string('videoId', { max: 128 })!;
      const documentId = reader.string('documentId', { optional: true, max: 128 });
      return { videoId, ...(documentId !== undefined ? { documentId } : {}) };
    },
    async prepare(params) {
      const state = deps.videos.state(params.videoId);
      if (!state) throw new RpcError('not-found', J.videoNotOpen());
      const documentId = pickSource(state.documents, params.documentId);
      const record = state.documents[documentId]!;
      if (!record.sourceAssetId) throw new RpcError('invalid-request', J.notFromAsset(), { documentId });
      const pack = await deps.pack();
      if (!pack) throw new RpcError('conflict', J.modelMissing(), { code: 'MODEL_UNAVAILABLE' });
      if (!usable(pack)) {
        throw new RpcError('conflict', J.modelNotInstalled(), { code: 'MODEL_UNAVAILABLE', bundle: pack });
      }
      // 重试照用冻结的文稿版本（应用时还要核对它）；第一次启动时取当前版本。
      const frozen = params as Partial<FrozenSpeakersParams>;
      const revision = frozen.revision ?? record.currentRevision;
      const next: FrozenSpeakersParams = {
        videoId: params.videoId,
        documentId,
        revision,
        assetId: record.sourceAssetId,
        bundleId: pack.bundleId,
        footprint: await deps.footprint(pack.bundleId),
      };
      return {
        params: next,
        providerId: 'local',
        modelId: pack.bundleId,
        videoId: params.videoId,
        contentHash: `sha256:${sha256Hex(canonicalJson({ videoId: params.videoId, documentId, revision }))}`,
      };
    },
    steps: [
      {
        name: 'diarize',
        label: () => J.stepDiarize(),
        // Worker 进程按模型包估计（同一个模型包的任务共用），这一步自己的是解出的音频。
        resources: (params) => localTranscribeResources(params.bundleId, params.footprint),
        run: (context) => diarize(deps, context),
        reusable: async (output, { artifacts }) => (await artifacts.locate((output as DiarizeOutput).artifactId)) !== null,
      },
      {
        name: 'propose',
        label: () => J.stepPropose(),
        run: (context) => propose(deps.videos, context),
        reusable: async (output, { artifacts }) => (await artifacts.locate((output as ProposeOutput).artifactId)) !== null,
      },
    ],
    async complete({ params, outputs, artifacts }) {
      const diarized = outputs.diarize as DiarizeOutput;
      const proposed = outputs.propose as ProposeOutput;
      const proposal = await readArtifact<SpeakerProposalFile>(artifacts, proposed.artifactId);
      const summary: SpeakersSummary = {
        videoId: params.videoId,
        source: { documentId: params.documentId, revision: params.revision },
        timescale: proposal.timescale,
        speakers: proposal.speakers,
        relabeled: proposal.relabeled,
        translationsSplit: proposal.translationsSplit,
        skippedTranslations: proposal.skippedTranslations,
        proposalArtifactId: proposed.artifactId,
        bundleId: params.bundleId,
        diarizeMs: diarized.diarizeMs,
      };
      return { summary: summary as unknown as Record<string, unknown>, result: { documentId: null, artifactId: proposed.artifactId } };
    },
  };
}

interface SpeechWordLike {
  id: string;
  start?: number;
  end?: number;
}

/** 文稿正文里的词与刻度；读不懂时 `PipelineStepError`。 */
function speechWords(body: unknown, documentId: Id): { words: SpeechWordLike[]; timescale: number } {
  const b = body as { schema?: unknown; timescale?: unknown; words?: unknown } | null;
  if (!b || b.schema !== 'baocut.speech/1' || !Array.isArray(b.words)) {
    throw new PipelineStepError('INPUT_UNREADABLE', J.transcriptUnreadable(), { documentId });
  }
  const timescale = typeof b.timescale === 'number' && b.timescale > 0 ? b.timescale : 1_000_000;
  return { words: b.words as SpeechWordLike[], timescale };
}

async function diarize(deps: SpeakersDeps, context: PipelineStepContext<FrozenSpeakersParams>): Promise<StepResult> {
  const { params, artifacts, progress, signal, jobId, staging } = context;
  progress(null, 'starting');
  const state = deps.videos.state(params.videoId);
  if (!state) throw new PipelineStepError('STALE_JOB_INPUT', J.videoClosed());
  if (!state.documents[params.documentId]) {
    throw new PipelineStepError('STALE_JOB_INPUT', J.transcriptGone(), { documentId: params.documentId });
  }
  const content = await deps.videos.document(params.videoId, params.documentId, params.revision);
  const { words, timescale } = speechWords(content.body, params.documentId);
  if (words.length === 0) throw new PipelineStepError('INPUT_UNREADABLE', J.noWords(), { documentId: params.documentId });
  const spans: Array<[number, number]> = [];
  for (const word of words) {
    if (!Number.isSafeInteger(word.start) || !Number.isSafeInteger(word.end)) {
      throw new PipelineStepError('INPUT_UNREADABLE', J.untimedWords(), { wordId: word.id });
    }
    spans.push([Math.max(0, word.start!), Math.max(0, word.start!, word.end!)]);
  }
  const source = await deps.videos.assetFile(params.videoId, params.assetId);
  const facts = deps.videos.asset?.(params.videoId, params.assetId) ?? null;
  if (!source) throw new PipelineStepError('INPUT_UNREADABLE', J.sourceMissing(), { assetId: params.assetId });
  const contentHash = facts?.contentHash ?? `sha256:${await sha256File(source.file).catch(() => '')}`;

  const dir = path.join(staging, 'diarize');
  await fs.mkdir(dir, { recursive: true });
  const started = Date.now();
  let outcome: LocalDiarizeOutcome;
  try {
    outcome = await deps.diarizer.diarize(
      {
        bundleId: params.bundleId,
        jobId,
        input: { file: source.file, contentHash, track: 0 },
        timescale,
        words: spans,
        staging: dir,
      },
      signal,
      (done, total, phase) => progress(total === null ? null : { done, total, unit: phase === 'decoding' ? 'seconds' : 'steps' }, phase),
    );
  } catch (error) {
    throw providerStepError(error);
  }
  if (outcome.outcome === 'cancelled') throw signal.reason ?? new DOMException('aborted', 'AbortError');
  progress(null, 'validating');
  const hex = await sha256File(outcome.file);
  if (hex !== outcome.sha256) throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.hashMismatch());
  const parsed = JSON.parse(await fs.readFile(outcome.file, 'utf8')) as SpeakersFile;
  if (parsed.schema !== 'baocut.speakers/v1' || !Array.isArray(parsed.words) || parsed.words.length !== words.length) {
    throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.wordCountMismatch(), {
      words: words.length,
      labels: Array.isArray(parsed.words) ? parsed.words.length : null,
    });
  }
  const stored = await artifacts.putFile(outcome.file, 'json');
  const output: DiarizeOutput = {
    artifactId: stored.artifactId,
    speakers: outcome.result.speakers,
    diarizeMs: outcome.result.stats.diarizeMs || Date.now() - started,
  };
  return { output, result: { documentId: null, artifactId: stored.artifactId } };
}

async function propose(videos: PipelineVideos, context: PipelineStepContext<FrozenSpeakersParams>): Promise<StepResult> {
  const { params, artifacts, outputs, progress } = context;
  progress(null, 'finalizing');
  const diarized = outputs.diarize as DiarizeOutput;
  const speakers = await readArtifact<SpeakersFile>(artifacts, diarized.artifactId);
  const content = await videos.document(params.videoId, params.documentId, params.revision);
  const { timescale } = speechWords(content.body, params.documentId);
  const state = videos.state(params.videoId);
  if (!state) throw new PipelineStepError('STALE_JOB_INPUT', J.videoClosed());
  const { bodies, refs, skipped } = await translationsOf(videos, params.videoId, state.documents, params.documentId);
  let proposal: SpeakerProposal;
  try {
    proposal = speakerProposal(content.body, bodies, speakers.words);
  } catch (error) {
    if (error instanceof EditorWasmError) {
      throw new PipelineStepError('INPUT_UNREADABLE', withCause(J.transcriptUnreadable(), error), {
        documentId: params.documentId,
        code: error.code,
      });
    }
    throw error;
  }
  const file: SpeakerProposalFile = {
    schema: SPEAKER_PROPOSAL_SCHEMA,
    videoId: params.videoId,
    documentId: params.documentId,
    revision: params.revision,
    translations: refs,
    skippedTranslations: skipped,
    timescale,
    ...proposal,
  };
  const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify(file)), 'json');
  return { output: { artifactId } satisfies ProposeOutput, result: { documentId: null, artifactId } };
}

/** 这份转写的译文（当前版本）：当前格式的参与重切，旧格式的跳过（只计数）。 */
export async function translationsOf(
  videos: Pick<PipelineVideos, 'document'>,
  videoId: Id,
  documents: Record<Id, { id: Id; kind: string; sourceDocumentId?: Id; currentRevision: string }>,
  documentId: Id,
): Promise<{ bodies: unknown[]; refs: Array<{ documentId: Id; revision: string }>; skipped: number }> {
  const bodies: unknown[] = [];
  const refs: Array<{ documentId: Id; revision: string }> = [];
  let skipped = 0;
  for (const record of Object.values(documents)) {
    if (record.kind !== 'translation' || record.sourceDocumentId !== documentId) continue;
    const content = await videos.document(videoId, record.id, record.currentRevision);
    if ((content.body as { schema?: unknown } | null)?.schema !== 'baocut.translation/2') {
      skipped += 1;
      continue;
    }
    bodies.push(content.body);
    refs.push({ documentId: record.id, revision: content.revision });
  }
  return { bodies, refs, skipped };
}

/** 读提案产物；不在了时 `ARTIFACT_NOT_FOUND`。 */
export function readSpeakerProposal(artifacts: ArtifactStore, artifactId: string): Promise<SpeakerProposalFile> {
  return readArtifact<SpeakerProposalFile>(artifacts, artifactId);
}

/** 应用识别说话人的事务标签（写进视频的编辑历史，按当前语言生成）。 */
export function speakersApplyLabel(): string {
  return J.label().text;
}

/** 名字的长度上限（与说话人改名的界面一致）。 */
const NAME_MAX = 100;

/**
 * 把提案变成一笔编辑事务的操作（`edits.applySpeakers`）：转写写新版本（词上的说话人、说话人表与名字、按新边界切开的句子），
 * 有变化的译文各写新版本（按新边界重切，不重译）；概要沿用原来的，更新说话人数。
 *
 * 文稿或参与试算的译文在识别之后改过（版本不同、译文增删）时以 `conflict`（`STALE_JOB_INPUT`）拒绝；`names` 里有提案之外的
 * 说话人或空名字时 `invalid-request`。
 */
export async function speakerApplyOperations(
  videos: Pick<PipelineVideos, 'state' | 'document'>,
  proposal: SpeakerProposalFile,
  names: Readonly<Record<Id, string>> = {},
): Promise<{ operations: EditOperation[]; label: string; speakerCount: number; translationsSplit: number }> {
  const state = videos.state(proposal.videoId);
  if (!state) throw new RpcError('not-found', J.videoNotOpen());
  const record = state.documents[proposal.documentId];
  const stale = (message: JobText, details: Record<string, unknown> = {}) =>
    new RpcError('conflict', message, { code: 'STALE_JOB_INPUT', documentId: proposal.documentId, ...details });
  if (!record) throw stale(J.transcriptGone());
  if (record.currentRevision !== proposal.revision) {
    throw stale(J.transcriptChanged(), { revision: proposal.revision, currentRevision: record.currentRevision });
  }
  const { bodies, refs } = await translationsOf(videos, proposal.videoId, state.documents, proposal.documentId);
  const key = (r: { documentId: Id; revision: string }) => `${r.documentId}@${r.revision}`;
  const was = new Set(proposal.translations.map(key));
  if (refs.length !== was.size || refs.some((r) => !was.has(key(r)))) throw stale(J.translationChanged());

  const known = new Map(proposal.speakers.map((s) => [s.id, s.name]));
  for (const [id, name] of Object.entries(names)) {
    if (!known.has(id)) throw new RpcError('invalid-request', J.unknownSpeaker(), { speakerId: id });
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > NAME_MAX) {
      throw new RpcError('invalid-request', J.nameInvalid({ max: NAME_MAX }), { speakerId: id });
    }
    known.set(id, trimmed);
  }
  const speech = await videos.document(proposal.videoId, proposal.documentId, proposal.revision);
  let applied;
  try {
    applied = applySpeakers(
      speech.body,
      bodies,
      proposal.wordSpeakers,
      [...known].map(([id, name]) => ({ id, name })),
    );
  } catch (error) {
    if (error instanceof EditorWasmError) throw new RpcError('invalid-request', withCause(J.applyFailed(), error), { code: error.code });
    throw error;
  }
  const summaryOf = (documentId: Id) => {
    const doc = state.documents[documentId]!;
    return doc.revisions[doc.currentRevision]?.summary;
  };
  const speakerCount = Array.isArray(applied.speech.speakers) ? applied.speech.speakers.length : known.size;
  const previous = summaryOf(proposal.documentId);
  const operations: EditOperation[] = [
    {
      type: 'putDocument',
      documentId: proposal.documentId,
      kind: record.kind,
      body: applied.speech,
      summary: previous && typeof previous === 'object' ? { ...(previous as Record<string, unknown>), speakerCount } : { speakerCount },
    },
  ];
  applied.translations.forEach((body, index) => {
    if (!body) return;
    const documentId = refs[index]!.documentId;
    // 概要里的单元数跟着重切更新（翻译写入时记的是 `unitCount`）。
    const previous = summaryOf(documentId);
    const units = Array.isArray(body.units) ? body.units.length : null;
    const summary =
      previous && typeof previous === 'object' && units !== null && 'unitCount' in previous ? { ...previous, unitCount: units } : previous;
    operations.push({
      type: 'putDocument',
      documentId,
      kind: state.documents[documentId]!.kind,
      body,
      ...(summary !== undefined ? { summary } : {}),
    });
  });
  return { operations, label: speakersApplyLabel(), speakerCount, translationsSplit: applied.translationsSplit };
}
