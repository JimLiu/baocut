import { defineMessages, live, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, type AgentMode, type DriverState, type JobPhase, type ModelTier, type TaskStatus } from '@baocut/protocol';
import { zhHans } from './copy.zh-Hans.ts';
import { zhHant } from './copy.zh-Hant.ts';
import { ja } from './copy.ja.ts';
import { ko } from './copy.ko.ts';
import { es } from './copy.es.ts';
import { fr } from './copy.fr.ts';
import { de } from './copy.de.ts';
import { nl } from './copy.nl.ts';
import { ptBR } from './copy.pt-BR.ts';
import { it } from './copy.it.ts';
import { ru } from './copy.ru.ts';
import { pl } from './copy.pl.ts';
import { tr } from './copy.tr.ts';
import { vi } from './copy.vi.ts';

/**
 * 界面里多处共用的文案。英文写在这里，译文在 `copy.zh-Hans.ts`；同一个概念只用一个词，见 docs/glossary.md。
 * 读当前语言的文字要在渲染或调用时读（`M.x`、`revealLabel()`），不要在模块顶层读进常量。
 * 下面的具名导出（`ACCESS_MODE_LABEL`、`TASK_VIEW_COPY`…）都是 `live` 包装：每次读属性取当前语言。
 */
const en = {
  /** 打开系统的文件管理器并选中目标。所有平台同一个说法，不写某个平台专有的文件管理器名字（docs/glossary.md）。 */
  reveal: 'Show in Folder',
  untitled: 'New session',
  /** 用户消息上方已发送的图片（原型 agent-thread.jsx `UserMsg`）。 */
  sentAttachments: 'Sent files',
  /** 任务在跑时切换访问模式的提示（原型 model-agent.js `modeToast` 的运行中分支）。 */
  accessModeToast: (label: string) => `The next turn will use “${label}”. This turn keeps its current access mode.`,
  /** composer 脚注（原型 model-agent.js `composerFoot`）：在哪儿跑、用谁的订阅（空串表示没有账号名）、这一档会不会问你、快捷键。 */
  composerFoot: (name: string, account: string, foot: string) =>
    `Runs in ${name} on this computer, ${account ? `using your ${account}` : 'using your own subscription'}. ${foot} Enter to send, Shift+Enter for a new line, @ to reference, / for commands.`,

  /**
   * 访问模式（架构设计 §3.12，原型 data.js `agent.modes`）。原型只画四档；「先给方案」是协议里独立的一档，
   * 输入框下拉只在会话已经处在这一档时列出它（例如经 CLI 切过去的）。
   */
  accessModeLabel: {
    plan: 'Plan first',
    ask: 'Supervised',
    autoAcceptEdits: 'Auto-accept edits',
    auto: 'Auto',
    fullAccess: 'Full access',
  },
  accessModeHint: {
    plan: 'Read-only. Proposes a plan first and never changes files or videos',
    ask: 'Asks before running commands or changing files',
    autoAcceptEdits: 'Approves file changes automatically and asks before anything else',
    auto: 'Approves routine actions automatically; still asks before risky ones',
    fullAccess: 'Runs commands and changes files without asking',
  },
  taskStatusLabel: {
    running: 'Working',
    stopping: 'Stopping',
    completed: 'Done',
    stopped: 'Stopped',
    failed: 'Failed',
  },
  /** composer 脚注的中段：这一档到底会不会问你（原型 model-agent.js `modeFoot`）。 */
  accessModeFoot: {
    plan: 'Plans only and won’t change the video.',
    ask: 'Asks you before every write to the video.',
    autoAcceptEdits: 'Video file changes are allowed automatically; other commands still ask you.',
    auto: 'Routine actions are allowed automatically; risky ones still ask you.',
    fullAccess: 'Writes to the video without asking each time.',
  },
  /** 模型定位（原型 model-agent-setup.js `TIERS`）。 */
  modelTierLabel: { balanced: 'Recommended', max: 'Most capable', fast: 'Fastest' },
  /**
   * 推理强度（原型 data.js `agent.efforts`）：原生 id → 名字与代价。原型的 `mid` 在 Claude 与 Codex 里叫 `medium`。
   * 原型给「中」的副文案是「默认」：这里改成标在模型自己的默认强度那一行（见 agent-choice.ts `effortRows`）。
   */
  effort: {
    low: { label: 'Low', sub: 'Fast, good for small changes' },
    medium: { label: 'Medium', sub: null },
    high: { label: 'High', sub: 'Slower, thinks longer' },
  },
  agentPicker: {
    group: 'Coding agent',
    models: 'Models',
    effort: (label: string) => `Reasoning effort · ${label}`,
    agentDefault: 'Agent’s default model',
    agentDefaultSub: 'Chosen by the CLI’s configuration',
    configModelGate: (model: string) => `${model} needs a newer CLI`,
    notListed: 'This model isn’t in the current list',
    defaultMark: 'Default',
    localAccount: 'This computer',
    settings: 'Settings › Agents…',
    settingsSub: 'Coding agent · Subscription · Approval policy',
    /** 会话有任务后 Agent 固定（架构设计 §3.11：原生会话不能跨 Agent 续）。 */
    locked: 'This session has already started, so its agent can’t change. Start a new session to switch.',
    detecting: 'Detecting agents…',
  },
  /** Agent 用不了时第一级那一行的副文案（原型 model-agent.js `providerRows`，状态词取 model-agent-setup.js `badge`）。 */
  driverStateReason: {
    disabled: 'Turned off in Settings',
    'not-installed': 'Not installed',
    'signed-out': 'Needs sign-in · Check in Settings',
    outdated: 'Version too old · Check in Settings',
    error: 'Can’t run · Check in Settings',
  },
  /** 斜杠命令的名字与说明，键是去掉 `/` 的命令名（`SLASH_COMMANDS`）。 */
  slash: {
    polish: { label: 'Polish transcript', sub: 'Fix typos, add punctuation, split paragraphs' },
    chapters: { label: 'Generate chapters', sub: 'Split by topic and add titles' },
    speakers: { label: 'Identify speakers', sub: 'Put names on subtitles and the transcript' },
    retranscribe: { label: 'Re-transcribe', sub: 'Rerun the audio with another speech model' },
    clean: { label: 'Find cuttable bits', sub: 'Filler words, long pauses, flubbed takes' },
    translate: { label: 'Translate subtitles', sub: 'Translate into one language and align timecodes' },
    refresh: { label: 'Refresh stale translations', sub: 'Retranslate only lines whose source changed' },
    dub: { label: 'Translated voice-over', sub: 'Make the video speak another language' },
    summary: { label: 'Write a summary', sub: 'A summary plus timestamped key points' },
    blog: { label: 'Write a blog post', sub: 'Rewrite it as an article' },
    title: { label: 'Suggest titles', sub: 'A few candidates from different angles' },
    desc: { label: 'Write a description', sub: 'With chapter timecodes and tags' },
    cover: { label: 'Make a cover', sub: 'A few candidates based on key frames' },
    export: { label: 'Export', sub: 'SRT / MP4 with burned-in subtitles' },
  },
  composerMenu: {
    insert: 'Insert',
    filesAndFolders: 'Files and folders',
    files: 'Files', folders: 'Folders',
    filesMessage: (paths: readonly string[]) => `Files and folders:\n${paths.map(path => JSON.stringify(path)).join('\n')}`,
    pickFailed: (message: string) => `Couldn’t select files: ${message}`,
    webFilesUnsupported: 'Add local files and folders in BaoCut desktop. Uploads aren’t available in the Web client yet.',
    /** @ 补全保留视频与文件引用；不再在 + 菜单里重复列出。 */
    mention: 'Reference a video or file',
    slash: 'Use a tool',
    /** + 菜单：统一附件入口在首项，工具在下一组。 */
    attachSection: 'Add',
    referSection: 'References and commands',
    imagesUnsupported: (driverName: string) => `${driverName} doesn’t accept images`,
    noMentionCandidates: 'No videos or files to reference here yet',
  },
  /** 输入框「+ › 使用 Skill」、输入框上的 skill 标记与会话消息上的标记（产品设计 §3.2.3、§6.9；原型 composer-insert-menu.jsx）。 */
  skill: {
    use: 'Use a skill',
    manage: 'Manage skills…',
    loading: 'Loading skills…',
    none: 'No skills yet. Add one from a local folder in Settings, or import from GitHub',
    loadFailed: 'Couldn’t load skills',
    token: (name: string) => `Skill: ${name}`,
    remove: (name: string) => `Remove skill: ${name}`,
  },
  /** 附图（原型 agent-thread.jsx `composerImageFiles` 与 `addImages`）。 */
  attachment: {
    tooLarge: `Choose images no larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB`,
    tooMany: `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} images`,
    /** 原型只收 image/*；协议只收这四种（limits.ts），多出来的一句。 */
    badType: 'Only PNG, JPEG, GIF, or WebP images can be attached',
    uploadFailed: (message: string) => `Couldn’t upload the image: ${message}`,
    httpFailed: (status: number) => `Upload failed (HTTP ${status})`,
    networkFailed: 'Upload failed: can’t reach the Runtime',
    uploading: 'Uploading images…',
  },
  /** 忙时排队（会话有任务在跑时发的话）。 */
  queue: {
    title: (count: number) => `Queued to send · ${count}`,
    images: (count: number) => (count === 1 ? '1 image' : `${count} images`),
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Delete',
    sendNow: 'Send now',
    editLabel: 'Edit queued message',
    steerUnsupported: 'This agent can’t take messages mid-task. It will be sent when the current task ends',
    skillWaits: 'Messages with a skill can’t join the turn in progress. It will be sent when the turn ends',
    failed: (message: string) => `Couldn’t send the queued message: ${message}`,
    busyPlaceholder: 'The agent is working. Messages you send now are queued until this turn ends',
  },
  /** 任务失败后的恢复区（原型 agent-thread.jsx `ErrorMsg`）。 */
  recovery: {
    authTitle: (name: string) => `${name} needs you to sign in again`,
    authBody: (name: string) =>
      `You sign in inside ${name}’s own window; BaoCut never handles your account or password. Come back and resend once you’re signed in.`,
    openLogin: 'Sign in from Terminal',
    loginOpened: (command: string) => `Running ${command} in a terminal · Come back and resend once you’re signed in`,
    loginCopied: 'Couldn’t open a terminal. The sign-in command is copied; paste it into a terminal to run it',
    loginManual: (command: string) => `Couldn’t open a terminal. Run ${command} in a terminal`,
    modelTitle: (model: string | null) => `${model ?? 'This model'} isn’t available right now`,
    modelBody: 'Pick another model and resend. BaoCut won’t switch models on its own.',
    pickModel: 'Resend with another model',
    resend: 'Resend',
    retry: 'Try again',
    agentSettings: 'Agent settings',
    nothingToResend: 'Can’t find this turn’s message to resend',
    resendFailed: (message: string) => `Couldn’t resend: ${message}`,
  },
  /** 审批卡（原型 agent-thread.jsx `PermissionMsg`，自动允许的那一行取 model-agent.js `autoAllowLabel`）。 */
  approval: {
    title: {
      command: 'The agent wants to run a command',
      'file-change': 'The agent wants to change files',
      tool: 'The agent wants to use a tool',
      highRisk: 'The agent wants to do something risky',
    },
    kind: { command: 'Run command', 'file-change': 'Change files', tool: 'Use tool' },
    projectFiles: 'Files in the project',
    inDir: (dir: string) => `In ${dir}`,
    allow: 'Allow',
    allowAlways: (rule: string) => `Always allow ${rule}`,
    decline: 'Decline',
    accepted: 'Allowed',
    acceptedAlways: (rule: string) => `Allowed · Won’t ask about ${rule} again`,
    declined: 'Declined',
    cancelled: 'Stopped',
    autoRule: (rule: string | null) => (rule ? `Allowed automatically · Rule ${rule}` : 'Allowed automatically · Rule'),
    autoMode: 'Allowed automatically · Access mode',
    input: 'Input summary',
    copyInput: 'Copy input summary',
    failed: (message: string) => `Couldn’t submit: ${message}`,
  },
  /** 变更卡的撤销与恢复（原型 agent-thread.jsx `ReceiptMsg`）。 */
  change: {
    undone: 'Undone · Changes reverted',
    undo: 'Undo',
    restore: 'Restore',
    openVideo: 'Open video',
    confirmTitle: 'Undo this step?',
    /**
     * 「恢复」只在这一笔还是你最近一次撤销、之后你没再改这个视频时才有（见 change-card.tsx），不说「随时」。
     */
    confirmBody: 'The changes this step wrote to the video will be removed. Until you edit this video again, you can bring them back with Restore.',
    cancel: 'Cancel',
    undoneToast: 'Undone',
    restoredToast: 'Restored',
    alreadyUndone: 'This step was already undone',
    undoFailed: (message: string) => `Couldn’t undo: ${message}`,
    restoreFailed: (message: string) => `Couldn’t restore: ${message}`,
  },
  /**
   * 空会话（原型 agent-thread.jsx `AgentThread` 的空态，建议取 data.js `agent.chips`）。
   * 原型说明句里的「@ 可以引用章节、说话人、译文」「写入之前一定先问你」「把视频拖进来」这里还做不到
   * （@ 只列视频与文件；问不问看访问模式；会话里不能拖入视频），只留做得到的部分。
   */
  threadEmpty: {
    greetVideo: (name: string) => `What should we do with “${name}”?`,
    greet: 'What can the agent do for you?',
    subVideo: 'It reads this video first and gives you a plan. Use @ to reference other videos or files.',
    sub: 'Start by describing what you want done. It runs in the coding agent on your computer, using your own subscription.',
    suggestions: 'Try asking',
    chipsVideo: [
      'Remove filler words from this chapter',
      'Give each chapter a shorter title',
      'Find repeated sections that can be cut',
      'Make terms match the glossary',
    ],
    chips: [
      'Add subtitles to this video and translate them into English',
      'Find filler words and long pauses, list them before cutting',
      'Split this episode into chapters with titles',
      'Export bilingual SRT and an MP4 with burned-in subtitles',
    ],
  },
  /** 产物卡（原型 home-session.jsx `SessionArtifactCard`、`SessionMoviePreview`、`SessionMessageArtifacts`）。 */
  output: {
    playVideo: (name: string) => `Play video “${name}”`,
    noThumbnail: 'No thumbnail',
    sourceMissing: 'Source file not found',
    openEditor: 'Open editor',
    openVideo: (name: string) => `Open video “${name}”`,
    playHere: 'Play on the right',
    previewHere: 'Preview on the right',
    reveal: 'Show in Folder',
    messageOutputs: 'Message outputs',
  },
  /**
   * 线程里的视频卡与下载卡（产品设计 §3.2.2、§6.5；原型 home-session.jsx `SessionArtifactCard`、agent-cards.jsx `JobRow` / `DownloadCard`）。
   * 状态词与 Space 的视频状态同一套说法。
   */
  videoCard: {
    agentTranslating: 'Agent translating line by line',
    sentenceTotal: (n: number) => (n === 1 ? '1 line total' : `${n} lines total`),
    status: { translating: 'Translating', transcribing: 'Transcribing', queued: 'Queued', transcribed: 'Transcribed', failed: 'Failed' },
    rows: 'Work on this video',
    retranscribe: 'Re-transcribe',
    translate: 'Translate',
    linkImport: 'Import from link',
    tail: { queued: 'Queued', done: 'Done', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', unknown: 'Result unknown' },
    elapsed: (clock: string) => `${clock} elapsed`,
    recognized: (done: string, total: string | null) => (total ? `Recognized ${done} / ${total}` : `Recognized ${done}`),
    segments: (done: number, total: number | null) => (total != null ? `Recognized ${done} / ${total} segments` : `Recognized ${done} segments`),
    translated: (done: number, total: number | null) => (total != null ? `Translated ${done} / ${total} lines` : `Translated ${done} lines`),
    downloaded: (text: string) => `Downloaded ${text}`,
    documentWritten: 'Transcript written to the video',
    notFinished: 'This step didn’t finish',
    retrying: 'Retrying automatically after an error',
    play: 'Play',
    reveal: 'Show in Folder',
    cancel: 'Cancel',
    retry: 'Try again',
    warning: {
      'no-speech': 'No speech detected',
      'no-audio-track': 'The video has no audio track',
      'diarization-unavailable': 'This model can’t tell speakers apart',
    } as Record<string, string>,
    download: {
      queued: 'Waiting to download',
      running: 'Downloading video',
      done: 'Download complete',
      failed: 'Download didn’t finish',
      cancelled: 'Download cancelled',
      interrupted: 'Download interrupted',
      fallbackName: 'Video',
    },
    openFailed: (message: string) => `Couldn’t open: ${message}`,
    retryFailed: (message: string) => `Couldn’t try again: ${message}`,
  },
  /** Home 起始页（产品设计 §3.2.1；原型 page-new.jsx Home、new-agent.jsx）。 */
  home: {
    title: 'What video do you want to make?',
    templates: 'Templates',
    quickStart: 'Quick start',
    blankVideo: 'New blank video',
    blankVideoTip: 'No transcription, no queue — straight to the editor',
    blankVideoCreated: 'Blank video created',
    blankVideoFailed: (message: string) => `Couldn’t create a blank video: ${message}`,
    /** 没选项目时新建空白视频，先建一个这样命名的项目。 */
    blankVideoProject: 'Blank video',
    removeTemplate: 'Remove template',
    templateToken: (title: string) => `Template: ${title}`,
    allTemplates: 'All templates',
    searchTemplates: 'Search templates',
    templateKind: 'Type',
    templateSource: 'Source',
    templateCategories: 'Categories',
    viewTemplate: (title: string) => `View template: ${title}`,
    useExampleLabel: (title: string) => `Use prompt: ${title}`,
    useTemplateLabel: (title: string) => `Use template: ${title}`,
    templatePicked: 'Selected',
    exampleBadge: 'Example',
    templatePage: (page: number, pages: number, total: number) => `Page ${page} of ${pages} · ${total} total`,
    prevPage: 'Previous page',
    nextPage: 'Next page',
    noTemplates: 'No matching templates. Try another word or category.',
    templatesEmpty: 'The template folder has no templates yet.',
    templatesLoading: 'Loading templates…',
    templatesFailed: (message: string) => `Couldn’t read the template folder: ${message}`,
    retryTemplates: 'Try again',
    templatesNote: 'Built-in templates come with the app; templates you put in the template folder show as “Mine”.',
    templatesSkipped: (count: number) => (count === 1 ? '1 template couldn’t be loaded' : `${count} templates couldn’t be loaded`),
    showSkipped: 'Show why',
    hideSkipped: 'Hide',
    pickTemplateHint: 'Pick a template on the left to see its preview and prompt here.',
    templatePrompt: 'Prompt',
    templatePromptLoading: 'Loading prompt…',
    templatePromptFailed: (message: string) => `Couldn’t read the prompt: ${message}`,
    templateSay: 'Try saying',
    /** 模板详情「需要你补充」与「做法：…」（模板包规范 §5.5、§3.1 `skills`）。 */
    templateFields: 'To fill in',
    templateSkills: (list: string) => `Approach: ${list}`,
    /** 输入框下面的待填提示（规范 §5.5）：还有几处、是哪些（`labels` 已按当前语言连好），不拦发送。 */
    slotsLeft: (count: number, labels: string) => `${count} left to fill in: ${labels} · You can still send; the agent will ask you first`,
    fillNextSlot: 'Fill in next',
    templateBriefNote: 'Once you pick it, the agent first confirms the topic, goal, audience, and materials with you, then starts making it.',
    templateAssets: 'Assets',
    templatePromptOnly: 'Prompt only, no assets',
    useTemplate: 'Use this template',
    keepTemplate: 'Keep using this template',
    useExample: 'Use this prompt',
    promptPlaced: 'Prompt filled in',
    undo: 'Undo',
    playPreview: 'Play preview',
    pausePreview: 'Pause preview',
    placeholder: 'Describe the video you want to make, or drag assets here…',
    templatePlaceholder: 'What’s it about? Add the topic, audience, or your requirements…',
    localFiles: 'Local files',
    addMedia: 'Video or audio',
    addDocument: 'PDF or document',
    addImage: 'Image',
    recentVideos: 'Recent videos',
    /** 选了最近的视频，原先挂着的视频或音频素材让出位置（一句话只对一条视频说）。 */
    recentReplaced: (title: string, removed: string) => `Now working on “${title}”; removed “${removed}”`,
    removeMaterial: (name: string) => `Remove asset: ${name}`,
    materialsFull: (max: number, rejected: number) => `You can add up to ${max} assets at a time; ${rejected} weren’t added`,
    notLocalFile: 'This file isn’t on this computer, so it can’t be given to the agent',
    thisComputer: 'This computer',
    pickProject: 'Choose project',
    pickProjectLabel: (name: string | null) => `Choose project: ${name ?? 'None'}`,
    currentProject: 'Current project',
    newProject: 'New project',
    noProject: 'Without a project, the agent works in a temporary folder',
    enableFailed: (message: string) => `Couldn’t turn on: ${message}`,
  },
  /**
   * 起始页「快捷开始」的四条（原型 model-newproject.js `STARTERS`）：处理已有视频或音频的常见事，点一下把这句话放进输入框。
   * 措辞不带「动画」「讲解」「图表」这类词，免得被当成某一类制作。`needs` 是提示里「再把什么拖进输入框」。
   */
  homeStarter: {
    sub: { title: 'Add subtitles', needs: 'a video', prompt: 'Add subtitles to this video.' },
    trans: { title: 'Transcribe and translate', needs: 'a video', prompt: 'Transcribe this video and translate it into Chinese as bilingual subtitles.' },
    clean: {
      title: 'Trim talking-head video',
      needs: 'a video',
      prompt: 'Transcribe this video and find filler words, long pauses, and retakes. Show me before cutting anything.',
    },
    a2v: { title: 'Audio to video', needs: 'an audio file', prompt: 'Turn this audio into a video with a background, a waveform, and subtitles.' },
    tip: (needs: string) => `Fills in the prompt. Then drag ${needs} into the message box`,
  },
  /** 模板分类的显示名（模板包规范 §3.2；键是协议的一部分）。认不出的键由 model/home-templates.ts 兜底按键名显示。 */
  templateCategory: {
    all: 'All',
    marketing: 'Marketing',
    'product-launch': 'Product launch',
    explainer: 'Explainer',
    'news-data': 'News and data',
    editing: 'Editing',
    'creative-short': 'Creative short',
    'motion-design': 'Motion design',
  },
  /** 两类模板（规范 §1.2）。 */
  templateKind: { all: 'All', scene: 'Scene templates', example: 'Showcase examples' },
  templateSource: { all: 'All sources', builtin: 'Built-in', user: 'Mine', community: 'Community' },
  /** 模板自带素材的种类（规范 §3.4）。 */
  templateAsset: { image: 'Image', svg: 'SVG', audio: 'Audio', video: 'Video' },
  /** 模板的画幅与时长文案（原型 model-home-templates.js `spec`、`specLine`）。 */
  templateSpec: {
    allAuto: 'Aspect ratio and duration automatic',
    ratioAuto: 'Aspect ratio automatic',
    lengthAuto: 'Duration automatic',
    sceneDefault: (spec: string) => `${spec} by default; say so in your message to change it`,
    exampleAuto: 'Aspect ratio and duration automatic, decided by the agent from your content',
  },
  /** 起始页的创建项目对话框（原型 new-agent.jsx `CreateProjectDialog`）。 */
  createProject: {
    title: 'Create project',
    close: 'Close create project',
    name: 'Project name',
    placeholder: 'Name your project',
    location: 'Save in folder',
    preview: (path: string) => `The project will be saved in ${path}`,
    cancel: 'Cancel',
    create: 'Create',
    created: (name: string) => `Created project “${name}”`,
    failed: (message: string) => `Couldn’t create the project: ${message}`,
  },
  /** 任务种类的名字（原型 page-tasks.jsx `KIND`）。Agent 会话里的任务原型没有单列，叫「Agent 任务」。 */
  taskKind: {
    agent: 'Agent task',
    transcribe: 'Transcribe',
    synthesizeSpeech: 'Generate speech',
    generateImage: 'Generate image',
    generateText: 'Generate text',
    export: 'Export',
    pipeline: 'Pipeline',
    'pipeline-step': 'Pipeline step',
    modelInstall: 'Install model',
    modelTest: 'Check model',
    modelsMove: 'Move models folder',
    toolInstall: 'Install tool',
    toolUpdate: 'Update tool',
    fontDownload: 'Download font',
    voiceClone: 'Clone voice',
    agentTranslate: 'Translate',
    legacyImport: 'Import earlier projects',
  },
  /** Job 的阶段（`JobPhase`）：列表与胶囊念「识别中 · 45%」。 */
  jobPhase: {
    queued: 'Queued',
    starting: 'Starting',
    loading: 'Loading model',
    decoding: 'Decoding audio',
    vad: 'Detecting speech',
    transcribing: 'Recognizing',
    aligning: 'Aligning timing',
    diarizing: 'Identifying speakers',
    finalizing: 'Finalizing',
    probing: 'Reading media',
    encoding: 'Encoding',
    downloading: 'Downloading',
    moving: 'Moving',
    generating: 'Generating',
    validating: 'Validating',
    publishing: 'Saving results',
    applying: 'Writing to video',
    done: 'Done',
  },
  /** 后台任务页、详情与侧栏。 */
  taskView: {
    queued: 'Queued',
    running: 'In progress',
    awaitingApproval: 'Needs your approval',
    cancelled: 'Cancelled',
    failed: 'Failed',
    completed: 'Done',
    interrupted: 'Interrupted',
    needsReconciliation: 'Result unknown',
    retrying: 'Retrying automatically after an error',
    costCharged: 'Result received; charged once',
    costCancelUnsupported: 'The provider doesn’t support cancelling; the request may still finish remotely and be charged',
    costUnknown: 'Not sure whether the request was sent; it may have been charged',
    costPossible: 'May have been charged',
    chipAgent: 'Agent',
    chipCli: 'CLI',
    byAgent: 'Agent session',
    byCli: 'CLI',
    byApp: 'App',
    byNode: 'Remote node',
    local: 'This computer',
    cloud: 'Cloud',
    node: 'Remote node',
    noProject: 'Not in any project',
    pageTitle: 'All tasks',
    activeSection: 'In progress',
    historySection: 'Done',
    historyGroup: 'History',
    emptyActive: 'No running tasks',
    emptyActiveBody: 'Transcription, translation, and exports show up here.',
    emptyHistory: 'No finished tasks yet',
    openConversation: 'Open session',
    details: 'Details',
    cancel: 'Cancel',
    stop: 'Stop',
    back: 'Background tasks',
    notFound: 'Task not found',
    notFoundBody: 'This task is no longer in the list',
    cancelTask: 'Cancel task',
    cancelExport: 'Cancel export',
    stopTask: 'Stop task',
    cancelExportHint: 'The unfinished file is deleted; the video itself isn’t affected. Once saving has started it can’t be stopped and will finish saving.',
    stopHint: 'The agent stops at the current step; files already written to the project aren’t affected.',
    conversationHint: 'This run was approved in an agent session; the conversation and approvals are in that session.',
    agentTaskHint: 'This task belongs to an agent session; the conversation and approvals are in that session.',
    cancelledBody: 'The video itself isn’t affected.',
    interruptedBody: 'The Runtime stopped or restarted before this run finished. It won’t resume; start it again if you need it.',
    needsReconciliationBody: 'The Runtime restarted before this cloud call replied. It may have been charged and won’t be resent automatically.',
    configHint: 'This is a configuration problem; retrying the same path won’t help. Add the missing component, then run it again.',
    sourceSection: 'Source',
    imagesSection: 'Images',
    outputsSection: 'Outputs',
    factsSection: 'Details',
    reveal: 'Show in Folder',
    open: 'Open',
    copyPrompt: 'Copy prompt',
    promptCopied: 'Prompt copied',
    copyFailed: 'Couldn’t copy. Select the text and copy it manually',
    documentWritten: 'Transcript written to the video',
    importedToVideo: 'Imported to video',
    imageName: (n: number) => `Image ${n}`,
    audioName: (n: number) => `Audio ${n}`,
    videoName: (n: number) => `Export ${n}`,
    fileName: (n: number) => `File ${n}`,
    entries: (n: number) => (n === 1 ? '1 entry' : `${n} entries`),
    packageFiles: (n: number) => (n === 1 ? 'Portable package · 1 file' : `Portable package · ${n} files`),
    projectClips: (n: number) => (n === 1 ? 'Project · 1 clip' : `Project · ${n} clips`),
    documentName: 'Transcript',
    stopFailed: (message: string) => `Couldn’t stop: ${message}`,
    cancelFailed: (message: string) => `Couldn’t cancel: ${message}`,
    /** 对账（`jobs.reconcile`）：重启后结果不明、中断或没有写进视频的任务，由用户决定。 */
    reconcileRetry: 'Try again',
    reconcileDiscard: 'Discard this result',
    reconcileApply: 'Write to video again',
    reconcileRetryHint: (charges: boolean): string =>
      charges ? 'Calls the provider again and may be charged again.' : 'Queues the same task again and runs it from the start.',
    reconcileDiscardHint: 'Marked as cancelled; any charges already incurred aren’t refunded.',
    reconcileApplyHint: 'The output is still there: it will be validated again and written to the video. Open this video first.',
    reconcileFailed: (message: string) => `Couldn’t handle it: ${message}`,
    openFailed: (message: string) => `Couldn’t open: ${message}`,
    remedyInstall: 'Install components',
    remedyCloud: 'Set up cloud models',
    remedyDefault: 'Choose default models',
    remedyNode: 'View remote nodes',
    remedyAgent: 'Open agent settings',
  },
  /** 任务胶囊与悬停卡（原型 task-pill.jsx、model-task-pill.js）。 */
  taskPill: {
    count: (n: number) => (n === 1 ? '1 background task' : `${n} background tasks`),
    all: 'All tasks',
    more: (n: number) => (n === 1 ? '1 more task · See all in Background tasks' : `${n} more tasks · See all in Background tasks`),
    mine: 'This video',
    justStarted: 'Just started',
    startedAt: (ago: string) => `Started ${ago}`,
  },
  /**
   * 功能区的「项目文件」标签（原型 home-workspace.jsx `WorkspaceFiles` 的 `__browse__` 分支）。
   * 原型没有的状态（读取中、读不了、目录为空、只列出一部分）按同样口吻补上。
   */
  projectFiles: {
    region: 'Project files',
    /** 不属于项目的会话：根目录是它自己的工作目录。 */
    scratchRoot: 'Session folder',
    searchLabel: 'Find project files',
    searchPlaceholder: 'Find files or videos',
    listLabel: (where: string) => `Files in “${where}”`,
    resultsLabel: 'Search results',
    breadcrumbs: 'Folder path',
    loading: 'Loading files…',
    emptyFolder: 'This folder is empty',
    noMatch: 'No matching files',
    noMatchHint: 'Search matches file names and skips hidden files and dependency folders.',
    failed: 'Couldn’t read the file list',
    retry: 'Try again',
    truncatedList: (count: number) => `Too many files; showing only the first ${count}.`,
    truncatedSearch: 'Too many matches; showing only some. Try a more specific word.',
    inRoot: 'Project root',
  },
  /**
   * 功能区的网页标签（原型 home-browser.jsx `WorkspaceBrowser`）。原型用 iframe；这里是宿主的独立网页视图（架构设计 §12.10），
   * 所以底部那句改成说明隔离；被拒绝的地址（本机地址、非 http/https）、网页进程退出与「这个环境不能内嵌网页」是原型没有的状态。
   */
  webTab: {
    back: 'Back',
    forward: 'Forward',
    stop: 'Stop loading',
    reload: 'Reload page',
    address: 'Web address',
    placeholder: 'Search or enter a URL',
    go: 'Go',
    menu: 'Page options',
    copy: 'Copy page address',
    copied: 'Page address copied',
    copyFailed: 'Couldn’t copy the page address',
    external: 'Open in external browser',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomReset: 'Reset zoom to 100%',
    invalid: 'Enter an http / https URL or search terms. URLs can’t include a username or password.',
    loading: 'Loading page…',
    slow: 'The page is loading slowly. Try again or open it in an external browser.',
    startTitle: 'Search or open a web page',
    startBody: 'Enter a URL or search terms to look things up here and keep the conversation going.',
    enterUrl: 'Enter URL',
    stoppedTitle: 'Loading stopped',
    failedTitle: 'The page couldn’t load',
    failedDetail: (description: string, code: number) => `${description} (${code})`,
    crashedTitle: 'The page quit unexpectedly',
    crashedBody: 'Try reloading it.',
    retry: 'Reload',
    blockedTitle: {
      loopback: 'Local addresses don’t open here',
      scheme: 'Only http / https URLs can be opened',
      'app-origin': 'BaoCut’s own pages can’t open in a web tab',
      invalid: 'This URL isn’t valid',
    },
    blockedBody: {
      loopback: 'For safety, embedded pages don’t reach local services (localhost, 127.0.0.1, and so on). Open it in a browser if you need to.',
      scheme: 'Other schemes (files, app links, and so on) don’t open in embedded pages.',
      'app-origin': 'The app’s own pages don’t open in a web tab.',
      invalid: 'Check how the URL is written.',
    },
    backToPage: 'Back to page',
    footer: 'Pages open in a separate environment that can’t reach BaoCut or local services; sign-ins are kept apart from your system browser.',
    externalShort: 'Open externally',
    unsupportedTitle: 'Web pages can’t be embedded here',
    unsupportedBody: 'The BaoCut desktop app can browse the web directly; for now, open it in a browser.',
    openInBrowser: 'Open in browser',
    toolsTitle: 'Tools',
    newPageTitle: 'New web page',
    newPageBody: 'Create an HTML file in the project and preview it',
    browseFilesTitle: 'Browse project files',
    browseFilesBody: 'View the project folder in this tab',
    newPageFileName: 'New page',
    newPageHint: 'Write the page here, or ask the agent to edit it.',
    newPageFailed: 'Couldn’t create the web page',
  },
  /** 时间线的剪贴板、右键菜单与带撤销的提示（原型 editor-keys.jsx、timeline-menu.jsx；原型说「元素」，这里是「片段」）。 */
  timelineEdit: {
    undo: 'Undo',
    /** `verb` 是本目录里的动作名（`copy`、`cutItem`、`remove`、`duplicate`）。 */
    pick: (verb: string) => `Select the clips to ${verb.toLowerCase()} first`,
    copied: (n: number) => (n > 1 ? `Copied ${n} clips` : 'Copied clip'),
    cut: (n: number) => (n > 1 ? `Cut ${n} clips` : 'Cut clip'),
    pasted: (n: number) => (n > 1 ? `Pasted ${n} clips` : 'Pasted clip'),
    duplicated: (n: number) => (n > 1 ? `Duplicated ${n} clips` : 'Duplicated clip'),
    deleted: (n: number) => (n > 1 ? `Deleted ${n} clips` : 'Deleted clip'),
    clipboardEmpty: (mod: string) => `The clipboard is empty · Press ${mod}C to copy a clip first`,
    otherVideo: 'The clips on the clipboard come from another video · They can only be pasted back into that video',
    selectedAtPlayhead: (n: number) => (n === 1 ? 'Selected 1 clip' : `Selected ${n} clips`),
    nothingAtPlayhead: 'No clips at the playhead',
    labelCut: 'Cut clips',
    labelPaste: 'Paste clips',
    labelDuplicate: 'Duplicate clips',
    labelDelete: 'Delete clips',
    labelSplit: 'Split clip',
    labelNudge: 'Nudge clip timing',
    labelDisable: 'Disable clip',
    labelEnable: 'Enable clip',
    menuLabel: (name: string) => `Clip “${name}”`,
    split: 'Split at playhead',
    splitUnavailable: 'The playhead isn’t inside this clip',
    copy: 'Copy',
    cutItem: 'Cut',
    paste: 'Paste',
    duplicate: 'Duplicate',
    disable: 'Disable this clip',
    enable: 'Enable this clip',
    disableHint: 'Stays on the timeline · Skipped in the picture and exports',
    enableHint: 'Back in the picture and exports',
    remove: 'Delete',
  },
  /** 走带的缩放菜单（原型 data.js `zoomMenu` 与 timeline.jsx 的 Transport）。 */
  timelineZoom: {
    menu: 'Zoom',
    tip: 'Zoom options',
    in: 'Zoom in',
    out: 'Zoom out',
    '100': '100%',
    fit: 'Fit to window',
    fitClip: 'Fit current clip',
    playhead: 'Zoom to playhead',
    fitSelection: 'Fit selection',
    noClip: 'Move the playhead inside a clip',
    noSelection: 'Select clips on the timeline first',
  },
  /**
   * 编辑器快捷键清单（原型 editor-keys.jsx 的 SHEET）：只列这里真有的键。
   * 键里的 ⌘ 在 Windows 与 Linux 上换成 Ctrl+（见 shortcut-sheet）。
   */
  shortcutSheet: {
    title: 'Keyboard shortcuts',
    done: 'Got it',
    hint: 'While the cursor is in a text field, these keys go to the text field.',
    rows: [
      ['Delete selection', 'Delete'],
      ['Deselect / close popover', 'Esc'],
      ['Play / pause', 'Space / K'],
      ['Undo / redo', '⌘Z / ⇧⌘Z'],
      ['Copy / cut / paste', '⌘C / ⌘X / ⌘V'],
      ['Duplicate', '⌘D'],
      ['Select all clips under the playhead', '⌘A'],
      ['Playhead back / forward one frame (while playing: 5 seconds)', '← / →'],
      ['Playhead back / forward one second', '⇧← / ⇧→'],
      ['Back / forward 10 seconds', 'J / L'],
      ['While playing: volume +10 / −10 (turning it up unmutes)', '↑ / ↓'],
      ['Mute / unmute', 'M'],
      ['Nudge the selected element on the canvas (click the canvas first)', 'Arrow keys (⇧ moves 5%, ⌥↑ / ⌥↓ moves 0.1%)'],
      ['Nudge the selected clip’s timing (⇧ one second at a time)', '⌥← / ⌥→'],
      ['Timeline zoom in / out / 100%', '⌘= / ⌘− / ⌘0'],
      ['Timeline fit to window / current clip / playhead / selection', '⌥⌘1 / ⌥⌘2 / ⌥⌘3 / ⌥⌘4'],
      ['Split at playhead', 'S / ⌘B'],
      ['Full-screen playback / exit full screen', 'F'],
      ['Jump to start / end', 'Home / End'],
      ['Open the editor shortcut list', '?'],
    ] as [string, string][],
  },
  /** Home 功能区：标签条、加号菜单、视图控件、会话列与单文件标签（原型 home-workspace.jsx、shell.jsx）。 */
  workspace: {
    tablist: 'Workspace tabs',
    tablistHint: 'Drag tabs to reorder them, or press Alt + Shift + Left/Right Arrow.',
    close: (name: string) => `Close tab “${name}”`,
    add: 'New tab',
    dragging: (name: string) => `Dragging “${name}”. Release to drop, Esc to cancel`,
    moved: (name: string) => `Moved “${name}”`,
    dragCancelled: 'Drag cancelled',
    viewGroup: 'Workspace view',
    resize: 'Resize session column',
    conversation: 'Session',
    /** 窄窗口里会话标签的提示与读屏名称（产品设计 §3.3）：`status` 是进行中 / 等待批准，没有时省掉。 */
    conversationTabTip: (title: string, status: string | null) =>
      `Session “${title}”${status ? ` · ${status}` : ''} · Pinned first; can't be moved or closed`,
    conversationTabLabel: (title: string, status: string | null) => `Session “${title}”${status ? `, ${status}` : ''}, pinned first`,
    opening: 'Opening video…',
    showInSpace: 'Show in Space',
    reveal: 'Show in Folder',
    fileMissing: 'The file was moved or deleted',
    filesNoConversation: 'Once the session is created, files in its folder are listed here.',
  },
  /** 舞台上的对象：选中框、把手、旋转钮、多选统一框与就地改字（原型 stage-objects.jsx、stage-marquee.jsx）。 */
  stage: {
    label: 'Objects on canvas',
    textEditor: 'Edit text',
    move: 'Move',
    resize: 'Resize',
    scale: 'Scale',
    rotate: 'Rotate',
    rotateReset: 'Reset rotation',
    groupMove: 'Move together',
    groupScale: 'Scale together',
    nudge: 'Nudge position',
    edgeHeightTip: 'Drag to change height · ⌥ from center',
    edgeWidthTip: 'Drag to change width · ⌥ from center',
    cornerFreeTip: 'Drag to resize · ⇧ unlocks proportions, ⌥ from center',
    cornerScaleTip: 'Scale proportionally · ⌥ from center',
    rotateTip: 'Drag to rotate · Snaps to 15°, ⇧ for free rotation · Double-click to reset',
    groupCornerTip: 'Scale all proportionally',
    picked: (n: number) => `${n} selected`,
    degrees: (n: number) => `${n}°`,
  },
  /**
   * 四项服务的目录与起停用词（原型 model-services.js `SERVICES`）；远端算力沿用「共享」。顺序就是侧栏与总览的顺序。
   * 模型接口服务在原型里是 Web 服务页里的一节（page-services-api.jsx `ApiSection`）；Runtime 把它做成独立的服务（自己的端口、
   * 令牌与开关，架构设计 §4.8），这里排在 Web 服务后面。
   */
  service: {
    mcp: {
      name: 'MCP service',
      scope: 'This computer only',
      desc: 'Lets other AI apps read videos and call BaoCut tools',
      start: 'Start service',
      stop: 'Stop service',
      starting: 'Starting…',
      stopping: 'Stopping…',
    },
    remote: {
      name: 'Remote compute',
      scope: 'Local network',
      desc: 'Shares this Mac’s compute with other computers on your local network',
      start: 'Start sharing',
      stop: 'Stop sharing',
      starting: 'Starting…',
      stopping: 'Stopping…',
    },
    web: {
      name: 'Web service',
      scope: 'This computer only',
      desc: 'Open BaoCut Web in a browser to edit the same videos',
      start: 'Start service',
      stop: 'Stop service',
      starting: 'Starting…',
      stopping: 'Stopping…',
    },
    'model-api': {
      name: 'Model API',
      scope: 'This computer only',
      desc: 'Lets tools that speak the OpenAI API use BaoCut’s models to transcribe, voice, make images, and generate text',
      start: 'Start service',
      stop: 'Stop service',
      starting: 'Starting…',
      stopping: 'Stopping…',
    },
  },
  /** 服务的状态词（原型 model-services.js `stateLabel`）；`unavailable` 是这个版本的 Runtime 没有提供的服务。 */
  serviceState: {
    share: { starting: 'Starting to share…', stopping: 'Stopping sharing…', error: 'Sharing stopped unexpectedly', on: 'Sharing', off: 'Not sharing' },
    service: { starting: 'Starting…', stopping: 'Stopping…', error: 'Failed to start', on: 'Running', off: 'Not started' },
    unavailable: 'Not available yet',
  },
  servicesPage: {
    title: 'Services',
    overview: 'Services overview',
    lede: 'Services BaoCut provides on this Mac for other apps and devices to connect to. All are off by default and stop when you quit BaoCut.',
    allOff: 'None running',
    errors: (n: number) => (n === 1 ? '1 error' : `${n} errors`),
    running: (n: number) => `${n} running`,
    open: (name: string) => `Open ${name}`,
    /** `verb` 是服务自己的启动词（`service.*.start`）。 */
    restart: (verb: string) => `Re${verb.charAt(0).toLowerCase()}${verb.slice(1)}`,
    railAlert: (text: string) => `Services, ${text}`,
    railApprovals: (n: number) => (n === 1 ? 'Services, 1 request awaiting your approval' : `Services, ${n} requests awaiting your approval`),
    loading: 'Loading status…',
    disconnected: 'Not connected to the BaoCut Runtime',
    failed: (message: string) => `That didn’t work: ${message}`,
    /** Runtime 列出了、但这个版本没有提供的服务（`available: false`）：总览行与详情页说清楚为什么不能起停。 */
    unavailableDetail: 'This version of the BaoCut Runtime doesn’t provide this service yet',
    unavailableTitle: (name: string) => `${name} isn’t available yet`,
    notRunning: 'The service isn’t running. Start it first',
    mcpRelated: 'Want Claude Code or Codex in your terminal to learn BaoCut’s workflows? Install BaoCut’s skill for them — no service needed. See',
    mcpRelatedLink: 'Settings › Skills',
  },
  /** BaoCut Runtime 卡（原服务页的一张卡，现在给设置 › 诊断复用）。 */
  runtimeCard: {
    name: 'BaoCut Runtime',
    version: 'Version',
    versionValue: (runtime: string, protocol: number | string) => `${runtime} (protocol ${protocol})`,
    pid: 'Process',
    startedAt: 'Started',
    home: 'Data folder',
  },
  /** 远端算力页（原型 page-shell.jsx RemotePage）。这个版本只能共享转录，其他几类任务画成禁用并说明原因。 */
  remote: {
    title: 'Remote compute',
    tabsLabel: 'Remote compute views',
    tabShare: 'Share this Mac',
    tabNodes: 'Use other computers',
    ledeShare: {
      before: 'Share this Mac’s transcription with other computers on your local network. ',
      strong: 'Files stay on your local network',
      after: '; only the results go back — no servers involved.',
    },
    ledeNodes: {
      before: 'Hand transcription to a faster computer on your local network. ',
      strong: 'Files stay on your local network',
      after: '; only the results come back — no servers involved.',
    },

    cardOn: 'Sharing this Mac',
    cardOff: 'Sharing is off',
    subOff: 'Other devices can’t see this Mac.',
    subErrorFallback: 'The node service isn’t listening.',
    errorFix: 'Quit the program using this port, then start sharing again — or stop if you no longer want to share.',
    foot: 'While sharing is on, BaoCut resumes sharing the next time it opens.',
    footRight: 'Sharing stops when you quit BaoCut.',
    privacy: 'Task inputs travel only on your local network and only results go back; nothing stays on this Mac after a task ends.',
    offHint: 'Once sharing starts, a 6-digit pairing code appears; enter it on the other device to connect.',
    started: 'Started sharing this Mac',
    stopped: 'Stopped sharing',

    nodeName: 'Node name',
    address: 'Address',
    noAddress: 'No local network address available',
    pairingTitle: 'Pairing code',
    pairingHint: (left: string) => `Enter this code on the other device. It expires in ${left}.`,
    pairingLocked: (until: string) => `Too many wrong attempts; pairing is locked until ${until}. Generate a new code to unlock it now.`,
    pairingNone:
      'No pairing code available right now. A code must be generated again after it’s used once, expires, or BaoCut reopens. Paired devices aren’t affected.',
    regenerate: 'Regenerate',
    generate: 'Generate pairing code',
    regenerated: 'New pairing code generated',

    tasksTitle: 'Tasks offered to other computers',
    taskSummary: (on: number, total: number) => `Offering ${on} of ${total} task types`,
    taskUnsupported: 'This version can’t share this kind of task yet',
    taskNoModel: (noun: string) => `This Mac has no usable ${noun} installed, so these tasks from other computers will fail`,
    taskSwitch: (name: string) => `Offer ${name.toLowerCase()}`,
    taskOn: (name: string) => `Now offering ${name.toLowerCase()}`,
    taskOff: (name: string) => `Stopped offering ${name.toLowerCase()} · Tasks already accepted will finish`,

    status: 'Status',
    idle: 'Idle',
    jobs: (running: number, queued: number) =>
      [running ? `${running} running` : '', queued ? `${queued} queued` : ''].filter(Boolean).join(' · '),

    clientsTitle: 'Paired devices',
    clientsEmpty: 'No devices are paired with this Mac yet.',
    clientMeta: (paired: string, seen: string | null) => (seen ? `Paired ${paired} · Last seen ${seen}` : `Paired ${paired} · Never connected`),
    revoke: 'Revoke',
    revokeLabel: (name: string) => `Revoke “${name}”`,
    revokeTitle: (name: string) => `Revoke “${name}”?`,
    revokeBody: 'Its token stops working immediately and the tasks it sent to this Mac are cancelled. To use it again, it must enter a pairing code again.',
    revoked: (name: string) => `Revoked “${name}”`,

    paired: 'Paired',
    pairedEmptyTitle: 'No paired nodes yet',
    pairedEmptyBody: 'Turn on “Share this Mac” on another computer, then pair with it here.',
    nearby: 'Nearby',
    nearbyIdle: 'Click “Find nearby computers” to see which computers on your local network are sharing.',
    nearbyNone:
      'No sharing computers found. Make sure “Share this Mac” is on over there and both computers are on the same local network — or add one by address.',
    search: 'Find nearby computers',
    searching: 'Searching…',
    addByAddress: 'Add by address…',
    pair: 'Pair',
    pairLabel: (name: string) => `Pair with “${name}”`,
    online: 'Online',
    offline: 'Offline',
    versionMismatch: 'Incompatible version',
    unpaired: 'Pairing no longer valid',
    checking: 'Checking…',
    more: (name: string) => `More actions for “${name}”`,
    copyAddress: 'Copy address',
    copied: (address: string) => `Copied ${address}`,
    copyFailed: 'Couldn’t copy. Select the text and copy it',
    unpair: 'Unpair',
    unpairTitle: (name: string) => `Unpair from “${name}”?`,
    unpairBody: 'This computer will no longer appear in the transcription model list. You can pair again any time.',
    unpairDone: 'Unpaired',
    /** 节点卡上「为什么用不了」：按 `PairedNode.problem` 拼（没有诊断方法，不叫「诊断」）。 */
    problem: {
      unreachable: 'Can’t reach this computer. Make sure it has BaoCut open with “Share this Mac” on, and both computers are on the same local network.',
      version: 'The two computers run incompatible BaoCut versions. Update both to the latest version.',
      unpaired: 'The pairing is no longer valid: the other side revoked this computer, or a different computer now uses this address. Unpair, then pair again.',
    },
    transcribeOff: 'Transcription not offered',
    transcribeModels: (n: number) => (n ? `Transcribe ${n}` : 'Transcribe'),

    pairTitle: (name: string) => `Pair with “${name}”`,
    addTitle: 'Add by address',
    pairBody: 'Read the 6-digit pairing code from “Share this Mac” on that computer and enter it here.',
    addressLabel: 'Address',
    addressPlaceholder: '192.168.1.31:47610',
    addressHint: (port: number) => `Host name or IP, optionally followed by a port; ${port} is used if you leave it out.`,
    codeLabel: 'Pairing code',
    codePlaceholder: '481 924',
    cancel: 'Cancel',
    pairing: 'Pairing…',
    pairedToast: 'Paired · It now appears in the transcription model list',
    addressEmpty: 'Enter that computer’s address',
    addressInvalid: 'The address format isn’t right: use 192.168.1.31 or 192.168.1.31:47610',
    portInvalid: 'The port must be a number from 1 to 65535',
    codeInvalid: 'The pairing code is 6 digits',
    pairErrors: {
      'pairing-code-invalid': 'The pairing code is wrong or no longer valid. Ask them to generate a new one and try again.',
      'pairing-locked': 'Too many wrong attempts; that computer has locked pairing for now. Ask them to click “Regenerate” to unlock it.',
      version: 'The two computers run incompatible BaoCut versions. Update both to the latest version first.',
      'source-not-allowed': 'That computer doesn’t accept connections from this computer’s address.',
      lost: 'Can’t reach that computer. Check the address and port, and make sure “Share this Mac” is on there.',
    },
    pairFailed: (message: string) => `Pairing didn’t work: ${message}`,
  },
  /** 「提供给其他电脑的任务」的名字（键见 `REMOTE_TASK_COPY`）。`noun` 是缺模型提示里的那类模型。 */
  remoteTask: {
    asr: { name: 'Transcription', noun: 'transcription model' },
    tts: { name: 'Voice-over', noun: 'voice-over model' },
    image: { name: 'Image generation', noun: 'image model' },
    separate: { name: 'Vocal separation', noun: 'separation model' },
    download: { name: 'Video download', noun: null },
    export: { name: 'Video export', noun: null },
  },
  /** 帮助中心（原型 help-center.jsx）：外框、分类、搜索、快速上手、快捷键页与入口。 */
  help: {
    title: 'Help Center',
    subtitle: 'Look things up any time and get going',
    close: 'Close Help',
    navLabel: 'Help categories',
    navTitle: 'Using BaoCut',
    navNote: ['Read only what you need.', 'Close it to get back to your work.'] as [string, string],
    sections: { start: 'Quick start', guide: 'Guides', keys: 'Keyboard shortcuts', faq: 'FAQ' },
    searchLabel: 'Search Help',
    searchPlaceholder: 'Search for what you want to do, e.g. subtitle style',
    results: 'Search results',
    found: (n: number) => (n === 1 ? 'Found 1 guide' : `Found ${n} guides`),
    emptyTitle: 'No matching guides',
    emptyBody: 'Try “subtitles”, “assets”, “agent”, or “aspect ratio” — or start from Quick start.',
    emptyAction: 'View Quick start',
    welcomeEyebrow: 'New here? Start here',
    welcomeTitle: 'Make your first subtitled video',
    welcomeBody: (steps: number) => `Go from a clip to a subtitled export in ${steps} steps.`,
    welcomeAction: 'Start the getting-started guide',
    welcomeDuration: (steps: number, minutes: number) => `${steps} steps · About ${minutes} min read`,
    pathLabel: (steps: number) => `Getting started in ${steps} steps`,
    pathMinutes: (minutes: number) => `${minutes} min read`,
    moreTitle: 'You might also want to know',
    allGuides: 'All guides',
    keysHintLead: 'Can’t find an action?',
    keysHintLink: 'View keyboard shortcuts',
    keysHintNote: 'Opens the list in the editor',
    keysTitle: 'Fewer clicks, a bit faster',
    keysIntro: 'These shortcuts work in the editor. While you’re typing, keys go to text editing first.',
    keysPlatform: 'Shortcut style',
    mac: 'macOS',
    other: 'Windows / Linux',
    guideTitle: 'Find what you want to do here',
    guideIntro: 'Each guide covers one thing, so you can go back to your video and try it right away.',
    faqTitle: 'Having trouble? Start here',
    faqIntro: 'Start with the most common causes and check step by step.',
    minutes: (minutes: number) => `${minutes} min`,
    readTime: (minutes: number) => `About ${minutes} min read`,
    backToResults: 'Back to search results',
    backTo: (section: string) => `Back to ${section}`,
    pickVideo: 'Choose a video',
    pickVideoNote: 'Open a video first, then follow the guide.',
    ctaNote: 'Opens the feature; you take it from there.',
    backToVideo: 'Back to video',
    backNote: 'Close Help and try it in your video.',
    next: (title: string) => `Read next: ${title}`,
    footer: 'Built-in guides · Available offline',
    entry: 'Help Center · F1',
    entryLabel: 'Help Center',
    settingsEntry: 'Help',
  },
  /** 编辑器预览的监听音量与全屏（快捷键 ↑/↓、M、F；原型 editor-keys.jsx 借全屏播放器的键）。只是这个窗口听到、看到的，不进视频。 */
  previewKeys: {
    volume: (volume: number) => `Preview volume ${volume}`,
    muted: 'Preview muted',
    unmuted: (volume: number) => `Preview unmuted · Volume ${volume}`,
    fullscreenFailed: 'Couldn’t show the preview full screen',
  },
  /** 画布浮动工具条与多选页（原型 stage-toolbar.jsx、stage-toolbar-menu.jsx、panel-elements.jsx MultiSelectPanel）。 */
  stageToolbar: {
    label: 'Clip toolbar',
    more: 'More',
    back: 'Back',
    unavailable: 'Not available yet',
    textColor: 'Text color',
    fillColor: 'Fill color',
    strokeColor: 'Stroke color',
    strokeWidth: 'Weight',
    muted: 'Muted',
    firstGeometry: (name: string) => `Geometry is read-only and shows the first “${name}”; select only that one to change the values.`,
    align: 'Align',
    alignTo: 'Relative to',
    toSelection: 'Selection',
    toCanvas: 'Canvas',
    alignLeft: 'Align left',
    alignHCenter: 'Center horizontally',
    alignRight: 'Align right',
    alignTop: 'Align top',
    alignVCenter: 'Center vertically',
    alignBottom: 'Align bottom',
    distribute: 'Distribute',
    distributeX: 'Distribute horizontally',
    distributeY: 'Distribute vertically',
    alignNeed: 'Aligning needs at least two movable clips, or one when aligning to the canvas.',
    distributeNeed: 'Distributing evenly needs at least three movable clips.',
    labelAlign: 'Align clips',
    labelDistribute: 'Distribute clips',
    aligned: (n: number) => (n === 1 ? 'Aligned 1 clip' : `Aligned ${n} clips`),
    distributed: (n: number) => (n === 1 ? 'Distributed 1 clip' : `Distributed ${n} clips`),
    inPlace: 'Already in place; no clips to move',
    duplicate: 'Duplicate',
    copy: 'Copy',
    removeAll: (n: number) => (n === 1 ? 'Delete this clip' : `Delete these ${n} clips`),
    skipped: (n: number) =>
      `${n === 1 ? '1 clip isn’t' : `${n} clips aren’t`} included in align and distribute: the main video, audio, and subtitles aren’t placed separately on the canvas, and locked clips don’t move.`,
    dragNote: 'Drag one of them on the canvas to move them together. Select a single clip to change properties one by one.',
    hint: 'Align, distribute, duplicate, and delete each count as a single undo step.',
    labelFlip: 'Flip',
    labelFit: 'Fit canvas',
    labelFill: 'Fill canvas',
  },
  /** @ 补全分组（设计稿 model-agent.js `mentionItems` 的本视频一组）：打开的视频里的章节与说话人在前。 */
  mentionGroups: {
    video: 'This video',
    files: 'Videos and files',
  },
};
export type CopyMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const revealLabel = () => M.reveal;
export const untitled = () => M.untitled;
export const sentAttachmentsLabel = () => M.sentAttachments;

// ---- 具名导出：形状与旧版一致，每次读属性取当前语言 ----

export const ACCESS_MODE_LABEL: Record<AgentMode, string> = live(() => M.accessModeLabel);
export const ACCESS_MODE_HINT: Record<AgentMode, string> = live(() => M.accessModeHint);
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = live(() => M.taskStatusLabel);

// ---- 输入区（原型 agent-thread.jsx Composer、model-agent.js、data.js `agent`） ----

export const ACCESS_MODE_FOOT: Record<AgentMode, string> = live(() => M.accessModeFoot);

/** 任务在跑时切换访问模式的提示（原型 model-agent.js `modeToast` 的运行中分支）。 */
export function accessModeToast(mode: AgentMode): string {
  return M.accessModeToast(ACCESS_MODE_LABEL[mode]);
}

/** composer 脚注（原型 model-agent.js `composerFoot`）：在哪儿跑、用谁的订阅、这一档会不会问你、快捷键。 */
export function composerFoot(driverName: string | null, account: string | null, mode: AgentMode): string {
  const name = driverName ?? 'Claude Code';
  const acct = (account ?? '').split(' · ')[0]!.trim();
  return M.composerFoot(name, acct, ACCESS_MODE_FOOT[mode]);
}

export const MODEL_TIER_LABEL: Record<ModelTier, string> = live(() => M.modelTierLabel);
export const EFFORT_COPY: Record<string, { label: string; sub: string | null }> = live(() => M.effort);
export const AGENT_PICKER = live(() => M.agentPicker);
export const DRIVER_STATE_REASON: Record<Exclude<DriverState, 'ready'>, string> = live(() => M.driverStateReason);

type SlashKey = keyof CopyMessages['slash'];
/** 一条斜杠命令：命令与图标是固定数据，名字与说明在读的时候按当前语言取。 */
function slash<C extends `/${SlashKey}`, I extends string>(cmd: C, icon: I) {
  const key = cmd.slice(1) as SlashKey;
  return {
    cmd,
    icon,
    get label(): string {
      return M.slash[key].label;
    },
    get sub(): string {
      return M.slash[key].sub;
    },
  };
}

/**
 * 斜杠命令（原型 data.js `agent.slash`，产品设计 §5.10）：`/` 点名一个工具，选中只把 `/xxx ` 留在正文里，后面接着说，Agent 自己解释。
 * 原型的智能裁剪与剪成短视频还没有接入 Agent 的流程，不列进来。
 */
export const SLASH_COMMANDS = [
  slash('/polish', 'sparkle'),
  slash('/chapters', 'list'),
  slash('/speakers', 'mic'),
  slash('/retranscribe', 'redo'),
  slash('/clean', 'captions'),
  slash('/translate', 'translate'),
  slash('/refresh', 'refresh'),
  slash('/dub', 'wave'),
  slash('/summary', 'transcript'),
  slash('/blog', 'text'),
  slash('/title', 'star'),
  slash('/desc', 'edit'),
  slash('/cover', 'image'),
  slash('/export', 'export'),
] as const;
export type SlashCommand = (typeof SLASH_COMMANDS)[number];

export const COMPOSER_MENU = live(() => M.composerMenu);
export const SKILL_COPY = live(() => M.skill);
export const ATTACHMENT_COPY = live(() => M.attachment);
export const QUEUE_COPY = live(() => M.queue);
export const RECOVERY_COPY = live(() => M.recovery);

// ---- 会话线程（原型 agent-thread.jsx `PermissionMsg`、`ReceiptMsg`、`UserMsg`、`AgentThread` 空态；home-session.jsx 产物卡） ----

export const APPROVAL_COPY = live(() => M.approval);
export const CHANGE_COPY = live(() => M.change);
export const THREAD_EMPTY_COPY = live(() => M.threadEmpty);
export const OUTPUT_COPY = live(() => M.output);
export const VIDEO_CARD_COPY = live(() => M.videoCard);
export const HOME_COPY = live(() => M.home);
export const HOME_STARTER_COPY = live(() => M.homeStarter);

/** 模板来源筛选用的键（model/home-templates.ts `HomeTemplate.source`）：内置目录、用户目录，清单写了社区的算社区。 */
export type TemplateSourceKey = 'builtin' | 'user' | 'community';

export const TEMPLATE_CATEGORY_LABEL = live(() => M.templateCategory);
export const TEMPLATE_KIND_LABEL = live(() => M.templateKind);
export const TEMPLATE_SOURCE_LABEL: Record<TemplateSourceKey | 'all', string> = live(() => M.templateSource);
export const TEMPLATE_ASSET_LABEL = live(() => M.templateAsset);
export const TEMPLATE_SPEC_COPY = live(() => M.templateSpec);
export const CREATE_PROJECT_COPY = live(() => M.createProject);

// ---- 后台任务统一视图与任务胶囊（原型 page-tasks.jsx、model-task-facts.js、task-pill.jsx、model-task-pill.js） ----

export const TASK_KIND_LABEL = live(() => M.taskKind);
export const JOB_PHASE_LABEL: Record<JobPhase, string> = live(() => M.jobPhase);
export const TASK_VIEW_COPY = live(() => M.taskView);
export const TASK_PILL_COPY = live(() => M.taskPill);
export const PROJECT_FILES_COPY = live(() => M.projectFiles);
export const WEB_TAB_COPY = live(() => M.webTab);
export const TIMELINE_EDIT_COPY = live(() => M.timelineEdit);
export const TIMELINE_ZOOM_COPY = live(() => M.timelineZoom);
export const SHORTCUT_SHEET_COPY = live(() => M.shortcutSheet);
export const WORKSPACE_COPY = live(() => M.workspace);
export const STAGE_COPY = live(() => M.stage);

// ---- 服务（原型 page-services.jsx、model-services.js、page-shell.jsx RemotePage；产品设计 §2.1） ----

export const SERVICE_COPY = live(() => M.service);
export const SERVICE_STATE_COPY = live(() => M.serviceState);
export const SERVICES_PAGE_COPY = live(() => M.servicesPage);
export const RUNTIME_CARD_COPY = live(() => M.runtimeCard);
export const REMOTE_COPY = live(() => M.remote);

type RemoteTaskKey = keyof CopyMessages['remoteTask'];
/** 一类可提供给其他电脑的任务：键与能力名是固定数据，名字在读的时候按当前语言取。 */
function remoteTask<K extends RemoteTaskKey, C extends string | null>(key: K, capability: C) {
  return {
    key,
    capability,
    get name(): string {
      return M.remoteTask[key].name;
    },
    get noun(): CopyMessages['remoteTask'][K]['noun'] {
      return M.remoteTask[key].noun;
    },
  };
}

/**
 * 「提供给其他电脑的任务」的目录（原型 model-services.js `REMOTE_TASKS`）。`capability` 是节点协议里可共享的能力名
 * （`NODE_SHAREABLE_CAPABILITIES`）；为 null 的几类这个版本没有后端，画成禁用。
 */
export const REMOTE_TASK_COPY = [
  remoteTask('asr', 'transcribe'),
  remoteTask('tts', null),
  remoteTask('image', null),
  remoteTask('separate', null),
  remoteTask('download', null),
  remoteTask('export', null),
] as const;

export const HELP_COPY = live(() => M.help);
export const PREVIEW_KEYS_COPY = live(() => M.previewKeys);

// ---- 画布浮动工具条与多选页 ----

export const STAGE_TOOLBAR_COPY = live(() => M.stageToolbar);
export const MENTION_GROUPS = live(() => M.mentionGroups);
