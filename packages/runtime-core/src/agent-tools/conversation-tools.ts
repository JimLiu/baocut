// i18n-ignore-file: 给模型的工具说明、错误与下一步
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AgentQuestion, Id, QuestionPreview } from '@baocut/protocol';
import type { Harness } from '@baocut/harness';
import { classifyFile } from '../space-catalog.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import type { ToolAccess, ToolPrincipal, ToolScope } from './tool-scope.ts';

/**
 * 会话自己的工具：只给会话里的智能体（`surfaces` 只有 `agent`），对外服务与 CLI 没有会话。
 *
 * 会话标题（产品设计 §3.1、架构设计 §3.10）：
 * `conversations_set_title`：用户的第一句话是泛泛的指令、标题认不出是哪部视频时，智能体读懂内容后起一个短标题。规则与链接视频的
 * 平台标题相同（`Harness.retitleIfAuto`）：标题还是按第一句话自动起的才换，只换一次，用户改过的、创建时给了的都不动。只改这个会话
 * 在 BaoCut 里的标题，不碰视频与文件、不外发，所以不确认，规划模式下也能用（与任务合同的工具同理）。
 *
 * `conversations_ask`（架构设计 §3.12「提问」）：BaoCut 自己的提问，选项可以带预览（会话工作目录里的图片、视频或音频）。与原生
 * 提问同一张卡、同一套规则，等用户回答、跳过或直接发消息才返回；没有原生提问的智能体也靠它问。只在会话里放一张卡，不确认。
 */

export interface ConversationToolsDeps {
  harness: Pick<Harness, 'retitleIfAuto' | 'conversationOf' | 'askQuestions'>;
  scope: ToolScope;
}

/** 标题的上限与按第一句话起的相同（第一行，最多 40 个字符）：超出时拒绝，让智能体改短，不显示被截断的标题。 */
const TITLE_MAX = 40;

const option = z.strictObject({
  label: z.string().trim().min(1).max(80).describe('选项名：几个词，用户点选的就是它；同一题里不能重复'),
  description: z.string().trim().max(300).optional().describe('一句话说明这个选项意味着什么、取舍在哪；推荐的写明「推荐」'),
  preview: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('预览文件：会话工作目录里的图片、视频或音频（相对工作目录或绝对路径），如 videos_frames 取的帧、做好的样图、截好的试听片段'),
});

const question = z.strictObject({
  header: z.string().trim().min(1).max(24).describe('短标签，显示在题目上方：两三个词，如「封面」「配音音色」'),
  question: z.string().trim().min(1).max(500).describe('完整的问题，用用户的语言'),
  options: z.array(option).min(2).max(4).describe('两到四个具体的候选，推荐的放第一个'),
  multiSelect: z.boolean().optional().describe('可以选几个时为 true；默认单选'),
  allowOther: z.boolean().optional().describe('除了选项还让用户自己写答案；默认 true'),
});

const schemas = {
  conversations_ask: z.strictObject({
    questions: z.array(question).min(1).max(4).describe('一次问完：一到四道题'),
  }),
  conversations_set_title: z.strictObject({
    title: z
      .string()
      .trim()
      .min(1)
      .max(TITLE_MAX)
      .regex(/^[^\r\n]+$/, '标题只能是一行')
      .describe(`标题：一行，最多 ${TITLE_MAX} 个字符，用用户的语言；写视频讲什么、是谁的，不写要做的任务`),
  }),
};

const DEFINITIONS: Record<keyof typeof schemas, ToolInfo> = {
  conversations_ask: {
    title: '向用户提问',
    description: [
      '停下来问用户一到四道选择题，等用户在 BaoCut 里回答后返回答案。选项可以带预览：会话工作目录里的图片、视频或音频文件，用户看过、听过再选。',
      '要用户在几个看得见、听得到的方向里挑时用（封面、画面风格、配音音色、剪法）：先把候选做成文件（videos_frames 取帧、生成样图、截一段试听），再把路径放进 preview。不需要预览时，用你自带的提问工具也可以。',
      '只在影响正确性、有不可逆风险、涉及预算或隐私，又从视频与文件里读不到时才问；能按常理决定的用默认值做。每题两到四个候选，推荐的放第一个。',
      '用户可能跳过（declined）：按你的判断接着做，不再问同一件事；也可能直接打字回复（declined 且 byMessage 为 true）：那条消息紧接着作为插话送到，把它当作回答。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      {
        title: '带预览的二选一',
        args: {
          questions: [
            {
              header: '封面',
              question: '用哪一帧做封面？',
              options: [
                { label: '开场特写', description: '推荐：人物正脸，标题压得住', preview: 'frames/cover-a.jpg' },
                { label: '城市远景', description: '画面空，适合放大标题', preview: 'frames/cover-b.jpg' },
              ],
            },
          ],
        },
      },
    ],
    surfaces: ['agent'],
  },
  conversations_set_title: {
    title: '起会话标题',
    description: [
      '给这个会话起一个能认出内容的标题，显示在 BaoCut 的会话列表里。',
      '用户的第一句话是泛泛的指令（如「转录这个视频并翻译成中文」），标题认不出是哪部视频时用：读懂素材的内容（文稿、画面）之后，用用户的语言写一个短标题，点出视频讲什么、是谁的，不加引号或书名号，不写「转录」「翻译」这类任务词。',
      '只在标题还是按用户第一句话自动起的时才换，只换一次：用户改过名、创建时给了标题、已经换成链接视频的平台标题或你之前起过的，都不换（changed 为 false）。从链接下载的视频 BaoCut 会自动换成平台标题，不用起。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'mutation',
    examples: [{ title: '按内容起标题', args: { title: '城市骑行通勤的五个误区' } }],
    surfaces: ['agent'],
  },
};

type SetTitleArgs = z.infer<(typeof schemas)['conversations_set_title']>;
type AskArgs = z.infer<(typeof schemas)['conversations_ask']>;

const PREVIEW_KINDS: Partial<Record<string, QuestionPreview['kind']>> = { image: 'image', 'video-file': 'video', audio: 'audio' };

export class ConversationTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #harness: ConversationToolsDeps['harness'];
  readonly #scope: ToolScope;

  constructor(deps: ConversationToolsDeps) {
    this.#harness = deps.harness;
    this.#scope = deps.scope;
  }

  async dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name) {
      case 'conversations_ask':
        return this.#ask(args as AskArgs, principal);
      case 'conversations_set_title':
        return this.#setTitle(args as SetTitleArgs, principal);
      default:
        throw new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`);
    }
  }

  #setTitle(args: SetTitleArgs, principal: ToolPrincipal) {
    const conversationId = this.#conversation(this.#scope.authorize(principal, false));
    const changed = this.#harness.retitleIfAuto(conversationId, args.title);
    const title = this.#harness.conversationOf(conversationId)?.title ?? '';
    return changed
      ? { changed, title, next: '会话标题已经换上，之后不要再调用这个工具。' }
      : {
          changed,
          title,
          next: '标题已经由用户定下，或之前换过（链接视频的平台标题、你起过的），这次没有换：保持原样，不要再调用，也不用告诉用户。',
        };
  }

  async #ask(args: AskArgs, principal: ToolPrincipal) {
    const conversationId = this.#conversation(this.#scope.authorize(principal, false));
    const cwd = this.#harness.conversationOf(conversationId)?.cwd;
    if (!cwd) throw new ToolError('NO_ACTIVE_TASK', '这个会话没有进行中的任务；工具只在回合里可用');
    const questions: AgentQuestion[] = [];
    for (const [index, q] of args.questions.entries()) {
      const labels = q.options.map((o) => o.label);
      const repeated = labels.find((label, i) => labels.indexOf(label) !== i);
      if (repeated) throw new ToolError('INVALID_ARGUMENTS', `第 ${index + 1} 题的选项名重复：${repeated}`);
      const options = [];
      for (const o of q.options) {
        options.push({
          label: o.label,
          description: o.description || null,
          ...(o.preview ? { preview: await previewOf(cwd, o.preview) } : {}),
        });
      }
      questions.push({
        id: `q${index + 1}`,
        header: q.header,
        question: q.question,
        options,
        multiSelect: q.multiSelect ?? false,
        allowOther: q.allowOther ?? true,
      });
    }
    const outcome = await this.#harness.askQuestions(conversationId, questions);
    switch (outcome.status) {
      case 'answered':
        return {
          status: 'answered',
          answers: questions.map((q) => ({ header: q.header, question: q.question, answer: outcome.answers[q.id] ?? [] })),
          next: '按用户的选择接着做，不要再问同一件事。',
        };
      case 'declined':
        return { status: 'declined', byMessage: outcome.byMessage, next: outcome.message };
      case 'busy':
        throw new ToolError('QUESTION_PENDING', '上一次提问还在等用户回答：一次问完，不要同时提两次');
      case 'no-task':
        throw new ToolError('NO_ACTIVE_TASK', '这个会话没有进行中的任务；工具只在回合里可用');
      case 'cancelled':
        throw new ToolError('APPROVAL_CANCELLED', '提问在用户回答之前被取消了（任务被停止或回复被打断）：不要重试，结束这个回合');
    }
  }

  #conversation(access: ToolAccess): Id {
    if (access.submitter.kind !== 'agent') throw new ToolError('UNKNOWN_TOOL', '这个工具只给会话里的智能体');
    return access.submitter.id;
  }
}

/** 选项的预览文件：要在会话的工作目录里、是普通文件，种类按扩展名定（图片、视频、音频）。路径记成相对工作目录、用 `/` 分隔。 */
async function previewOf(cwd: string, given: string): Promise<QuestionPreview> {
  const root = await fs.realpath(cwd);
  let real: string;
  try {
    real = await fs.realpath(path.resolve(root, given));
  } catch {
    throw new ToolError('FILE_NOT_FOUND', `预览文件不存在：${given}`, { path: given });
  }
  const relative = path.relative(root, real);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ToolError('PATH_OUTSIDE_WORKSPACE', `预览文件要在会话的工作目录里：${given}`, {
      path: given,
      next: '把文件复制进会话的工作目录（或直接生成在那里），再用相对路径',
    });
  }
  if (!(await fs.stat(real)).isFile()) throw new ToolError('NOT_A_FILE', `预览不是文件：${given}`, { path: given });
  const kind = PREVIEW_KINDS[classifyFile(real) ?? ''];
  if (!kind) throw new ToolError('INVALID_ARGUMENTS', `预览只能是图片、视频或音频文件：${given}`, { path: given });
  return { kind, path: relative.split(path.sep).join('/') };
}
