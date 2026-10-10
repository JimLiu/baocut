import { DraftAttachmentPreview } from './media/draft-attachment-preview.tsx';
import { P as PLAYER_COPY } from './player/player-copy.ts';
import { IMAGE as IMAGE_COPY } from './image-preview-copy.ts';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentRef,
  type ComponentType,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  localizeText,
  type AgentMode,
  type AttachmentRef,
  type DriverId,
  type SkillSendRef,
} from '@baocut/protocol';
import {
  Attachment,
  AttachmentPreview,
  InsertTextMenuItem,
  PromptField,
  PromptFieldAttachmentList,
  PromptFieldSubmitButton,
  PromptFieldToolbar,
  PromptTokenField,
  type PromptFieldAttachment,
  type PromptFieldValue,
} from '@react-spectrum/ai';
import {
  ActionButton,
  Button,
  Header,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SubmenuTrigger,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import ArrowUpSend from '@react-spectrum/s2/icons/ArrowUpSend';
import Close from '@react-spectrum/s2/icons/Close';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import Code from '@react-spectrum/s2/icons/Code';
import Asset from '@react-spectrum/s2/icons/Asset';
import Edit from '@react-spectrum/s2/icons/Edit';
import Export from '@react-spectrum/s2/icons/Export';
import Attach from '@react-spectrum/s2/icons/Attach';
import FileText from '@react-spectrum/s2/icons/FileText';
import Folder from '@react-spectrum/s2/icons/Folder';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import ListBulleted from '@react-spectrum/s2/icons/ListBulleted';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import MovieCamera from '@react-spectrum/s2/icons/MovieCamera';
import Redo from '@react-spectrum/s2/icons/Redo';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Settings from '@react-spectrum/s2/icons/Settings';
import Star from '@react-spectrum/s2/icons/Star';
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing';
import TextIcon from '@react-spectrum/s2/icons/Text';
import TranscriptIcon from '@react-spectrum/s2/icons/Transcript';
import Translate from '@react-spectrum/s2/icons/Translate';
import Tools from '@react-spectrum/s2/icons/Tools';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import {
  AGENT_PICKER,
  ATTACHMENT_COPY,
  COMPOSER_MENU,
  QUEUE_COPY,
  DRIVER_STATE_REASON,
  HOME_COPY,
  MENTION_GROUPS,
  SKILL_COPY,
  SLASH_COMMANDS,
  accessModeToast,
  composerFoot,
  type SlashCommand,
} from '../copy.ts';
import type { AgentChange } from '../model/agent-choice.ts';
import { skillMenuItems } from '../model/agent-skills.ts';
import { admitFiles, admitImages, rejectionMessage } from '../model/composer-attachments.ts';
import {
  COMPLETION_TRIGGER,
  activeCompletion,
  applySlash,
  mentionCandidates,
  slashMatches,
  videoMentionCandidates,
  type MentionCandidate,
  type MentionScope,
} from '../model/composer-completions.ts';
import { useRuntime } from '../runtime/context.tsx';
import type { MessageFile } from '../host.ts';
import { useDraftFileList, useDraftFiles } from '../state/draft-files-store.ts';
import { useConnection } from '../state/connection-store.ts';
import { useDraftSkillId, useDraftSkills } from '../state/draft-skills-store.ts';
import { imageEntry, uploadDraftImages, useDraftImageList, useDraftImages, type DraftImage } from '../state/draft-images-store.ts';
import { useShell } from '../state/shell-store.ts';
import { useSpace } from '../state/space-store.ts';
import { AccessPicker } from './access-picker.tsx';
import { AgentPicker } from './agent-picker.tsx';
import { ComposerToken, composerTokenList } from './composer-token.tsx';
import { useVideoMentions } from './use-editor-reference.ts';
import { useNarrow } from './use-narrow.ts';
import { focusPromptEnd, usePromptValue } from './use-prompt-value.ts';
import { useSkillsLoader } from './use-skills.ts';

const wrap = style({
  // PromptTokenField 的提示是输入区自己的 :empty::before，默认继承正文色；app.css 拿这个变量把它降到 gray-500（原型 spectrum.css）。
  '--bc-prompt-placeholder': { type: 'color', value: 'gray-500' },
  flexShrink: 0,
  width: 'full',
  maxWidth: { default: '[760px]', isStart: 'none' },
  marginX: 'auto',
  paddingX: { default: 24, isCompact: 12, isStart: 0 },
  paddingBottom: { default: 16, isStart: 0 },
  boxSizing: 'border-box',
  // 起始页的项目托盘压在输入框底下：输入框要盖在它上面。
  position: { isStart: 'relative' },
  zIndex: { isStart: 1 },
});
/** 起始页把文件拖到输入框上时描一圈（原型 spectrum.css `.bc-ai-home.is-over`）。 */
const dropZone = style({
  borderRadius: 'xl',
  outlineStyle: { default: 'none', isOver: 'solid' },
  outlineWidth: 2,
  outlineOffset: 2,
  outlineColor: 'blue-900',
});
/** 输入框自己的工具栏（原型 .bc-ai-toolbar）：+、访问模式，右边是 Agent · 模型与发送 / 停止。 */
const toolbar = style({ display: 'flex', alignItems: 'center', gap: { default: 8, isCompact: 4 }, width: 'full', minWidth: 0 });
const tags = style({ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 });
const tag = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: 'full',
  height: 24,
  paddingStart: 8,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'ui-xs',
  color: 'gray-800',
  boxSizing: 'border-box',
});
const tagText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const spacer = style({ flexGrow: 1 });
const insertMenu = style({ width: 280, maxWidth: '[calc(100vw - 32px)]' });
const toolCta = style({ width: 'full', marginTop: 8 });
const toolHint = style({ margin: 0, marginTop: '[6px]', font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const foot = style({ font: 'ui-xs', color: { default: 'gray-500', isError: 'negative' }, paddingX: 4, paddingTop: 4, minHeight: 16 });

/** 斜杠命令的图标（原型 data.js `agent.slash`）。 */
const SLASH_ICON: Record<SlashCommand['icon'], ComponentType> = {
  translate: Translate,
  sparkle: MagicWand,
  list: ListBulleted,
  captions: CloseCaptions,
  mic: Microphone,
  export: Export,
  redo: Redo,
  refresh: Refresh,
  wave: AudioWave,
  transcript: TranscriptIcon,
  text: TextIcon,
  star: Star,
  edit: Edit,
  image: ImageIcon,
};

const IMAGE_TYPES = [...ATTACHMENT_MIME_TYPES];

export interface ComposerProps {
  /** 草稿的键：会话 ID，或新会话用的草稿键。 */
  draftKey: string;
  /** 这条消息交给哪个 Agent：会话上的，或新会话草稿上的选择，再不然默认的那个。 */
  driverId: DriverId | null;
  /** null = Agent 默认模型。 */
  model: string | null;
  /** null = 模型自己的默认强度。 */
  effort: string | null;
  /** 会话有过任务后 Agent 固定成这一个。 */
  lockedTo: DriverId | null;
  onAgentChange(change: AgentChange): void;
  /** 访问模式（架构设计 §3.12）：建好的会话取会话上的，新会话取草稿上的选择。随时可以切，下一轮生效。 */
  accessMode: AgentMode;
  onAccessModeChange(mode: AgentMode): void;
  busy: boolean;
  /** 忙的时候还能发：进排队，等这一轮结束（会话页）。 */
  queueWhileBusy?: boolean;
  stopping?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  /** @ 候选的范围：会话所在的项目，或它自己的工作目录。 */
  mentionScope: MentionScope;
  /** 发送；图片已经上传完，`skill` 是「+ › 使用 Skill」点选的那个。返回 false 表示没有发出去，保留草稿（含点选的 skill）。 */
  onSend(text: string, attachments: AttachmentRef[], skill?: SkillSendRef): Promise<boolean>;
  onStop?(): void;
  /** 输入框上方的引用标签（产品设计 §3.2.3）：随这条消息交给智能体的编辑器状态。可以移除。 */
  reference?: { label: string; description: string; onRemove(): void } | null;
  /**
   * 输入框上方：从 Space「在会话中继续」附上、还没发出的条目（架构设计 §5.7），随下一条消息交给智能体。
   * Runtime 只能一起去掉（`conversations.update` 的 `pendingReferences: null`），所以只有一个移除按钮。
   */
  spaceReferences?: { items: { id: string; label: string; description: string }[]; onClear(): void } | null;
  /** 输入框上方：排队等发送的消息。 */
  queue?: ReactNode;
  /** 新会话起始页（原型 new-agent.jsx `AgentHero`）才传；会话里不传，输入区保持原样。 */
  start?: ComposerStart;
  /** AI 工具参数页的提示词框（原型 tool-prompt.jsx）才传；正文由工具页持有，不进会话草稿。 */
  tool?: ComposerTool;
}

/**
 * AI 工具参数页的提示词框（产品设计 §5.10 参数页第 3、4 段）：同一个输入框，正文是工具页持有的提示词（没改过时是模板，
 * 跟着范围与勾选项变），没有 `/`（已经在工具页里了），`@` 与附件照旧；「+ › 使用 Skill」挂到工具页的 skill 列表上。
 * 工具栏里没有发送钮：主按钮在框下面，全宽、写明动作，再下面一行说清按下去会去哪。Enter 换行，不发送。
 */
export interface ComposerTool {
  /** 框里的话：没改过时是 `defaultText`。 */
  text: string;
  /** 用户改了正文。 */
  onText(text: string): void;
  /** 正文上方：挂着的 skill（工具页自己画，标着哪个是这个工具的做法）。 */
  tokens: ReactNode;
  /** 「+ › 使用 Skill」点选了一个。 */
  onSkill(id: string): void;
  /** 框与主按钮之间的说明行（没挂 skill 时的那一行）。 */
  notice?: ReactNode;
  /** 主按钮的字与它下面那行去向说明。 */
  cta: string;
  hint: string;
  /** 主按钮不能按（视频还没打开、勾选项全没选……）。 */
  isDisabled?: boolean;
  /** 按下主按钮：图片已经上传完。返回 false 表示没有交出去，附件留着。 */
  onStart(text: string, attachments: AttachmentRef[]): Promise<boolean>;
}

/** 起始页的输入框：模板 token 与素材、「+」菜单（文件和文件夹、使用 Skill、最近的视频）与拖放，正文空着时按附件判断能不能发。 */
export interface ComposerStart {
  /** 正文上方：点选的 skill、选中的模板、交给 Agent 的本机素材（起始页自己画 skill 标记，和模板排在一行）。 */
  tokens: ReactNode;
  /** 有没有一个 Agent 能用；没有时藏起访问模式与 Agent 选择，起始页下面换成指引卡。 */
  ready: boolean;
  /** 正文空着也能发：附了图片或素材（只选模板不算）。 */
  canSendEmpty(imageCount: number): boolean;
  /** 统一选择或拖放得到的本机文件与目录路径。 */
  onPaths(paths: readonly string[]): void;
  /**
   * 待填项（模板包规范 §5.5）：每加一，输入框拿回焦点并选中光标之后的下一个占位 token（到末尾从头找）。
   * 起始页在填入带占位符的提示词后、点「填下一处」时加；0 = 还没要求过。
   */
  selectSlot?: number;
  /** 「+ › 最近的视频」：选一个，这次会话就针对那个已有的视频。没有可列的视频时这一项不出现。 */
  recent: { items: readonly { id: string; label: string; description: string }[]; onPick(id: string): void };
}

/**
 * 输入区（产品设计 §3.2.3，原型 agent-thread.jsx `Composer`）：S2 AI 的 PromptField 管正文、附图、补全、发送与停止；
 * 工具栏里是「+」（文件和文件夹、使用 Skill、斜杠命令）、访问模式、Agent · 模型 · 推理强度。
 * Enter 发送，Shift+Enter 换行；输入法组合中的 Enter 只上屏不发送（TokenField 只在 insertParagraph 时提交）。
 */
export function Composer(props: ComposerProps) {
  const { draftKey, driverId, model, effort, lockedTo, onAgentChange, accessMode, onAccessModeChange } = props;
  const { busy, queueWhileBusy, stopping, placeholder, autoFocus, mentionScope, onSend, onStop, reference, queue, start, tool } = props;
  const spaceReferences = props.spaceReferences?.items.length ? props.spaceReferences : null;
  const runtime = useRuntime();
  const shellDraft = useShell((s) => s.drafts[draftKey] ?? '');
  const setShellDraft = useShell((s) => s.setDraft);
  // 工具页的提示词框：正文在工具页手里，不写会话草稿。
  const draft = tool ? tool.text : shellDraft;
  const setDraft = (key: string, text: string) => (tool ? tool.onText(text) : setShellDraft(key, text));
  const connected = useConnection((s) => s.state.status === 'connected');
  const drivers = useConnection((s) => s.drivers);
  // 找不到这个 Agent 的探测结果时一律显示「正在检测」：通常它在 `checking` 里（首次探测还没完）；
  // 极少数情况下它既不在结果里也不在 `checking` 里（这版 Runtime 没注册它），也按检测中处理，不另给一种状态。
  // 有结果但不可用（含磁盘缓存里旧的「没登录」）照旧 blocked，Runtime 启动后的后台刷新会推送纠正。
  const driver = drivers?.find((d) => d.id === driverId) ?? null;
  const entries = useSpace((s) => s.entries);
  const videoMentions = useVideoMentions(mentionScope);
  const images = useDraftImageList(draftKey);
  const files = useDraftFileList(draftKey);
  const [picking, setPicking] = useState(false);
  // 「+ › 使用 Skill」点选的那个（按草稿键存，一条消息最多一个）与 skill 列表（挂上、重连时取）。
  const skillId = useDraftSkillId(draftKey);
  const skills = useSkillsLoader();
  const skillName = skillId ? (skills.skills.find((s) => s.id === skillId)?.name ?? skillId) : null;
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [prompt, setPrompt, selectSlot] = usePromptValue(draft, (text) => setDraft(draftKey, text));
  const ref = useRef<ComponentRef<typeof PromptField>>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [previewAttachment, setPreviewAttachment] = useState<DraftImage | null>(null);
  useEffect(() => setPreviewAttachment(null), [draftKey]);
  // 保留正常留白时 520px 的内容断点（起始页没有留白）；量外框，避免 24 / 12px 留白使临界宽度来回切换。
  const compact = useNarrow(wrapRef, start ? 520 : 520 + 24 * 2, 'border-box');
  useEffect(() => {
    if (autoFocus) focusPromptEnd(ref.current?.UNSAFE_getDOMNode());
    // 只在挂上时聚焦一次，和原生 autoFocus 一样。
  }, []);
  // 选中下一处待填项（原型 ui.jsx PromptField 的 `selectSlot`）：TokenField 只在已聚焦时才把程序设的选区写回 DOM，所以先聚焦、稍等再选。
  // 失焦后再聚焦，TokenField 会按 DOM 把光标重设到末尾：从哪里往后找要在聚焦之前记下（选中的 token 或光标所在的片段）。
  const slotTick = start?.selectSlot ?? 0;
  useEffect(() => {
    if (!slotTick) return undefined;
    const from = prompt.selectedRange.end.index;
    ref.current?.UNSAFE_getDOMNode()?.querySelector<HTMLElement>('[role="textbox"]')?.focus();
    const id = window.setTimeout(() => selectSlot(from), 60);
    return () => window.clearTimeout(id);
    // 只跟着计数走；起点取这次渲染的值，选区按 state 里最新的值算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotTick]);

  const imagesOk = (driver?.capabilities.images ?? false) && runtime.host.supportsImageAttachments !== false;
  const driverReady = driver?.state === 'ready';
  const blocked = !connected
    ? S.composer.disconnected
    : driver && !driverReady
      ? S.composer.driverUnavailable(
          driver.name,
          localizeText(driver.detail, driver.detailRef) ?? DRIVER_STATE_REASON[driver.state as Exclude<typeof driver.state, 'ready'>],
        )
      : driver && images.some((i) => IMAGE_TYPES.includes(i.file.type as (typeof IMAGE_TYPES)[number])) && !imagesOk
        ? runtime.host.supportsImageAttachments === false
          ? COMPOSER_MENU.webFilesUnsupported
          : COMPOSER_MENU.imagesUnsupported(driver.name)
        : null;
  const uploading = images.some((image) => image.progress !== null);
  const hasText = draft.trim().length > 0;
  // 起始页：正文空着时，附了图片或素材也能发（只选模板不行）。
  const hasContent = hasText || !!files.length || !!images.length || (!!start && start.canSendEmpty(images.length));
  const canSend = (!busy || !!queueWhileBusy) && !sending && !picking && !uploading && !blocked && hasContent && !tool?.isDisabled;
  const [over, setOver] = useState(false);
  const dragDepth = useRef(0);

  const refocus = () =>
    // 「+」菜单关上时焦点先回到按钮（弹层动画约 400ms，同 InsertMenuButton），再把光标放回正文末尾。
    window.setTimeout(() => focusPromptEnd(ref.current?.UNSAFE_getDOMNode()), 400);

  const admit = (incoming: Pick<DraftImage, 'id' | 'file' | 'url'>[]) => {
    if (!incoming.length) return;
    const count = useDraftImages.getState().images[draftKey]?.length ?? 0;
    const { accepted, rejected } = (runtime.host.supportsFileAttachments ? admitFiles : admitImages)(
      count,
      incoming.map((entry) => ({ entry, type: entry.file.type, size: entry.file.size })),
    );
    const kept = new Set(accepted.map((a) => a.entry.id));
    for (const entry of incoming) if (!kept.has(entry.id)) URL.revokeObjectURL(entry.url);
    if (rejected)
      ToastQueue.negative(
        runtime.host.supportsFileAttachments
          ? rejected === 'size'
            ? PLAYER_COPY.tooLarge
            : HOME_COPY.materialsFull(MAX_ATTACHMENTS_PER_MESSAGE, incoming.length - accepted.length)
          : rejectionMessage(rejected),
        { timeout: 5000 },
      );
    useDraftImages.getState().add(
      draftKey,
      accepted.map((a) => a.entry),
    );
    setUploadError(null);
  };

  // PromptField 自己处理粘贴与拖放（只收 acceptedAttachmentTypes 里的格式）、点缩略图的 × 移除；这里只做校验与收回预览地址。
  const onAttachmentsChange = (next: PromptFieldAttachment[]) => {
    const nextIds = new Set(next.map((a) => a.id));
    const currentIds = new Set(images.map((i) => i.id));
    for (const image of images) if (!nextIds.has(image.id)) useDraftImages.getState().remove(draftKey, image.id);
    admit(next.filter((a) => !currentIds.has(a.id)).map((a) => ({ id: a.id, file: a.file, url: a.image })));
  };

  // 统一入口：图片沿用上传通道；本机文件与目录作为可移除引用交给 Agent。
  const addLocalFiles = (incoming: readonly MessageFile[]) => {
    if (start) start.onPaths(incoming.map((file) => file.path));
    else {
      const rejected = useDraftFiles.getState().add(draftKey, incoming);
      if (rejected) ToastQueue.neutral(HOME_COPY.materialsFull(MAX_ATTACHMENTS_PER_MESSAGE, rejected), { timeout: 5000 });
    }
  };
  const takeFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    const asImage = (file: File) => imagesOk && IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number]);
    admit(incoming.filter(asImage).map(imageEntry));
    const rest = incoming.filter((file) => !asImage(file));
    if (!rest.length) return;
    if (runtime.host.supportsFileAttachments) {
      admit(rest.map(imageEntry));
      return;
    }
    if (!runtime.host.pickMessageFiles) {
      ToastQueue.neutral(
        runtime.host.supportsImageAttachments === false || imagesOk
          ? COMPOSER_MENU.webFilesUnsupported
          : driver
            ? COMPOSER_MENU.imagesUnsupported(driver.name)
            : AGENT_PICKER.detecting,
        { timeout: 5000 },
      );
      return;
    }
    const paths = rest.map((file) => runtime.host.pathForFile(file));
    if (paths.some((path) => !path)) ToastQueue.negative(HOME_COPY.notLocalFile, { timeout: 5000 });
    addLocalFiles(paths.filter(Boolean).map((path) => ({ path, kind: 'file' })));
  };
  const pickLocalFiles = async () => {
    if (picking) return;
    if (!runtime.host.pickMessageFiles) {
      filePicker.current?.click();
      return;
    }
    setPicking(true);
    try {
      const selected = await runtime.host.pickMessageFiles({
        title: COMPOSER_MENU.filesAndFolders,
        filesLabel: COMPOSER_MENU.files,
        foldersLabel: COMPOSER_MENU.folders,
        cancelLabel: QUEUE_COPY.cancel,
        images: imagesOk,
      });
      admit(
        selected.flatMap((entry) =>
          entry.image
            ? [
                imageEntry(
                  new File([new Uint8Array(entry.image.bytes)], entry.path.split(/[\\/]/).pop() || entry.path, {
                    type: entry.image.mimeType,
                  }),
                ),
              ]
            : [],
        ),
      );
      addLocalFiles(selected.filter((entry) => !entry.image));
    } catch (error) {
      ToastQueue.negative(COMPOSER_MENU.pickFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setPicking(false);
      refocus();
    }
  };
  const carriesFiles = (event: DragEvent) => [...event.dataTransfer.types].includes('Files');
  const dropProps = {
    onDragEnterCapture: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepth.current++;
      setOver(true);
    },
    onDragOverCapture: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    },
    // 移进子元素时也会触发 dragleave：数进出的层数，全离开了才收起描边。
    onDragLeaveCapture: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.stopPropagation();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setOver(false);
    },
    onDropCapture: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepth.current = 0;
      setOver(false);
      takeFiles([...event.dataTransfer.files]);
    },
    // 只拦带文件的粘贴；粘贴文字照常进正文。
    onPasteCapture: (event: ClipboardEvent) => {
      const files = [...event.clipboardData.files];
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      takeFiles(files);
    },
  };

  const send = async () => {
    if (!canSend) return;
    const originalText = draft.trim();
    const sentFiles = files.map((file) => file.path);
    const text = sentFiles.length
      ? [originalText, COMPOSER_MENU.filesMessage(sentFiles)].filter(Boolean).join('\n\n')
      : originalText || (!start && images.length ? COMPOSER_MENU.filesMessage(images.map((image) => image.file.name)) : '');
    setSending(true);
    setUploadError(null);
    let attachments: AttachmentRef[];
    try {
      attachments = images.length
        ? await uploadDraftImages(draftKey, (file, onProgress) => runtime.uploadAttachment(file, onProgress))
        : [];
    } catch (error) {
      // 上传没成：文字与图片都留着，失败的那张标红，脚注说原因；再按发送只重传没传上的。
      setUploadError(ATTACHMENT_COPY.uploadFailed((error as Error).message));
      setSending(false);
      return;
    }
    if (tool) {
      // 工具页：正文留在框里（交出去之后工具页回到列表），只在交出去之后清掉附件。
      try {
        if (await tool.onStart(text, attachments)) {
          useDraftImages.getState().clear(draftKey);
          useDraftFiles.getState().sent(draftKey, sentFiles);
        }
      } finally {
        setSending(false);
      }
      return;
    }
    setDraft(draftKey, '');
    const picked = skillId;
    try {
      const ok = await onSend(text, attachments, picked ? { id: picked } : undefined);
      if (ok) {
        useDraftImages.getState().clear(draftKey);
        useDraftFiles.getState().sent(draftKey, sentFiles);
        // 发出去了：点选的 skill 跟着清掉（这期间换了别的就留着）。
        if (useDraftSkills.getState().skills[draftKey] === picked) useDraftSkills.getState().set(draftKey, null);
      } else setDraft(draftKey, originalText);
    } finally {
      setSending(false);
      focusPromptEnd(ref.current?.UNSAFE_getDOMNode());
    }
  };

  const changeAccessMode = (mode: AgentMode) => {
    onAccessModeChange(mode);
    // 任务在跑时切档：这一轮仍按发送时的那一档（原型 model-agent.js `modeToast`）。
    if (busy) {
      const show = mode === 'fullAccess' ? ToastQueue.info : ToastQueue.neutral;
      show(accessModeToast(mode), { timeout: 5000 });
    }
  };

  const renderCompletions = (filterValue: string) => {
    const before = prompt.slice({ index: 0, offset: 0 }, prompt.caretPosition).toString();
    const active = activeCompletion(before);
    if (!active || active.raw !== filterValue) return null;
    if (active.kind === 'slash') {
      // 工具页里没有 `/`：已经在一个工具里了。
      if (tool) return null;
      const matches = slashMatches(active.query);
      return matches.length ? matches.map((command) => <SlashItem key={command.cmd} command={command} insert />) : null;
    }
    const candidates = mentionCandidates(entries, mentionScope, active.query);
    // 打开的视频里的章节与说话人排在前面一组（设计稿 model-agent.js `mentionItems`：先本视频，再别的）。
    const fromVideo = videoMentions ? videoMentionCandidates(videoMentions, active.query) : [];
    if (!candidates.length && !fromVideo.length) {
      return active.query
        ? null
        : [
            <MenuItem key="none" id="none" isDisabled textValue={COMPOSER_MENU.noMentionCandidates}>
              <Text slot="label">{COMPOSER_MENU.noMentionCandidates}</Text>
            </MenuItem>,
          ];
    }
    const item = (candidate: MentionCandidate) => (
      <InsertTextMenuItem key={candidate.id} id={candidate.id} text={candidate.insert} textValue={candidate.label}>
        <Text slot="label">{candidate.label}</Text>
        <Text slot="description">{candidate.description}</Text>
      </InsertTextMenuItem>
    );
    if (!fromVideo.length) return candidates.map(item);
    const group = (key: string, title: string, list: MentionCandidate[]) => (
      <MenuSection key={key} id={key}>
        <Header>
          <Heading>{title}</Heading>
        </Header>
        {list.map(item)}
      </MenuSection>
    );
    return [
      group('video', MENTION_GROUPS.video, fromVideo),
      ...(candidates.length ? [group('files', MENTION_GROUPS.files, candidates)] : []),
    ];
  };

  // PromptFieldSubmitButton 只在它能动作时出现；停不了、发不了的时候换成同样外观的禁用钮（原型 ui.jsx）。
  const submit = busy ? (
    onStop && connected && !stopping ? (
      <PromptFieldSubmitButton />
    ) : (
      <Button variant="primary" size="S" isDisabled aria-label={stopping ? S.composer.stopping : S.composer.stop}>
        <StopProcessing />
      </Button>
    )
  ) : blocked || sending || uploading ? (
    <Button variant="primary" size="S" isDisabled aria-label={S.composer.send}>
      <ArrowUpSend />
    </Button>
  ) : !hasText ? (
    // PromptFieldSubmitButton 在正文空着时总是禁用；只附了图片、文件或素材也要能发。
    <Button variant="primary" size="S" isDisabled={!canSend} aria-label={S.composer.send} onPress={() => void send()}>
      <ArrowUpSend />
    </Button>
  ) : (
    <PromptFieldSubmitButton />
  );

  const attachments: PromptFieldAttachment[] = images.map((image) => ({ id: image.id, file: image.file, image: image.url }));
  const byId = new Map(images.map((image) => [image.id, image]));
  const footText =
    blocked ??
    uploadError ??
    (driver ? composerFoot(driver.name, localizeText(driver.account, driver.accountRef) ?? null, accessMode) : AGENT_PICKER.detecting);
  // 窄的时候省掉说明性的脚注（原型 compact），挡住发送的原因照样显示。
  // 起始页的设计稿没有脚注：只留上传失败与挡住发送的原因；Agent 都用不了时下面有指引卡，不再重复。
  // 工具页的提示词框也没有脚注（原型 tool-prompt.jsx）：按键说明不适用（Enter 换行、没有 /），去向写在主按钮下面。
  const showFoot = start
    ? !!uploadError || (!!blocked && start.ready)
    : tool
      ? !!uploadError || !!blocked
      : !(compact && !blocked && !uploadError);
  const showPickers = !start || start.ready;
  const accessPicker = <AccessPicker value={accessMode} compact={compact} onChange={changeAccessMode} />;

  // 「+ › 使用 Skill ▸」（原型 composer-insert-menu.jsx）：全部 skill，开着的在前；末尾「管理 Skills…」去设置。
  // 还没取到、取不到或一个都没有时，只有一行说明和「管理 Skills…」。
  const skillItems = skillMenuItems(skills.skills);
  const skillNote = !skills.loaded ? (skills.status === 'failed' ? SKILL_COPY.loadFailed : SKILL_COPY.loading) : SKILL_COPY.none;
  const skillMenu = (
    <SubmenuTrigger>
      <MenuItem id="skill" textValue={SKILL_COPY.use}>
        <MagicWand />
        <Text slot="label">{SKILL_COPY.use}</Text>
      </MenuItem>
      <Menu
        aria-label={SKILL_COPY.use}
        size="M"
        styles={insertMenu}
        onAction={(key) => {
          const id = String(key);
          if (id === 'manage') {
            useShell.getState().go({ tab: 'settings', section: 'skills' });
            return;
          }
          if (!id.startsWith('skill:')) return;
          if (tool) tool.onSkill(id.slice('skill:'.length));
          else useDraftSkills.getState().set(draftKey, id.slice('skill:'.length));
          refocus();
        }}
      >
        <MenuSection aria-label={SKILL_COPY.use}>
          {skillItems.length ? (
            skillItems.map((item) => (
              <MenuItem key={item.id} id={`skill:${item.id}`} textValue={item.name}>
                <Code />
                <Text slot="label">{item.name}</Text>
                {item.description ? <Text slot="description">{item.description}</Text> : null}
              </MenuItem>
            ))
          ) : (
            <MenuItem id="none" isDisabled textValue={skillNote}>
              <Text slot="label">{skillNote}</Text>
            </MenuItem>
          )}
        </MenuSection>
        <MenuSection aria-label={SKILL_COPY.manage}>
          <MenuItem id="manage" textValue={SKILL_COPY.manage}>
            <Settings />
            <Text slot="label">{SKILL_COPY.manage}</Text>
          </MenuItem>
        </MenuSection>
      </Menu>
    </SubmenuTrigger>
  );
  // 打开「+」时顺手重取一次 skill 列表：别的窗口刚添加、移除的也能列出来（旧的列表照常显示）。
  const onInsertOpen = (open: boolean) => {
    if (open && connected) skills.retry();
  };

  // product-design §3.2.3：两个输入区共用同一个附件首项；已有内容继续通过 @ 补全引用。
  const insert = (
    <MenuTrigger align="start" direction="top" onOpenChange={onInsertOpen}>
      <ActionButton isQuiet size="S" aria-label={COMPOSER_MENU.attachSection}>
        <Add />
      </ActionButton>
      <Menu
        aria-label={COMPOSER_MENU.attachSection}
        size="M"
        styles={insertMenu}
        onAction={(key) => {
          if (key === 'files') void pickLocalFiles();
        }}
      >
        <MenuSection aria-label={COMPOSER_MENU.attachSection}>
          <Header>{COMPOSER_MENU.attachSection}</Header>
          <MenuItem
            id="files"
            textValue={COMPOSER_MENU.filesAndFolders}
            isDisabled={picking || (!runtime.host.pickMessageFiles && runtime.host.supportsImageAttachments === false)}
          >
            <Attach />
            <Text slot="label">{COMPOSER_MENU.filesAndFolders}</Text>
            {!runtime.host.pickMessageFiles && runtime.host.supportsImageAttachments === false ? (
              <Text slot="description">{COMPOSER_MENU.webFilesUnsupported}</Text>
            ) : null}
          </MenuItem>
          {skillMenu}
          {start?.recent.items.length ? (
            <SubmenuTrigger>
              <MenuItem id="recent" textValue={HOME_COPY.recentVideos}>
                <Filmstrip />
                <Text slot="label">{HOME_COPY.recentVideos}</Text>
              </MenuItem>
              <Menu aria-label={HOME_COPY.recentVideos} size="M" styles={insertMenu} onAction={(key) => start.recent.onPick(String(key))}>
                {start.recent.items.map((item) => (
                  <MenuItem key={item.id} id={item.id} textValue={item.label}>
                    <Video />
                    <Text slot="label">{item.label}</Text>
                    <Text slot="description">{item.description}</Text>
                  </MenuItem>
                ))}
              </Menu>
            </SubmenuTrigger>
          ) : null}
        </MenuSection>
        {!start && !tool ? (
          <MenuSection aria-label={COMPOSER_MENU.slash}>
            <SubmenuTrigger>
              <MenuItem id="slash" textValue={COMPOSER_MENU.slash}>
                <Tools />
                <Text slot="label">{COMPOSER_MENU.slash}</Text>
              </MenuItem>
              <Menu
                aria-label={COMPOSER_MENU.slash}
                size="M"
                styles={insertMenu}
                onAction={(key) => {
                  setDraft(draftKey, applySlash(draft, String(key)));
                  refocus();
                }}
              >
                {SLASH_COMMANDS.map((command) => (
                  <SlashItem key={command.cmd} command={command} />
                ))}
              </Menu>
            </SubmenuTrigger>
          </MenuSection>
        ) : null}
      </Menu>
    </MenuTrigger>
  );

  return (
    <div ref={wrapRef} className={wrap({ isCompact: compact, isStart: !!start || !!tool })}>
      {queue}
      <input
        ref={filePicker}
        type="file"
        hidden
        multiple
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          takeFiles(files);
          refocus();
        }}
      />
      <div
        data-composer={draftKey}
        data-composer-start={start ? '' : undefined}
        className={start || tool ? dropZone({ isOver: over }) : undefined}
        {...dropProps}
        onKeyDownCapture={tool ? (event) => toolEnter(event, prompt, setPrompt) : undefined}
      >
        <PromptField
          ref={ref}
          size="S"
          variant="subtle"
          value={prompt}
          onChange={setPrompt}
          attachments={attachments}
          onAttachmentsChange={onAttachmentsChange}
          acceptedAttachmentTypes={runtime.host.supportsFileAttachments ? ['*/*'] : imagesOk ? IMAGE_TYPES : undefined}
          onSubmit={() => void send()}
          isGenerating={busy}
          onStop={onStop}
          aiDisclaimer={<></>}
        >
          {start?.tokens}
          {tool?.tokens}
          {!!files.length && (
            <div className={composerTokenList}>
              {files.map((file) => (
                <ComposerToken
                  key={file.path}
                  icon={file.kind === 'directory' ? <Folder /> : <FileText />}
                  label={file.path.split(/[\\/]/).filter(Boolean).pop() || file.path}
                  title={file.path}
                  onOpen={() => {
                    if (file.kind === 'directory') {
                      void runtime.host.revealPath(file.path);
                      return;
                    }
                    const target = mentionScope.projectId
                      ? { projectId: mentionScope.projectId, path: file.path }
                      : mentionScope.conversationId
                        ? { conversationId: mentionScope.conversationId, path: file.path }
                        : null;
                    const external = () =>
                      runtime.host.openFile?.(file.path).then((error) => {
                        if (error) ToastQueue.negative(error);
                        else if (error === null) void runtime.host.revealPath(file.path);
                      });
                    if (!target) {
                      void external();
                      return;
                    }
                    void runtime
                      .resolveMedia(target)
                      .then(() => useShell.getState().openPane({ kind: 'file', target }))
                      .catch(() => void external());
                  }}
                  removeLabel={HOME_COPY.removeMaterial(file.path)}
                  onRemove={() => useDraftFiles.getState().remove(draftKey, file.path)}
                />
              ))}
            </div>
          )}
          {/* 会话输入框上点选的 skill（起始页的画在 start.tokens 里，和模板一排）。 */}
          {!start && !tool && skillId && skillName ? (
            <div className={composerTokenList}>
              <ComposerToken
                icon={<Code />}
                label={SKILL_COPY.token(skillName)}
                removeLabel={SKILL_COPY.remove(skillName)}
                onRemove={() => useDraftSkills.getState().set(draftKey, null)}
              />
            </div>
          ) : null}
          {reference || spaceReferences ? (
            <div className={tags}>
              {reference ? (
                <span className={tag} title={reference.description}>
                  <MovieCamera />
                  <span className={tagText}>{reference.label}</span>
                  <ActionButton isQuiet size="XS" aria-label={S.composer.dropEditorState} onPress={reference.onRemove}>
                    <Close />
                  </ActionButton>
                </span>
              ) : null}
              {spaceReferences ? (
                <span className={tag} role="group" aria-label={S.composer.spaceEntries}>
                  <Asset />
                  {spaceReferences.items.map((item, index) => (
                    <span key={item.id} className={tagText} title={item.description}>
                      {index ? S.separator : ''}
                      {item.label}
                    </span>
                  ))}
                  <ActionButton isQuiet size="XS" aria-label={S.composer.dropSpaceEntries} onPress={spaceReferences.onClear}>
                    <Close />
                  </ActionButton>
                </span>
              ) : null}
            </div>
          ) : null}
          <div
            onClickCapture={(event) => {
              const target = event.target as HTMLElement;
              if (!target.closest('button'))
                target.closest('[role="row"]')?.querySelector<HTMLButtonElement>('.bc-composer-attachment-open')?.click();
            }}
            onKeyDownCapture={(event) => {
              const target = event.target as HTMLElement,
                button =
                  target.getAttribute('role') === 'row' ? target.querySelector<HTMLButtonElement>('.bc-composer-attachment-open') : null;
              if (event.key === 'Enter' && button) {
                event.preventDefault();
                event.stopPropagation();
                button.click();
              }
            }}
          >
            <PromptFieldAttachmentList dependencies={[images]}>
              {(attachment) => {
                const image = byId.get(attachment.id);
                return (
                  <Attachment
                    textValue={attachment.file.name}
                    aria-label={image?.error ?? attachment.file.name}
                    uploadProgress={image?.progress ?? undefined}
                    isInvalid={!!image?.error}
                  >
                    <ActionButton
                      slot={null}
                      isQuiet
                      aria-label={`${IMAGE_COPY.openAttachment}: ${attachment.file.name}`}
                      onPress={() => {
                        if (image) setPreviewAttachment(image);
                      }}
                      UNSAFE_className="bc-composer-attachment-open"
                    >
                      <AttachmentPreview
                        mimeType={attachment.file.type}
                        src={attachment.file.type.startsWith('image/') ? attachment.image : undefined}
                        alt={attachment.file.name}
                      />
                      {!attachment.file.type.startsWith('image/') && <span>{attachment.file.name}</span>}
                    </ActionButton>
                  </Attachment>
                );
              }}
            </PromptFieldAttachmentList>
          </div>
          <div role="group" aria-label={S.composer.message}>
            <PromptTokenField
              placeholder={placeholder}
              completionTrigger={COMPLETION_TRIGGER}
              renderCompletions={renderCompletions}
              menuWidth={320}
            />
          </div>
          <PromptFieldToolbar>
            <div className={toolbar({ isCompact: compact })}>
              {insert}
              {start ? null : accessPicker}
              <span className={spacer} />
              {/* 起始页按设计稿把访问模式放在右边，和 Agent 选择挨着；没有一个 Agent 能用时两个都藏起来。 */}
              {start && showPickers ? accessPicker : null}
              {showPickers ? (
                <AgentPicker
                  drivers={drivers}
                  driverId={driverId}
                  model={model}
                  effort={effort}
                  lockedTo={lockedTo}
                  compact={compact}
                  onChange={onAgentChange}
                />
              ) : null}
              {tool ? null : submit}
            </div>
          </PromptFieldToolbar>
        </PromptField>
        {previewAttachment && (
          <DraftAttachmentPreview
            key={previewAttachment.id}
            entry={previewAttachment}
            entries={images}
            draftKey={draftKey}
            conversationId={mentionScope.conversationId}
            onClose={() => setPreviewAttachment(null)}
          />
        )}
      </div>
      {showFoot ? (
        <div className={foot({ isError: !blocked && !!uploadError })} role={uploadError ? 'alert' : undefined}>
          {footText}
        </div>
      ) : null}
      {tool ? (
        <>
          {tool.notice}
          <Button variant="accent" styles={toolCta} isDisabled={!canSend} isPending={sending} onPress={() => void send()}>
            {tool.cta}
          </Button>
          <p className={toolHint}>{tool.hint}</p>
        </>
      ) : null}
    </div>
  );
}

/**
 * 提示词框里的 Enter 换行、不发送（主按钮在框下面）。PromptField 总把 Enter 当提交，所以在它之前接住；
 * 补全弹层开着（选候选）、输入法组合中、带修饰键时照旧交给它。
 */
function toolEnter(event: KeyboardEvent<HTMLDivElement>, value: PromptFieldValue, setValue: (value: PromptFieldValue) => void) {
  const target = event.target as HTMLElement;
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;
  if (target.getAttribute('role') !== 'textbox' || target.getAttribute('aria-expanded') === 'true') return;
  event.preventDefault();
  event.stopPropagation();
  const { start, end } = value.selectedRange;
  setValue(value.replaceRange(start, end, '\n'));
}

/** 斜杠命令一行：图标、`/命令 · 标签`、一句副文案。`insert`：补全弹层里用，选中替换正在敲的 /token。 */
function SlashItem({ command, insert }: { command: SlashCommand; insert?: boolean }) {
  const Icon = SLASH_ICON[command.icon];
  const content = (
    <>
      <Icon />
      <Text slot="label">{`${command.label} · ${command.cmd}`}</Text>
      <Text slot="description">{command.sub}</Text>
    </>
  );
  return insert ? (
    <InsertTextMenuItem id={command.cmd} text={command.cmd} textValue={command.cmd}>
      {content}
    </InsertTextMenuItem>
  ) : (
    <MenuItem id={command.cmd} textValue={command.cmd}>
      {content}
    </MenuItem>
  );
}
