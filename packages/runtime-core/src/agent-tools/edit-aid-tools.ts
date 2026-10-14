import { z } from 'zod';
import { videoTimeHref } from '@baocut/protocol';
import { glossaryCandidatesOf, retakeCandidatesOf, topicBoundariesOf, type EditAidDeps } from '../ai-tools/edit-aids.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import type { ToolPrincipal, ToolScope } from './tool-scope.ts';
import { videoArg } from './video-tools.ts';

/**
 * 编辑辅助的只读工具（创作辅助集成设计 §2.4、§2.5、§2.7、§3.6–§3.8）：与编辑器 AI 工具页的「重录候选」「术语候选」、「生成章节」
 * 按话题找边界同一份实现（`ai-tools/edit-aids.ts`），只给候选，不改视频；剪掉哪一遍、改哪个写法、在哪分章由智能体再用
 * `edits_apply` 提交，与其他编辑同样撤销。
 *
 * 语义比较用本机对称编码（装了文本嵌入模型包时），没有时退回字面，`effectiveMode` 与 `reason` 写明。术语候选读视频转写启用的
 * 术语表（与 `library_show` 同样只读用户库），所以与 `speech_sentences` 一样只在工具桥与终端，不在 MCP 面。
 */

export interface EditAidToolsDeps extends EditAidDeps {
  scope: ToolScope;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const documentArg = z.string().min(1).max(200).optional().describe('可选。讲话转写的 documentId；视频只有一份时可不给');

const schemas = {
  speech_retakes: z.strictObject({ video: videoArg, documentId: documentArg }),
  speech_glossary_candidates: z.strictObject({ video: videoArg, documentId: documentArg }),
  speech_topic_boundaries: z.strictObject({
    video: videoArg,
    documentId: documentArg,
    minChapterSec: z.number().min(10).max(3600).optional().describe('可选。两个边界之间至少隔多少秒，10 到 3600；默认 60'),
    maxChapters: z.number().int().min(2).max(200).optional().describe('可选。最多几章（边界数 + 1），2 到 200；默认 24'),
  }),
};

type ToolName = keyof typeof schemas;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  speech_retakes: {
    title: '找重录的几遍',
    description: [
      '在一部视频的讲话里找说了几遍的同一句（录废重来、说错重说），只给候选。',
      '每组 takes 是按时间排的几遍，各带时间线上的起止（秒）、原文、wordIds、是否说完整（complete）；keep 是建议保留的那一遍的下标，只是建议。',
      'differ 为 true 时几遍之间数字、否定词或专有名词不同（differences 写明，marks 是这一遍独有的那几个词）：不是单纯重录，先弄清哪一遍对，拿不准就问用户。',
      'effectiveMode 是 semantic 时按意思比（换了说法的重录也能找到），lexical 时只找文字完全相同的（reason 给原因）。',
      '只给候选，不改视频：要剪掉某一遍，用 edits_apply 的 removeRange（时间线上的秒）或按 wordIds 在转写里查到素材时间后 addCuts。只读。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '找重录', args: { video: 'demo' } }],
    surfaces: ['agent', 'cli'],
    positional: 'video',
  },
  speech_glossary_candidates: {
    title: '找术语的误听写法',
    description: [
      '对照视频转写启用的术语表，找文稿里疑似误听的写法，只给候选。',
      '每条 candidates 是 from（文稿里的写法）→ to（术语表里的正确写法），mode 为 exact 是术语表里记下的误听写法，semantic 是意思与字面都相近的写法（要逐条核对）；occurrences 是每处出现的时间线起止（秒）与词。',
      'discovered 是文稿里写法不一致或反复出现的专有名词（forms 列出各种写法与次数）：可以建议用户加进术语表，你不能改用户库。',
      'glossaries 为 0 时视频没有启用术语表，只有 discovered。只给候选，不改视频：要改写法用 edits_apply 的 updateWords（一词对一词）。只读。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '找误听', args: { video: 'demo' } }],
    surfaces: ['agent', 'cli'],
    positional: 'video',
  },
  speech_topic_boundaries: {
    title: '找话题转折',
    description: [
      '按意思找一部视频讲话里话题转折的地方，作章节边界的候选。',
      'mode 为 topic 时 candidates 按时间排：at 是新章节可以开始的时间线秒（段落或句子的开头），href 是这一刻的链接，before / after 是转折前后各一小段原文；depth 越大转折越明显（只在同一部视频的候选之间比），first 是第一段的起点。',
      '用法：章节只落在 first 与这些候选处，可以合并相邻的几处，不在别处新开；depth 明显小的几处多半是小插曲，按目标章数合并掉。阈值未经校准（calibrated: false）。',
      '这部视频这一版建了画面索引时，候选另带 visualShift：转折前后约 24 秒画面差多少（0 是一样，常见 0–0.5，越大越不同）。讲话转了题、画面也换了（换场景、换幻灯片、换演示对象）时更像章节；只作佐证，depth 相近、拿不准合并哪处时参考，不单凭它新开章节。',
      'mode 为 model 时没有候选（reason 给原因：没装语义模型等；reason 为 null 是没找到明显的转折），照读文稿自己判断。source 是 index（用的是建好的语义索引）或 embedded（现算）。只读。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '找转折', args: { video: 'demo' } }],
    surfaces: ['agent', 'cli'],
    positional: 'video',
  },
};
// i18n-ignore-end

export class EditAidTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: EditAidToolsDeps;

  constructor(deps: EditAidToolsDeps) {
    this.#deps = deps;
  }

  async dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    const p = args as z.infer<(typeof schemas)['speech_retakes']>;
    const access = this.#deps.scope.authorize(principal, false);
    const videoId = (await this.#deps.scope.open(p.video, access)).ref.videoId;
    switch (name as ToolName) {
      case 'speech_retakes': {
        const result = await retakeCandidatesOf(this.#deps, videoId, p.documentId);
        return {
          videoId,
          documentId: result.documentId,
          effectiveMode: result.effectiveMode,
          reason: result.reason,
          groups: result.groups.map((group) => ({
            takes: group.takes.map((take) => ({
              start: round(take.start),
              end: round(take.end),
              text: take.text,
              complete: take.complete,
              wordIds: take.wordIds,
              ...(take.marks.length ? { marks: take.marks } : {}),
            })),
            keep: group.keep,
            differ: group.differ,
            ...(group.differences.length ? { differences: group.differences } : {}),
          })),
        };
      }
      case 'speech_glossary_candidates': {
        const result = await glossaryCandidatesOf(this.#deps, videoId, p.documentId);
        return {
          videoId,
          documentId: result.documentId,
          effectiveMode: result.effectiveMode,
          reason: result.reason,
          glossaries: result.glossaries,
          candidates: result.candidates.map((c) => ({
            from: c.from,
            to: c.to,
            glossary: c.glossaryName,
            mode: c.mode,
            occurrences: c.occurrences.map((o) => ({ start: round(o.start), end: round(o.end), words: o.words })),
          })),
          discovered: result.discovered.map((d) => ({ source: d.source, forms: d.forms, count: d.count })),
        };
      }
      case 'speech_topic_boundaries': {
        const q = args as z.infer<(typeof schemas)['speech_topic_boundaries']>;
        const options = { ...(q.minChapterSec !== undefined ? { minChapterSec: q.minChapterSec } : {}), ...(q.maxChapters !== undefined ? { maxChapters: q.maxChapters } : {}) };
        const result = await topicBoundariesOf(this.#deps, videoId, q.documentId, options, new AbortController().signal);
        return {
          videoId,
          documentId: result.documentId,
          mode: result.mode,
          source: result.source,
          reason: result.reason,
          calibrated: false,
          first: result.first === null ? null : round(result.first),
          candidates: result.candidates.map((c) => ({
            at: round(c.at),
            href: videoTimeHref(videoId, c.at),
            depth: round(c.depth),
            ...(c.visualShift !== undefined ? { visualShift: round(c.visualShift) } : {}),
            before: c.before,
            after: c.after,
          })),
        };
      }
      default:
        // i18n-ignore: 给模型的工具说明、错误与下一步
        throw new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`);
    }
  }
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
