import type { GlossaryCandidatesResult, Id, RetakeCandidatesResult, SemanticReason } from '@baocut/protocol';
import type { RpcHandlers } from '../handlers.ts';
import { RcCommon } from '@baocut/protocol/messages/runtime-core';
import { RpcError } from '@baocut/protocol';
import type { LibraryService } from '../library/library-service.ts';
import type { SemanticServices } from '../space/semantic/services.ts';
import { viewerOf } from '../space/space-methods.ts';
import { USER_VIEWER } from '../space/space-queries.ts';
import type { VideoService } from '../videos/video-service.ts';
import { pickTranscript } from './ai-tool-pipeline.ts';
import { glossaryCandidates, type GlossaryTerm } from './glossary-candidates.ts';
import { retakeCandidates } from './retake-candidates.ts';
import { sentenceMapOf, timelineWords } from './timeline-sentences.ts';
import { topicBoundaries, type TopicBoundaries } from './topic-boundaries.ts';
import type { BoundaryOptions } from './chapter-boundaries.ts';

/**
 * 编辑辅助的只读方法（创作辅助集成设计 §2.5、§2.7、§3.7、§3.8）：`edits.glossaryCandidates` 与 `edits.retakeCandidates` 只给
 * 候选，不改视频。确认后由界面提交普通编辑：术语改法是一笔 `updateWords`，重录是一笔 `addCuts`，与其他编辑同样撤销。
 *
 * 网关方法只给用户本人（`viewerOf`）：术语候选读用户的库，对外服务不读库（架构设计 §5.9）。会话里的智能体经工具
 * `speech_retakes` / `speech_glossary_candidates`（`agent-tools/edit-aid-tools.ts`）用同一份实现。语义比较用本机对称编码，向量不落盘；
 * 没装模型或编码失败时退回字面，原因写在结果里。
 */
export interface EditAidDeps {
  videos: VideoService;
  library: LibraryService;
  semantic: () => SemanticServices | null;
}

type EditAidMethod = 'edits.glossaryCandidates' | 'edits.retakeCandidates';

export function editAidMethods(deps: EditAidDeps): Pick<RpcHandlers['methods'], EditAidMethod> {
  return {
    'edits.glossaryCandidates': async (p, principal): Promise<GlossaryCandidatesResult> => {
      viewerOf(principal);
      return glossaryCandidatesOf(deps, p.videoId, p.documentId);
    },
    'edits.retakeCandidates': async (p, principal): Promise<RetakeCandidatesResult> => {
      viewerOf(principal);
      return retakeCandidatesOf(deps, p.videoId, p.documentId);
    },
  };
}

/** 一部已打开视频的术语候选：调用方已经核过主体能用这部视频。 */
export async function glossaryCandidatesOf(deps: EditAidDeps, videoId: Id, requested?: Id): Promise<GlossaryCandidatesResult> {
  const { documentId, words } = await transcript(deps, videoId, requested);
  const { ids } = await deps.library.enabledGlossaries(videoId, 'transcribe');
  const terms: GlossaryTerm[] = [];
  for (const id of ids) {
    const content = deps.library.store.get({ library: 'glossaries', id }).content;
    if (content.kind !== 'transcription') continue;
    for (const term of content.terms) terms.push({ glossaryId: id, glossaryName: content.name, canonical: term.canonical, misheard: term.misheard });
  }
  const result = await glossaryCandidates({ words, terms, ...symmetric(deps) });
  return { documentId, glossaries: ids.length, ...result };
}

/** 一部已打开视频的重录候选：调用方已经核过主体能用这部视频。 */
export async function retakeCandidatesOf(deps: EditAidDeps, videoId: Id, requested?: Id): Promise<RetakeCandidatesResult> {
  const { documentId, words } = await transcript(deps, videoId, requested);
  const mirror = deps.videos.mirror(videoId)!;
  const record = mirror.video.documents[documentId]!;
  const sentenceOf = sentenceMapOf(await deps.videos.document(videoId, documentId, record.currentRevision));
  const result = await retakeCandidates({ words, sentenceOf, ...symmetric(deps) });
  return { documentId, ...result };
}

/**
 * 一部已打开视频的话题转折（章节边界候选，§3.6）：与「生成章节」按话题找边界同一份实现（`topicBoundaries`）。调用方已经核过
 * 主体能用这部视频；读的是这部视频自己的索引，不检索别的视频。
 */
export async function topicBoundariesOf(
  deps: EditAidDeps,
  videoId: Id,
  requested: Id | undefined,
  options: Partial<BoundaryOptions>,
  signal: AbortSignal,
): Promise<TopicBoundaries & { documentId: Id }> {
  const { documentId, words } = await transcript(deps, videoId, requested);
  const semantic = deps.semantic();
  const context = semantic?.context(USER_VIEWER) ?? null;
  const result = await topicBoundaries(
    context
      ? {
          topicUnits: (id, doc) => context.topicUnits({ videoId: id, documentId: doc }),
          embed: (texts, s) => context.embedTexts(texts, { role: 'document', signal: s }),
          timelineFrames: (id) => context.timelineFrames({ videoId: id }),
        }
      : {},
    { videoId, documentId, words },
    signal,
    options,
  );
  return { documentId, ...result };
}

async function transcript(deps: EditAidDeps, videoId: Id, requested: Id | undefined) {
  const mirror = deps.videos.mirror(videoId);
  if (!mirror) throw new RpcError('not-found', RcCommon.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
  const documentId = pickTranscript(mirror.video.documents, requested, 'polish')!;
  const words = await timelineWords(deps.videos, videoId, documentId);
  return { documentId, words };
}

/** 本机对称编码（只比两段文字像不像，不检索，不受主体范围限制）；没有语义服务时给原因。 */
function symmetric(deps: EditAidDeps): { embed?: (texts: string[], signal?: AbortSignal) => Promise<Float32Array[]>; unavailable?: SemanticReason } {
  const semantic = deps.semantic();
  if (!semantic) return { unavailable: 'MODEL_NOT_INSTALLED' };
  const context = semantic.context(USER_VIEWER);
  return { embed: (texts, signal) => context.embedTexts(texts, { role: 'symmetric', ...(signal ? { signal } : {}) }) };
}
