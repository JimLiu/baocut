import { live, TOOL_CATEGORIES, type SpaceEntryKind, type ToolCategory, type ToolInputKind } from '@baocut/protocol';
import { M } from './tool-catalog-copy.ts';

/**
 * 工具目录（产品设计 §2.1、§2.7，设计稿 model-tools.js `GROUPS`）：不依附项目的独立能力入口，不进 Agent 回合。
 * 工具按处理的对象分三组（`tools.list` 的 `category`）：语音与字幕、文字与图片、视频文件。结果缺省是 Space 里的条目，
 * 保存到保存位置；只有选了 Space 里可编辑的视频（或改选「新建视频」）时，结果才是一个视频。
 *
 * 每个工具声明它收哪几种输入（`inputs`，各自的结果 `output`）与缺省的结果（`output`；`artifacts` 是从文件、链接、文字开始时
 * 产出的条目种类）。目录卡、侧栏、输入来源的切换都从这份声明派生，组件里不另写。`needs`：视频输入要求视频已有的东西
 * （`transcript` 转录过）；`accept`：文件输入收的扩展名；`targets`：结果落在哪的几种选法，第一项是缺省。
 *
 * ID 用 Runtime 工具注册表（`tools.list`）的 ID；旧版界面的短名（`translate`、`tts`……）经 `toolIdOf` 落到新 ID，
 * 旧链接与存下来的路由照样打得开。顺序就是页面与侧栏上的顺序。此刻能不能用不在这里：以 `tools.list` 为准。
 */

export const TOOL_IDS = [
  'transcribe',
  'translate-subtitles',
  'dub',
  'synthesize-speech',
  'generate-text',
  'generate-image',
  'link-import',
  'compress-video',
  'merge-video',
  'extract-audio',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/**
 * 视频工具（转录、翻译字幕、翻译配音、下载视频）：共用视频选择器、运行页与当场授权。这是页面机制上的一类，与目录的分组
 * （`group`）无关。
 */
export const VIDEO_TOOL_IDS = ['transcribe', 'translate-subtitles', 'dub', 'link-import'] as const;
export type VideoToolId = (typeof VIDEO_TOOL_IDS)[number];

/** 压缩、合并与提取音频：共用一页（页顶切换），各自保留工具 ID。 */
export const FILE_VIDEO_TOOL_IDS = ['compress-video', 'merge-video', 'extract-audio'] as const;
export type FileVideoToolId = (typeof FILE_VIDEO_TOOL_IDS)[number];

export type ToolIcon = 'transcript' | 'translate' | 'microphone' | 'import' | 'wave' | 'image' | 'text' | 'film' | 'layers';
export type ToolGroupKey = ToolCategory;
export type ToolOutput = 'video' | 'artifact';
export type ToolArtifact = 'audio' | 'image' | 'doc' | 'final' | 'subtitle';
export type ToolTargetKey = 'create' | 'video' | 'none';

/**
 * 界面上的输入来源：目录（`tools.list`）的输入种类，加上 `space`——从 Space 选一个条目，提交时按条目换成 `video`（可编辑的
 * 视频）、`file`（文件条目，参数给 `{ entryId }`）或 `document`（直接任务的素材），见 model/tool-space-input.ts `inputKindOf`。
 */
export type ToolSourceKind = ToolInputKind | 'space';

export interface ToolInput {
  kind: ToolSourceKind;
  /** `space` 收的条目种类（`video` 是可编辑的视频）；`video` 输入只收视频。 */
  kinds?: readonly SpaceEntryKind[];
  /** 附加的素材（文本生成附上文档或字幕），不是来源切换里的一项。 */
  attach?: boolean;
  output: ToolOutput;
  /** 这个工具里另起的名字（翻译字幕的文件输入叫「字幕文件」）；不给时用 `INPUT_LABELS`。 */
  label?: string;
  accept?: readonly string[];
  needs?: 'transcript';
  fallback?: ToolOutput;
  /** 这种输入由另一个工具的流程执行（可用性也看那个工具的 `tools.list` 状态）。 */
  via?: ToolId;
}

export interface ToolTarget {
  key: ToolTargetKey;
  label: string;
  output: ToolOutput;
}

export interface ToolInfo {
  id: ToolId;
  group: ToolGroupKey;
  name: string;
  icon: ToolIcon;
  desc: string;
  /** 缺省的结果：`video` 只写进你选的视频（翻译配音），`artifact` 是 Space 里的条目。 */
  output: ToolOutput;
  /** 从文件、链接、文字开始时产出的条目种类（转录是文档与字幕两条）；只写进视频的工具为空。 */
  artifacts: readonly ToolArtifact[];
  inputs: readonly ToolInput[];
  targets?: readonly ToolTarget[];
  /** 还没做、卡片置灰「即将推出」。现在目录里没有。 */
  planned?: boolean;
}

export interface ToolGroup {
  key: ToolGroupKey;
  label: string;
  desc: string;
  tools: readonly ToolInfo[];
}

export const INPUT_LABELS: Record<ToolSourceKind, string> = live(() => M.inputLabels);
export const OUTPUT_LABELS: Record<ToolOutput, string> = live(() => M.outputLabels);
export const ARTIFACT_LABELS: Record<ToolArtifact, string> = live(() => M.artifactLabels);

type ToolDecl = Omit<ToolInfo, 'group'>;

/** 名字与说明在读的时候按当前语言取。 */
function tool(decl: Omit<ToolDecl, 'name' | 'desc'>): ToolDecl {
  return Object.defineProperties(decl as ToolDecl, {
    name: { enumerable: true, get: () => M.tools[decl.id].name },
    desc: { enumerable: true, get: () => M.tools[decl.id].desc },
  });
}

const SPEECH_TOOLS: readonly ToolDecl[] = [
  tool({
    id: 'transcribe',
    icon: 'transcript',
    output: 'artifact',
    artifacts: ['doc', 'subtitle'],
    // Space 里的媒体按文件转（`file` 给 `{ entryId }`），可编辑的视频写进它；链接来源由「下载视频」的流程执行（带 `transcribe: true`）。
    inputs: [
      { kind: 'file', output: 'artifact' },
      { kind: 'space', kinds: ['video', 'video-file', 'export', 'audio'], output: 'artifact' },
      { kind: 'link', output: 'artifact', via: 'link-import' },
    ],
    targets: [
      {
        key: 'none',
        get label() {
          return M.targetNone;
        },
        output: 'artifact',
      },
      {
        key: 'create',
        get label() {
          return M.targetCreate;
        },
        output: 'video',
      },
    ],
  }),
  tool({
    id: 'translate-subtitles',
    icon: 'translate',
    output: 'artifact',
    artifacts: ['subtitle'],
    inputs: [
      { kind: 'space', kinds: ['video', 'subtitle'], needs: 'transcript', output: 'artifact' },
      {
        kind: 'file',
        get label() {
          return M.subtitleFile;
        },
        accept: ['.srt', '.vtt'],
        output: 'artifact',
      },
    ],
  }),
  tool({
    id: 'dub',
    icon: 'microphone',
    output: 'video',
    artifacts: [],
    inputs: [{ kind: 'video', kinds: ['video'], needs: 'transcript', output: 'video' }],
  }),
  tool({
    id: 'synthesize-speech',
    icon: 'wave',
    output: 'artifact',
    artifacts: ['audio'],
    inputs: [
      { kind: 'text', output: 'artifact' },
      { kind: 'space', kinds: ['document', 'subtitle'], output: 'artifact' },
    ],
  }),
];

const TEXT_IMAGE_TOOLS: readonly ToolDecl[] = [
  tool({
    id: 'generate-text',
    icon: 'text',
    output: 'artifact',
    artifacts: ['doc'],
    inputs: [
      { kind: 'text', output: 'artifact' },
      { kind: 'space', kinds: ['document', 'subtitle'], attach: true, output: 'artifact' },
    ],
  }),
  tool({
    id: 'generate-image',
    icon: 'image',
    output: 'artifact',
    artifacts: ['image'],
    inputs: [{ kind: 'text', output: 'artifact' }],
  }),
];

const VIDEO_FILE_TOOLS: readonly ToolDecl[] = [
  tool({
    id: 'link-import',
    icon: 'import',
    output: 'artifact',
    artifacts: ['final'],
    inputs: [{ kind: 'link', output: 'artifact' }],
    targets: [],
  }),
  tool({
    id: 'compress-video',
    icon: 'film',
    output: 'artifact',
    artifacts: ['final'],
    inputs: [
      { kind: 'file', output: 'artifact' },
      { kind: 'space', kinds: ['video-file', 'export'], output: 'artifact' },
    ],
  }),
  tool({
    id: 'merge-video',
    icon: 'layers',
    output: 'artifact',
    artifacts: ['final'],
    inputs: [
      { kind: 'file', output: 'artifact' },
      { kind: 'space', kinds: ['video-file', 'export'], output: 'artifact' },
    ],
  }),
  tool({
    id: 'extract-audio',
    icon: 'wave',
    output: 'artifact',
    artifacts: ['audio'],
    inputs: [
      { kind: 'file', output: 'artifact' },
      { kind: 'space', kinds: ['video-file', 'export', 'audio'], output: 'artifact' },
    ],
  }),
];

/** 三组里各有哪些工具（设计稿 model-tools.js `GROUPS`）；顺序照 `TOOL_CATEGORIES`，名字与说明在文案目录里。 */
const GROUP_TOOLS: Record<ToolGroupKey, readonly ToolDecl[]> = {
  speech: SPEECH_TOOLS,
  'text-image': TEXT_IMAGE_TOOLS,
  'video-file': VIDEO_FILE_TOOLS,
};

export const TOOL_GROUPS: readonly ToolGroup[] = TOOL_CATEGORIES.map((key) => ({
  key,
  get label() {
    return M.groups[key].label;
  },
  get desc() {
    return M.groups[key].desc;
  },
  // 不展开（展开会把名字与说明冻结在加载时的语言里）：照抄属性描述，名字与说明仍是读时取。
  tools: GROUP_TOOLS[key].map((t) => Object.defineProperties({ group: key }, Object.getOwnPropertyDescriptors(t)) as ToolInfo),
}));

export const TOOLS: readonly ToolInfo[] = TOOL_GROUPS.flatMap((g) => g.tools);

/** 旧版界面的工具短名 → 注册表 ID（旧链接、存下来的路由、首页按钮）。 */
const LEGACY_IDS: Record<string, ToolId> = {
  translate: 'translate-subtitles',
  link: 'link-import',
  tts: 'synthesize-speech',
  image: 'generate-image',
  text: 'generate-text',
  compress: 'compress-video',
  merge: 'merge-video',
  extract: 'extract-audio',
};

export function isToolId(value: string | undefined): value is ToolId {
  return (TOOL_IDS as readonly string[]).includes(value ?? '');
}

/** 路由里的工具名 → 工具 ID：注册表 ID 原样，旧短名换成新的；认不出时 null。 */
export function toolIdOf(value: string | undefined | null): ToolId | null {
  if (!value) return null;
  if (isToolId(value)) return value;
  return Object.hasOwn(LEGACY_IDS, value) ? LEGACY_IDS[value]! : null;
}

export function toolById(id: string | undefined | null): ToolInfo | null {
  const key = toolIdOf(id);
  return key ? (TOOLS.find((t) => t.id === key) ?? null) : null;
}

export function isVideoTool(id: ToolId): id is VideoToolId {
  return (VIDEO_TOOL_IDS as readonly string[]).includes(id);
}

export function isFileVideoTool(id: ToolId): id is FileVideoToolId {
  return (FILE_VIDEO_TOOL_IDS as readonly string[]).includes(id);
}

/** 路由里的工具 → 能打开的工具；未知或未推出的回到目录（null）。 */
export function openable(id: string | undefined | null): ToolInfo | null {
  const t = toolById(id);
  return t && !t.planned ? t : null;
}

export interface InputOption {
  key: ToolSourceKind;
  label: string;
  output: ToolOutput;
  needs: 'transcript' | null;
  accept: readonly string[] | null;
  /** 由哪个工具执行；就是这个工具时 null。 */
  via: ToolId | null;
}

/** 输入来源的选项（界面的来源切换），按声明的顺序；附加的素材不算来源。 */
export function inputOptions(id: string | undefined | null): InputOption[] {
  const t = toolById(id);
  return t
    ? t.inputs.filter((i) => !i.attach).map((i) => ({
        key: i.kind,
        label: i.label ?? INPUT_LABELS[i.kind],
        output: i.output,
        needs: i.needs ?? null,
        accept: i.accept ?? null,
        via: i.via ?? null,
      }))
    : [];
}

/** 结果落在哪的选项（下载视频：新建 / 加进已有 / 只下载），第一项是缺省；没有这一问的工具是空的。 */
export function targetOptions(id: string | undefined | null): ToolTarget[] {
  const t = toolById(id);
  return t?.targets ? t.targets.map((x) => ({ ...x })) : [];
}

/** 这个工具从这种输入开始时结果是什么；不收这种输入时 null。 */
export function outputOf(id: string | undefined | null, kind: ToolSourceKind): ToolOutput | null {
  return toolById(id)?.inputs.find((i) => i.kind === kind)?.output ?? null;
}

/** 产出条目的说法：「文档与字幕条目」「音频条目」。 */
export function artifactText(artifacts: readonly ToolArtifact[]): string {
  return M.artifactItems(artifacts);
}

/** 这个工具从 Space 收哪几种条目（来源与附加的素材都算），按声明的顺序；不收时空。 */
export function spaceKindsOf(id: string | undefined | null): SpaceEntryKind[] {
  const kinds: SpaceEntryKind[] = [];
  for (const i of toolById(id)?.inputs ?? []) for (const k of i.kinds ?? []) if (!kinds.includes(k)) kinds.push(k);
  return kinds;
}

/** 卡片上「结果」那一句（设计稿 `resultLine`）：缺省产出什么条目；能改选新建视频、能写进你选的视频的另说一句。 */
export function resultLine(id: string | undefined | null): string {
  const t = toolById(id);
  if (!t) return '';
  if (t.output === 'video') return M.resultWritesVideo;
  const parts = [M.resultInSpace(artifactText(t.artifacts))];
  if ((t.targets ?? []).some((x) => x.key === 'create')) parts.push(M.resultAlsoCreate);
  if (t.inputs.some((i) => i.kind === 'space' && i.kinds?.includes('video'))) parts.push(M.resultWritesEditable);
  return M.joinResult(parts);
}
