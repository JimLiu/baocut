import { defineMessages } from '@baocut/protocol';
import { zhHans } from './ai-tools-copy.zh-Hans.ts';
import { zhHant } from './ai-tools-copy.zh-Hant.ts';
import { ja } from './ai-tools-copy.ja.ts';
import { ko } from './ai-tools-copy.ko.ts';
import { es } from './ai-tools-copy.es.ts';
import { fr } from './ai-tools-copy.fr.ts';
import { de } from './ai-tools-copy.de.ts';
import { nl } from './ai-tools-copy.nl.ts';
import { ptBR } from './ai-tools-copy.pt-BR.ts';
import { it } from './ai-tools-copy.it.ts';
import { ru } from './ai-tools-copy.ru.ts';
import { pl } from './ai-tools-copy.pl.ts';
import { tr } from './ai-tools-copy.tr.ts';
import { vi } from './ai-tools-copy.vi.ts';

/** 编辑器里工具页的文案（原型 panel-aitools.jsx、panel-aitools-flows.jsx `RunCta`、tool-setup.jsx、panel-aitools-write.jsx）。译文在 `ai-tools-copy.zh-Hans.ts`。 */
const en = {
  back: 'Back',

  // 设置态
  who: 'Use',
  whoAgent: 'Hand off to the Agent',
  whoModel: 'Call a model directly',
  whoModelSub: 'The Runtime has no workflow for this yet, so only the Agent can do it',
  scope: 'Scope',
  scopeAll: 'Whole video',
  scopeChapter: (index: number, label: string) => `Chapter ${index} · ${label}`,
  scopeNoChapters: 'The timeline has no chapters yet, so only the whole video is available',
  cta: 'Hand off to the Agent',
  queued: 'The Agent is busy · the message is queued and will be sent when this turn ends',
  noConversation: 'This video isn’t in any project or session, so it can’t be handed off to the Agent.',
  createFailed: (message: string) => `Couldn’t create a session: ${message}`,

  // 勾选项与自定义
  prePolish: 'Polish first (auto paragraphs)',
  prePolishOn: 'Chapters are grouped by paragraph',
  prePolishOff: 'An unpolished transcript has only 1 paragraph, so chapters will be coarse',
  framesLabel: 'Add keyframe illustrations',
  framesSub: 'Takes frames from the video and places them where a picture helps; off by default',
  framesSubModel: 'No multimodal search installed: takes a frame at each paragraph’s cited time, not picked by content; off by default',
  staleEdited: 'Sentences edited in the original',
  staleEditedSub: 'You changed words in the transcript, but the translation is still the old one',
  staleCut: 'Sentences cut from the original',
  staleCutSub: 'A cut removed part of a sentence; retranslate from the cut original',
  staleNone: 'Check at least one',
  staleOnly: (language: string) => `Only the ${language} translation`,
  retranscribeModel: 'The Agent picks a speech model from those installed on this computer; to choose one, say so in the instructions below.',
  /** 重新转录「更多选项」开着识别说话人、要由「说话人区分」来做时，加进发给 Agent 的那句话（设计稿 panel-aitools.jsx）。 */
  retranscribeSpeakers: 'Identify speakers after transcribing',

  // 写作与发布
  platform: 'Where to post',
  platformPlaceholder: 'The platform to post on (optional); it follows that platform’s rules and reminds you to check',
  titleCount: 'Candidates',
  titleCountNote: (min: number, max: number) => `${min}–${max}, each from a different angle`,
  coverCount: 'How many',
  coverIdea: 'The one thing to say',
  coverIdeaPlaceholder: 'What would make people click this video (optional); leave it blank to let the Agent find it in the transcript',
  coverRatio: 'Aspect ratio',
  coverRatioProject: 'Same as the video canvas',
  coverText: 'Cover text',

  // 剪成短视频（原型 panel-aitools-shorts.jsx）
  shortsShape: 'What to cut',
  shortsCount: 'How many',
  shortsLength: 'Length',
  shortsCustom: 'Custom',
  shortsMin: 'Shortest',
  shortsMax: 'Longest',
  shortsTo: 'to',
  shortsRatio: 'Aspect ratio',
  shortsFraming: 'Framing',
  shortsSubtitles: 'Subtitles',
  shortsTracks: 'Tracks',
  shortsStyle: 'Caption style',
  shortsNoTranslation: 'Original only · this video has no translation yet.',
  shortsSkipDone: 'Skip parts already cut',
  shortsSkipDoneOn: 'Doesn’t look again in ranges that earlier shorts used',
  shortsSkipDoneOff: 'Looks everywhere; may overlap shorts already cut',
  /** 参数页「取景」下的开关：多人全景时分屏（短视频分屏设计 §8.1）。 */
  shortsSplit: 'Split wide shots of several people',
  shortsSplitOn: 'When the original cuts to a wide shot of several people that one vertical frame can’t hold, each person gets a panel, stacked; it switches only at camera cuts, and wide shots under 3 seconds stay as one person',
  shortsSplitOff: 'Wide shots of several people are aimed at one person too',
  shortsTopic: 'Topic',
  shortsTopicPlaceholder: 'Optional: e.g. “why we run it locally”',
  shortsTopicEmpty: 'Optional: leave it empty to analyze the whole video',
  shortsTopicOn: 'Finds the parts about this on this computer first, then the agent picks from them',
  shortsHint: 'Starts a new session to find the segments and create the videos; the original video and its timeline stay as they are.',

  // 还做不了的
  soon: 'Coming soon',
  chaptersPolishFirst: 'Polish and split into paragraphs first, then generate chapters',

  // AI 工具 Tab：列表页、提示词框与交出去
  session: 'Session',
  promptLabel: 'What to tell the Agent',
  promptPlaceholder: 'What to do and how; use @ to reference chapters or speakers',
  restoreDefault: 'Restore default',
  skillNote: 'How this tool works',
  noSkill: 'No skill attached: the Agent follows only the prompt above.',
  addSkillBack: 'Add this tool’s skill back',
  sentNew: 'Handed off to the Agent · new session',
  sentCurrent: 'Handed off to the Agent · continuing the current session',

  // 留在原地的工具页（找可剪的口、刷新过期译文）交给 Agent 后的进度卡
  agentChip: 'Agent in progress',
  agentHanded: (agent: string) => `Handed off to ${agent} in a session`,
  agentStarting: 'Starting the session…',
  agentWorking: 'The Agent is working on it',
  agentWaiting: 'Needs your approval in the session',
  agentWaitingBody: 'Nothing is written to the video until you approve.',
  agentApprove: 'Approve in the session',
  agentDone: 'The Agent has finished',
  agentDoneNote: 'Results are written into the video as usual; the session has the Agent’s reply.',
  agentStopped: 'Stopped in the session',
  agentFailed: 'The Agent couldn’t finish',
  openSession: 'Open session',
  resetSetup: 'Set up again',
  agentNoteCleanup: 'Keep editing in the meantime · suggested cuts appear struck through in the transcript and timeline once they’re written.',
  agentNoteStale: 'Keep editing in the meantime · refreshed translations update the subtitles directly.',
  agentCardTitle: 'For anything not listed below, tell the Agent in a sentence',
  agentCardSomeAgent: 'the Agent',
  agentCardOutside: 'Opens the session this video belongs to, with the video as context →',
  noTranscriptTitle: 'This video has no transcript yet',
  noTranscriptBody: 'Most of these tools start from the transcript: polishing, chapters, summaries and titles need a transcription first; Generate soundtrack doesn’t.',
  goTranscribe: 'Go to Transcript',
  stateRunning: 'Running',
  stateReview: 'To review',
  agentCardNew: (agent: string) => `Starts a new session with this video as context; runs in ${agent} on this computer and asks before writing →`,
  stateChapters: (count: number) => (count === 1 ? '1 chapter' : `${count} chapters`),

  // 直接调模型（产品设计 §5.10「直接调模型」，原型 tool-prompt.jsx、model-ai-prompt.js `contextPack` / `contextLine` / `hint`）
  /** 「用」一行里直接调模型做不了、只能交给 Agent 的工具各自的原因。 */
  whyRetranscribe: 'Needs a speech model, and the Runtime’s transcription adds a whole new transcript instead of replacing a range, so only the Agent can do it',
  whyCleanup: 'Finding cuts means weighing each spot in context, so only the Agent can do it',
  whyCover: 'A cover means generating and composing images, so only the Agent can do it',
  modelPromptLabel: 'Prompt',
  modelPicker: 'Text model',
  modelNone: 'No text model',
  modelNoStructured: 'This model doesn’t support structured output, which this tool needs',
  modelPolishNote: 'Calling a model directly fixes typos and punctuation word by word; it doesn’t split paragraphs. For paragraphs, hand off to the Agent.',
  modelGateBody: 'This tool sends the prompt and the transcript to a text model.',
  skillsAsSystem: 'The attached skills are sent to the model as the system prompt: only SKILL.md and the references/ files it uses, nothing else.',
  contextNone: 'Sent to the model: only the prompt above',
  contextLine: (items: string) => `Sent to the model: prompt + ${items}`,
  contextTranscript: (count: number, scope: string | null) =>
    `transcript${scope ? ` · ${scope}` : ''} ${count === 1 ? '1 paragraph' : `${count} paragraphs`}`,
  contextChapters: (count: number) => `chapters ${count}`,
  contextAttachments: (count: number) => `attachments ${count}`,
  contextSkills: (names: string) => `Skill ${names}`,
  contextImages: (count: number) => `; images aren’t sent to the model, so ${count === 1 ? '1 image' : `${count} images`} will be skipped`,
  modelHint: (model: string | null, applies: boolean, local: boolean) =>
    `${model ? `Calls ${model} directly` : 'Calls a model directly'}, no conversation; ${
      applies ? 'applies when done, one-step undo' : 'the result is for you to read and copy, nothing is written to the video'
    }. ${local ? 'Local model, stays on this computer.' : 'Cloud models bill by usage.'}`,
  ctaPolish: 'Polish',
  ctaChapters: 'Make chapters',
  ctaSummary: 'Write summary',
  ctaBlog: 'Write blog post',
  ctaTitle: 'Suggest titles',
  ctaDesc: 'Write description',
  noTextModel: 'Connect a text model first',
  // 刷新过期译文直接调模型：走 `translate` 就地刷新，没有提示词框（ai-tool-stale-direct.tsx）
  staleDirectSetup:
    'Retranslates, in place, the sentences marked out of date, the ones whose source you edited, and the ones not yet translated: the same translation gets a new version, and only those subtitle lines change.',
  staleTranslation: 'Translation',
  staleNoTranslation: 'This video has no translation yet. Translate it in the Subtitles panel first.',
  staleReading: 'Reading the translation…',
  /** `parts`：「3 out of date · 2 not translated」，用翻译文案的短计数拼。 */
  staleCounts: (parts: string) => `To retranslate: ${parts}`,
  staleNothing: 'Nothing in this translation is out of date or untranslated',
  staleCutNeedsAgent: 'Sentences cut from the original need retranslating from the cut source, which only the Agent can do.',
  staleNoPrompt:
    'Retranslates the way the translation tool does, with the video’s glossaries; no prompt, attachments or skills are sent. To steer it in your own words, hand it to the Agent.',
  staleGateBody: 'This tool sends the sentences to retranslate, with their source, to a text model.',
  ctaStale: (n: number) => (n === 0 ? 'Retranslate' : n === 1 ? 'Retranslate 1 sentence' : `Retranslate ${n} sentences`),

  // 直接调模型：运行、结果与收据
  runSubmitting: 'Starting…',
  runQueued: 'Queued',
  runRunning: (model: string) => `${model} is working on it`,
  runBatches: (done: number, total: number) => `Part ${done} of ${total}`,
  runNote: 'This runs in the background; you can leave this page and come back.',
  cancel: 'Cancel',
  cancelled: 'Cancelled',
  cancelFailed: (message: string) => `Couldn’t cancel: ${message}`,
  submitFailed: 'Couldn’t start',
  failed: 'Failed',
  interrupted: 'Interrupted',
  needsDecision: 'Needs your decision in Tasks',
  openTasks: 'Open Tasks',
  retry: 'Try again',
  dismiss: 'Dismiss',
  badResult: 'The Runtime returned a result this page can’t read.',
  resultFrom: (model: string) => `From ${model} · not written to the video`,
  resultCut: 'The model hit its output limit, so the end may be cut off.',
  resultSkipped: (skipped: number) => (skipped === 1 ? '1 attachment wasn’t sent (images and binary files are skipped).' : `${skipped} attachments weren’t sent (images and binary files are skipped).`),
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Couldn’t copy',
  done: 'Done',
  appliedPolish: (count: number) => (count === 1 ? 'Polished · 1 word changed' : `Polished · ${count} words changed`),
  appliedChapters: (count: number) => (count === 1 ? '1 chapter set on the timeline' : `${count} chapters set on the timeline`),
  appliedNothing: 'The model suggested no changes; nothing was written.',
  undo: 'Undo',
  undone: 'Undone',
  undoFailed: 'Couldn’t undo',
  stateResult: 'Result ready',
  statePercent: (percent: number) => `${percent}%`,
  statePending: (count: number) => `${count} pending`,
  stateStale: (count: number) => `${count} stale`,
  stateLast: (when: string) => `Last · ${when}`,
  // 生成配乐做好后铺上音乐轨（soundtrack-bed.tsx）的吐司；这笔编辑的名字在协议的 `editLabel.addSoundtrack`
  soundtrackAdded: (name: string, summary: string) => `Added “${name}” to the music track · ${summary}`,
};

export type AiToolsMessages = typeof en;
export const AI_TOOLS_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
