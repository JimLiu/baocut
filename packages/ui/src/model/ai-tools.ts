/**
 * 工具页（不在编辑器工具栏上的承载页，从会话 `/`、文稿面板头部菜单与各面板旁的按钮打开；原型 panel-aitools-flows.jsx `TOOLS` / `GROUPS` /
 * `GROUP_SUB`、model-agent.js `INTENTS` / `intentPrompt`、panel-aitools-cut.jsx `cleanupExtra`、model-writing.js `intentExtra`）：工具目录、每个工具由谁来做，以及交给 Agent 时那句意图。
 *
 * 由谁来做分三档，页面照实说：
 * - `runtime`：Runtime 有这条流程（识别说话人、翻译字幕、翻译配音），工具页就是那条流程的设置页。识别说话人的设置页里
 *   「用」还能选交给 Agent（意图句照下面的 `INTENTS.speakers`）。
 * - `agent`：Runtime 没有单独的流程，交给编码 Agent——直接把那句意图发到这个视频的会话里。
 * - `soon`：要在画面上跟踪、调取景框（智能裁剪、剪成短视频），Runtime 还没有这条流程，列着但只说为什么还不能用。
 *
 * 工具页第一行「用」还能选「直接调模型」：润色、章节、总结、博客、标题、简介走 Runtime 的 `ai-tool` 流程（不经过对话，
 * 见 components/editor/ai-tool-direct.ts）；重新转录、找可剪的口、重译过期句、做封面那一项置灰、写原因。
 * （转录流程整篇另加一份转写，不按范围替换词级数据，所以「重新转录」仍交给 Agent；整篇重转在字幕面板。）
 *
 * 文案（工具名、说明、选项、意图句与附加要求）都在目录里，英文是键与类型的来源，译文在 `ai-tools.zh-Hans.ts`；意图句随界面语言写。
 */

import { defineMessages, intlLocale, live } from '@baocut/protocol';
import { zhHans } from './ai-tools.zh-Hans.ts';
import { zhHant } from './ai-tools.zh-Hant.ts';
import { ja } from './ai-tools.ja.ts';
import { ko } from './ai-tools.ko.ts';
import { es } from './ai-tools.es.ts';
import { fr } from './ai-tools.fr.ts';
import { de } from './ai-tools.de.ts';
import { nl } from './ai-tools.nl.ts';
import { ptBR } from './ai-tools.pt-BR.ts';
import { it } from './ai-tools.it.ts';
import { ru } from './ai-tools.ru.ts';
import { pl } from './ai-tools.pl.ts';
import { tr } from './ai-tools.tr.ts';
import { vi } from './ai-tools.vi.ts';

export type AiToolId =
  | 'crop'
  | 'shortscut'
  | 'polish'
  | 'chapters'
  | 'speakers'
  | 'retranscribe'
  | 'cleanup'
  | 'translate'
  | 'stale'
  | 'dub'
  | 'summary'
  | 'blog'
  | 'title'
  | 'desc'
  | 'cover';

/** 分组（数据键；显示名见 `AI_TOOL_GROUP_LABEL`）。 */
export type AiToolGroup = 'frame' | 'transcript' | 'translate' | 'writing' | 'publish';
export type AiToolTier = 'runtime' | 'agent' | 'soon';

/** 交给 Agent 的那些工具。 */
export type AgentToolId = 'polish' | 'chapters' | 'speakers' | 'retranscribe' | 'cleanup' | 'stale' | 'summary' | 'blog' | 'title' | 'desc' | 'cover';

export interface AiTool {
  id: AiToolId;
  group: AiToolGroup;
  name: string;
  /** 列表第二行。 */
  desc: string;
  tier: AiToolTier;
  /** 工具页顶上那张说明卡的几行；没有时用 `desc`。 */
  setup?: readonly string[];
  /** `soon` 的工具：为什么还不能用。 */
  why?: string;
}

const CLEANUP_KEYS = ['fillers', 'pauses', 'repeats'] as const;
export type CleanupKey = (typeof CLEANUP_KEYS)[number];
const LENGTH_KEYS = ['short', 'medium', 'long'] as const;
export type WriteLength = (typeof LENGTH_KEYS)[number];
const STYLE_KEYS = ['plain', 'pop', 'sharp', 'light', 'pro', 'custom'] as const;
export type WriteStyle = (typeof STYLE_KEYS)[number];
const VIEW_KEYS = ['auto', 'author', 'viewer'] as const;
export type WriteView = (typeof VIEW_KEYS)[number];
const COVER_TEXT_KEYS = ['none', 'phrase', 'phrase-sub'] as const;
export type CoverText = (typeof COVER_TEXT_KEYS)[number];

type IntentArgs = {
  p: string;
  scope: string | null;
  edited: number | boolean;
  cut: number | boolean;
  count: number | null;
};
type ToolText = {
  name: string;
  desc: string;
  setup?: readonly string[];
  why?: string;
};

const soonTail =
  'Runtime doesn’t have this workflow yet, and there’s no overlay on the video for adjusting the framing, so there’s no form to fill in here yet.';
/** 意图句里的范围：「第 2 章 · 开场 of “A”」；整篇时只说视频。 */
const scopeOf = (o: IntentArgs) => (o.scope ? `${o.scope} of ${o.p}` : o.p);

const en = {
  groups: {
    frame: 'Frame',
    transcript: 'Transcript',
    translate: 'Translation',
    writing: 'Writing',
    publish: 'Publishing',
  } as Record<AiToolGroup, string>,
  tools: {
    crop: {
      name: 'Smart crop',
      desc: 'Change the aspect ratio while keeping speakers, whiteboards, and other key subjects in frame',
      why: `Smart crop has to follow speakers, whiteboards, and other key subjects through the video, then crop to the new aspect ratio. ${soonTail}`,
    },
    shortscut: {
      name: 'Cut into shorts',
      desc: 'Pick a few segments from this video and turn each into a vertical short',
      why: `Cutting into shorts means picking a few segments, cropping each to vertical, and adjusting the framing segment by segment on the video. ${soonTail}`,
    },
    polish: {
      name: 'Polish transcript',
      desc: 'Fix typos, add punctuation, and split into paragraphs—without rewriting your words',
      setup: [
        'Fix obvious typos, add missing punctuation, and split into paragraphs by topic.',
        'Your wording isn’t rewritten and nothing is removed—only clear slips are fixed.',
      ],
    },
    chapters: {
      name: 'Generate chapters',
      desc: 'Split a long video into titled chapters',
      setup: ['Group paragraphs into chapters by topic and give each chapter a title.', 'Export and the share page use the same chapters.'],
    },
    speakers: {
      name: 'Identify speakers',
      desc: 'Tell who is speaking; subtitles and the transcript are labeled with names',
    },
    retranscribe: {
      name: 'Re-transcribe',
      desc: 'Rerun the audio with another model—just one chapter or segment if you like',
      setup: [
        'Rerun with another speech model and replace the word-level data in this range.',
        'The transcript, subtitles, and translations outside the range stay exactly as they are.',
      ],
    },
    cleanup: {
      name: 'Find cuts',
      desc: 'Find filler words, long pauses, and bad takes; review suggestions before cutting',
      setup: [
        'Scan for filler words, pauses of 0.8s or longer, and repeated sentence starts.',
        'You get a list of proposed cuts to confirm before anything is cut.',
      ],
    },
    translate: {
      name: 'Translate subtitles',
      desc: 'Translate sentence by sentence and align timecodes using word-level data',
    },
    stale: {
      name: 'Refresh outdated translations',
      desc: 'Retranslate only the sentences whose source was edited or cut',
      setup: [
        'Retranslate only sentences whose source changed: ones you edited, and ones where a cut removed part of the sentence.',
        'Translate from the source as cut; translations of fully cut sentences are cut along with them. Nothing else changes.',
      ],
    },
    dub: {
      name: 'Translate voice-over',
      desc: 'Pick a language and have the video speak it, sounding like the original speaker or a native speaker; the defaults are enough to start',
    },
    summary: {
      name: 'Write a summary',
      desc: 'Body text plus timestamped key points; click a time to jump there',
    },
    blog: {
      name: 'Write a blog post',
      desc: 'Rewrite it as an article, from the author’s or the viewer’s point of view',
    },
    title: {
      name: 'Suggest titles',
      desc: 'Get several candidates from different angles, then pick one',
    },
    desc: {
      name: 'Write a description',
      desc: 'A description for publishing, with chapter timecodes and tags',
    },
    cover: {
      name: 'Make a cover',
      desc: 'Make a few cover candidates from key frames, then pick one',
    },
  } as Record<AiToolId, ToolText>,
  unknownTool: (id: string) => `No such AI tool: ${id}`,
  cleanup: {
    fillers: {
      label: 'Filler words',
      sub: 'Words like “um,” “uh,” “like,” and “you know”',
      off: 'filler words',
    },
    pauses: {
      label: 'Long pauses ≥ 0.8s',
      sub: 'Found using word-level timing',
      off: 'long pauses',
    },
    repeats: {
      label: 'Repeated starts',
      sub: 'A sentence started twice; the later one is kept',
      off: 'repeated starts',
    },
  } as Record<CleanupKey, { label: string; sub: string; off: string }>,
  /** 没勾的几类折成的一句。 */
  cleanupOff: (offs: readonly string[]) => `Don’t look for ${new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(offs)}`,
  lengths: { short: 'Short', medium: 'Medium', long: 'Long' } as Record<WriteLength, string>,
  styles: {
    plain: 'Plain',
    pop: 'Explainer',
    sharp: 'Snarky',
    light: 'Casual',
    pro: 'Professional',
    custom: 'Custom…',
  } as Record<WriteStyle, string>,
  views: {
    auto: 'Auto',
    author: 'I’m the author',
    viewer: 'I’m a viewer',
  } as Record<WriteView, string>,
  coverText: {
    none: 'No text',
    phrase: 'A short phrase',
    'phrase-sub': 'A phrase plus a line of small text',
  } as Record<CoverText, string>,
  viewName: { author: 'author', viewer: 'viewer' } as Record<'author' | 'viewer', string>,
  extraScope: (scope: string) => `Focus only on ${scope}`,
  extraLength: (label: string) => `Length: ${label}`,
  extraStyle: (style: string) => `Style: ${style}`,
  extraLanguage: (language: string) => `Write in ${language}`,
  extraView: (view: string) => `Point of view: ${view}`,
  extraPlatform: (platform: string) => `Publishing to: ${platform}. Follow its rules, and remind me to check when you’re done`,
  extraFrames: 'Where a picture is needed, grab keyframes from the video and put them in the article, each with a caption',
  extraIdea: (idea: string) => `The one thing the cover should say: ${idea}`,
  extraRatio: (ratio: string) => `Aspect ratio ${ratio}`,
  extraCoverText: (label: string) => `Text on the cover: ${label}`,
  /** 片名进句子的样子；没有片名时的说法。 */
  titled: (title: string) => `“${title}”`,
  thisVideo: 'this video',
  /** 刷新过期译文的两类来源：给了句数时带数，否则只说类别。 */
  sourceEdited: (n: number | null) => (n === null ? 'source edited' : n === 1 ? '1 sentence edited in the source' : `${n} sentences edited in the source`),
  sourceCut: (n: number | null) => (n === null ? 'source cut' : n === 1 ? '1 sentence cut in the source' : `${n} sentences cut in the source`),
  sourceJoin: (parts: readonly string[]) => parts.join(', '),
  intents: {
    stale: (o: IntentArgs & { why: string }) =>
      `Some translations in ${o.p} are out of date${o.why ? ` (${o.why})` : ' because the source was edited'}. Retranslate only those sentences${o.cut ? '; retranslate cut ones from the source as cut, and remove the translations of fully cut sentences along with them' : ''}. Leave everything else exactly as it is.`,
    polish: (o: IntentArgs) =>
      `Polish the transcript of ${scopeOf(o)}: fix typos, add punctuation, and split into paragraphs by topic, without rewriting my wording.`,
    chapters: (o: IntentArgs) => `Split ${o.p} into chapters by topic and give each chapter a short title.`,
    speakers: (o: IntentArgs) => `Identify the speakers in ${scopeOf(o)}. Show me the results to confirm before writing them into the video.`,
    retranscribe: (o: IntentArgs) => `Re-transcribe ${scopeOf(o)} with another speech model, and leave everything outside that range exactly as it is.`,
    cleanup: (o: IntentArgs) =>
      `Find filler words, long pauses, and repeated sentence starts in ${scopeOf(o)}. List them first; I’ll confirm before anything is cut.`,
    summary: (o: IntentArgs) => `Write a summary of key points with timecodes from the transcript of ${o.p}.`,
    blog: (o: IntentArgs) => `Rewrite ${o.p} as a blog post ready to publish.`,
    title: (o: IntentArgs & { count: number }) =>
      `Suggest ${o.count} title candidates for ${o.p}, each from a different angle, with a one-line reason for each, and recommend one.`,
    desc: (o: IntentArgs) => `Write a description of ${o.p} for publishing, with chapter timecodes and a line of tags.`,
    cover: (o: IntentArgs & { count: number }) =>
      `Make ${o.count} cover candidates for ${o.p}: pick key frames first, use a different base-image approach for each, and check them at a small size before showing me.`,
  },
  /** 列表页（AI 工具 Tab）分组下的一句副题：说清这一组给谁用。 */
  groupSub: {
    writing: 'For readers: what the video covers, without having to watch it',
    publish: 'For whoever posts the video: make people want to click, then deliver on it',
  } as Partial<Record<AiToolGroup, string>>,
  /** 列表页脚注：第一批没搬进来的工具在哪。 */
  laterNote: 'Translate subtitles is still in the Subtitles panel and Translate voice-over in the Audio panel; they’ll move here later.',
  /** 工具页说明卡上的一行：按下去会不会改视频。 */
  effect: {
    polish: 'Changes the transcript: applied when done, and one step undoes it',
    chapters: 'Changes the chapters: applied when done, and one step undoes it',
    speakers: 'You confirm the result first; it’s written into the video only when you apply it',
    retranscribe: 'Replaces the transcript in this range: applied when done, and one step undoes it',
    cleanup: 'Only proposes cuts; nothing is cut until you confirm',
    stale: 'Retranslates only the outdated sentences; nothing else changes',
    summary: 'Doesn’t change the video: the result is for you to read and copy',
    blog: 'Doesn’t change the video: the result is for you to read and copy',
    title: 'Doesn’t change the video: pick one to use',
    desc: 'Doesn’t change the video: the result is for you to read and copy',
    cover: 'Doesn’t change the video: pick one to use',
  } as Record<AgentToolId, string>,
  /** 模板里的固定约束（以前是语言、风格、篇幅、视角的下拉）。`language` 是语言名；没有时跟文稿。 */
  standMarkdown: (language: string | null) =>
    language ? `Write in Markdown, in ${language}.` : 'Write in Markdown, in the same language as the transcript.',
  standLanguage: (language: string | null) => (language ? `Write in ${language}.` : 'Write in the same language as the transcript.'),
  standing: {
    summary: ['Lead with the conclusion, then list the key points, each with a timecode (mm:ss).', 'Keep it moderate: three to five paragraphs.'],
    blog: [
      'Choose the point of view from the video’s source: write as the author if it’s my own video, and as a viewer if it’s someone else’s.',
      'Keep the style plain, with no marketing tone.',
    ],
    title: ['Put each candidate on its own line.'],
    desc: ['Include chapter timecodes and a line of tags.'],
    cover: ['Text on the cover uses the transcript’s language.'],
    polish: ['Don’t rewrite my wording or remove anything; only fix what is clearly a slip.'],
    chapters: ['Group by topic, with a short title for each chapter.'],
  } as Partial<Record<AgentToolId, readonly string[]>>,
  /** 交给 Agent 发到哪条会话。 */
  sessionNew: 'New session',
  sessionNewSub: 'Takes this video as context; one task per session, with no long history to resend',
  sessionCurrent: (title: string) => `Continue “${title}”`,
  sessionUntitled: 'this video’s session',
  sessionCurrentSub: (messages: number | null) =>
    messages === null
      ? 'Resends the session’s history, which costs more once the prompt cache expires'
      : `${messages === 1 ? '1 message' : `${messages} messages`} so far · resends the history, which costs more once the prompt cache expires`,
  /** 主按钮下那行：按下去会去哪。 */
  hintNew: 'Starts a new session with this video as context. Follow along there; any change the Agent makes to the video can be undone.',
  hintCurrent: 'Sends to this video’s current session, with this video as context. Follow along there; any change the Agent makes to the video can be undone.',
  /** 附加要求补句末标点；意图句与附加要求怎么接。 */
  endSentence: (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`),
  joinPrompt: (head: string, extra: readonly string[]) => [head, ...extra].join(' '),
};
export type AiToolsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 分组的显示名。 */
export const AI_TOOL_GROUP_LABEL: Readonly<Record<AiToolGroup, string>> = live(() => M.groups);

const tool = (id: AiToolId, group: AiToolGroup, tier: AiToolTier): AiTool => ({
  id,
  group,
  tier,
  get name() {
    return M.tools[id].name;
  },
  get desc() {
    return M.tools[id].desc;
  },
  get setup() {
    return M.tools[id].setup;
  },
  get why() {
    return M.tools[id].why;
  },
});

export const AI_TOOLS: readonly AiTool[] = [
  tool('crop', 'frame', 'soon'),
  tool('shortscut', 'frame', 'soon'),
  tool('polish', 'transcript', 'agent'),
  tool('chapters', 'transcript', 'agent'),
  tool('speakers', 'transcript', 'runtime'),
  tool('retranscribe', 'transcript', 'agent'),
  tool('cleanup', 'transcript', 'agent'),
  tool('translate', 'translate', 'runtime'),
  tool('stale', 'translate', 'agent'),
  tool('dub', 'translate', 'runtime'),
  tool('summary', 'writing', 'agent'),
  tool('blog', 'writing', 'agent'),
  tool('title', 'publish', 'agent'),
  tool('desc', 'publish', 'agent'),
  tool('cover', 'publish', 'agent'),
];

const BY_ID = new Map(AI_TOOLS.map((t) => [t.id, t]));

export function aiTool(id: AiToolId): AiTool {
  const found = BY_ID.get(id);
  if (!found) throw new Error(M.unknownTool(id));
  return found;
}

export function isAiToolId(value: unknown): value is AiToolId {
  return typeof value === 'string' && BY_ID.has(value as AiToolId);
}

/** 写作与发布：只读文稿和画面，结果给人读、挑、拷走（原型 §15.11）。 */
export function isWritingTool(id: AiToolId): id is 'summary' | 'blog' | 'title' | 'desc' | 'cover' {
  return id === 'summary' || id === 'blog' || id === 'title' || id === 'desc' || id === 'cover';
}

/**
 * 设置页给不给「范围」一行：范围会进意图句的工具才给（润色、说话人、重新转录、找可剪的口按 `scope` 写进句子，
 * 写作与发布折成「只看…」）。生成章节与刷新过期译文的句子里没有范围，给了也不起作用。
 */
export function hasScope(id: AgentToolId): boolean {
  return id !== 'chapters' && id !== 'stale';
}

// ---- 设置项 ----

/** 找可剪的口：三类口各自可勾；没勾的折成一句「…不找」。 */
export const CLEANUP_OPTIONS = CLEANUP_KEYS.map((key) => ({
  key,
  get label() {
    return M.cleanup[key].label;
  },
  get sub() {
    return M.cleanup[key].sub;
  },
  get off() {
    return M.cleanup[key].off;
  },
}));

export function cleanupExtra(picked: Readonly<Record<CleanupKey, boolean>>): string[] {
  const off = CLEANUP_OPTIONS.filter((o) => !picked[o.key]).map((o) => o.off);
  return off.length ? [M.cleanupOff(off)] : [];
}

const options = <K extends string>(keys: readonly K[], labels: () => Record<K, string>) =>
  keys.map((key) => ({
    key,
    get label() {
      return labels()[key];
    },
  }));

export const LENGTHS = options(LENGTH_KEYS, () => M.lengths);
export const STYLES = options(STYLE_KEYS, () => M.styles);
export const VIEWS = options(VIEW_KEYS, () => M.views);

export const TITLE_COUNT = { min: 3, max: 12, initial: 6 } as const;
export const COVER_COUNT = { min: 2, max: 4, initial: 3 } as const;

export const COVER_RATIOS = ['project', '16:9', '9:16', '1:1', '4:3'] as const;
export type CoverRatio = (typeof COVER_RATIOS)[number];

export const COVER_TEXT = options(COVER_TEXT_KEYS, () => M.coverText);

/** 画布的比例（1920×1080 → 16:9），做封面「跟视频画布」时写进句子。 */
export function canvasRatio(width: number, height: number): string {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!(w > 0 && h > 0)) return '16:9';
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/** 写作与发布的设置态（原型 model-writing.js `intentExtra` 的入参）；没给的项不进句子。 */
export interface WritingSettings {
  /** 「只看」的那一章；整篇时 null。 */
  scope?: string | null;
  length?: WriteLength | null;
  style?: WriteStyle | null;
  /** 风格选「自定义…」时用户写的那句。 */
  customStyle?: string;
  /** 用哪种语言写（已经是名字，比如「英语」）。 */
  language?: string | null;
  /** 选定的视角；「自动」不写，交给 Agent 按视频来源判断。 */
  view?: WriteView | null;
  /** 要发到哪个平台。 */
  platform?: string;
  /** 做封面：要说的一件事、画幅、封面上的字。 */
  idea?: string;
  ratio?: string | null;
  coverText?: CoverText | null;
  /** 写博客：在需要配图的地方从视频取关键帧插进正文（只有交给 Agent 才拿得到画面）。 */
  frames?: boolean;
  note?: string;
}

/** 设置态折成附加要求，一句一条，接在意图句后面。 */
export function writingExtra(tool: 'summary' | 'blog' | 'title' | 'desc' | 'cover', s: WritingSettings): string[] {
  const out: string[] = [];
  if (s.scope) out.push(M.extraScope(s.scope));
  const length = LENGTHS.find((l) => l.key === s.length);
  if (length && tool !== 'title' && tool !== 'cover') out.push(M.extraLength(length.label));
  const style = s.style === 'custom' ? (s.customStyle ?? '').trim() : (STYLES.find((x) => x.key === s.style)?.label ?? '');
  if (style) out.push(M.extraStyle(style));
  if (s.language) out.push(M.extraLanguage(s.language));
  if ((tool === 'blog' || tool === 'desc') && (s.view === 'author' || s.view === 'viewer')) out.push(M.extraView(M.viewName[s.view]));
  const platform = (s.platform ?? '').trim();
  if ((tool === 'title' || tool === 'desc') && platform) out.push(M.extraPlatform(platform));
  if (tool === 'blog' && s.frames) out.push(M.extraFrames);
  if (tool === 'cover') {
    const idea = (s.idea ?? '').trim();
    if (idea) out.push(M.extraIdea(idea));
    if (s.ratio) out.push(M.extraRatio(s.ratio));
    const text = COVER_TEXT.find((m) => m.key === s.coverText);
    if (text) out.push(M.extraCoverText(text.label));
  }
  const note = (s.note ?? '').trim();
  if (note) out.push(note);
  return out;
}

// ---- 意图句 ----

export interface AiIntent {
  tool: AgentToolId;
  /** 视频名；没有时说「这个视频」。 */
  title?: string | null;
  /** 范围（「第 2 章 · 开场」）；整篇时不给。 */
  scope?: string | null;
  /** 刷新过期译文的两类来源：数字是句数，`true` 是勾了但不知道几句。 */
  edited?: number | boolean;
  cut?: number | boolean;
  /** 起标题的候选数、做封面的张数。 */
  count?: number | null;
  /** 设置态折进来的附加要求，一句一条；空的跳过。 */
  extra?: readonly (string | null | undefined | false)[];
}

const sourceWhy = (value: number | boolean, label: (n: number | null) => string) =>
  typeof value === 'number' ? (value > 0 ? label(value) : '') : value ? label(null) : '';

const INTENTS: Record<AgentToolId, (o: IntentArgs) => string> = {
  stale: (o) =>
    M.intents.stale({
      ...o,
      why: M.sourceJoin([sourceWhy(o.edited, M.sourceEdited), sourceWhy(o.cut, M.sourceCut)].filter(Boolean)),
    }),
  polish: (o) => M.intents.polish(o),
  chapters: (o) => M.intents.chapters(o),
  speakers: (o) => M.intents.speakers(o),
  retranscribe: (o) => M.intents.retranscribe(o),
  cleanup: (o) => M.intents.cleanup(o),
  summary: (o) => M.intents.summary(o),
  blog: (o) => M.intents.blog(o),
  title: (o) => M.intents.title({ ...o, count: o.count || TITLE_COUNT.initial }),
  desc: (o) => M.intents.desc(o),
  cover: (o) => M.intents.cover({ ...o, count: o.count || COVER_COUNT.initial }),
};

/** 交给 Agent 的那句话：意图句加附加要求，每条补上句号。 */
export function intentPrompt(intent: AiIntent): string {
  const title = (intent.title ?? '').trim();
  const p = title ? M.titled(title) : M.thisVideo;
  const extra = (intent.extra ?? []).map((x) => String(x || '').trim()).filter(Boolean);
  const head = INTENTS[intent.tool]({
    p,
    scope: intent.scope?.trim() || null,
    edited: intent.edited ?? false,
    cut: intent.cut ?? false,
    count: intent.count ?? null,
  });
  return M.joinPrompt(
    head,
    extra.map((x) => M.endSentence(x)),
  );
}

// ---- AI 工具 Tab：列表、模板、内置 skill、会话去向（产品设计 §5.10、§6.9；原型 model-ai-prompt.js） ----

/** 列表页第一批只列从文稿出发的三组；翻译与画面的工具仍从各自面板进来，脚注说清去处。 */
export const LIST_GROUPS: readonly AiToolGroup[] = ['transcript', 'writing', 'publish'];

/** 分组下的一句副题；没有时不画。 */
export function groupSub(group: AiToolGroup): string | null {
  return M.groupSub[group] ?? null;
}

/** 列表页脚注。 */
export function laterNote(): string {
  return M.laterNote;
}

/**
 * 每个工具配一个内置 skill（仓库根 `skills/<id>/`）：工具页的提示词框默认挂着它，可以摘掉，也可以再挂别的。
 * 翻译字幕与刷新过期译文共用一个；起标题与写简介共用一个。
 */
export const TOOL_SKILL: Readonly<Partial<Record<AiToolId, string>>> = {
  retranscribe: 'subtitle-workflow',
  polish: 'polish-transcript',
  chapters: 'video-chapters',
  speakers: 'speaker-labeling',
  cleanup: 'talking-head-cut',
  translate: 'translate-subtitles',
  stale: 'translate-subtitles',
  summary: 'video-summary',
  blog: 'video-blog',
  title: 'titles-and-description',
  desc: 'titles-and-description',
  cover: 'cover-and-title',
  shortscut: 'shorts-segments',
};

/** 打开工具页时默认挂的 skill：这个工具的内置 skill 还在列表里就挂它（关着的也挂：点选不看开关，§6.9）。 */
export function defaultSkillIds(tool: AiToolId, available: readonly { id: string }[]): string[] {
  const id = TOOL_SKILL[tool];
  return id && available.some((s) => s.id === id) ? [id] : [];
}

/** 工具页说明卡上那一行「会不会改视频」。 */
export function toolEffect(tool: AgentToolId): string {
  return M.effect[tool];
}

/** 模板里意图句下面的几行固定约束；`language` 是语言名（「英语」），没有时跟文稿的语言。 */
export function standingLines(tool: AgentToolId, opts: { language?: string | null } = {}): string[] {
  const language = opts.language?.trim() || null;
  const own = [...(M.standing[tool] ?? [])];
  if (tool === 'summary' || tool === 'blog' || tool === 'desc') return [M.standMarkdown(language), ...own];
  if (tool === 'title') return [M.standLanguage(language), ...own];
  return own;
}

/** 预填进提示词框的模板：第一行意图句（`intentPrompt` 的结果，范围与勾选项已折在里面），下面一行一条固定约束。 */
export function toolTemplate(tool: AgentToolId, intent: string, opts: { language?: string | null } = {}): string {
  return [intent.trim(), ...standingLines(tool, opts)].filter(Boolean).join('\n');
}

/** 工具页提示词框的草稿键：附件、图片与改过的提示词都挂在它下面。 */
export const toolDraftKey = (videoId: string, tool: AiToolId): string => `aitool:${videoId}:${tool}`;

/** 「会话」一行的一个选项。 */
export interface SessionOption {
  key: 'new' | 'current';
  label: string;
  sub: string;
  /** 「接着」的那条会话。 */
  conversationId?: string;
}

/**
 * 交给 Agent 时发到哪条会话（原型 `sessionOptions`）：缺省新会话、这部视频作为上下文；这部视频有一条说过话的会话时才给「接着」，
 * 标上已有几条消息（还没取到时不写数）。视频不属于项目时新会话看不到它，只能接着它所在的那条会话。
 */
export function sessionOptions(input: {
  canCreate: boolean;
  current: { id: string; title: string; messages: number | null } | null;
}): { options: SessionOption[]; fallback: 'new' | 'current' | null } {
  const options: SessionOption[] = [];
  if (input.canCreate) options.push({ key: 'new', label: M.sessionNew, sub: M.sessionNewSub });
  const cur = input.current;
  if (cur && cur.messages !== 0) {
    options.push({
      key: 'current',
      conversationId: cur.id,
      label: M.sessionCurrent(cur.title.trim() || M.sessionUntitled),
      sub: M.sessionCurrentSub(cur.messages),
    });
  }
  return { options, fallback: options[0]?.key ?? null };
}

/** 主按钮下那行：按下去会去哪。 */
export function handoffHint(session: 'new' | 'current'): string {
  return session === 'current' ? M.hintCurrent : M.hintNew;
}
