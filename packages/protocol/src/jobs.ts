import type { Id } from './domain.ts';
import type { ExportJobInfo, ExportValidation } from './exports.ts';
import type { JobLibraryUse } from './library.ts';
import type { ImageFormat, SpeechFormat, TextEffort, VoiceMode } from './models.ts';
import type { JobGrantUse } from './grants.ts';
import type { JobWait } from './resources.ts';
import { localizeText, type MessageRef } from './message-ref.ts';

/**
 * Job（架构设计 §7）：一项长计算的状态。模型类的方法立即返回 `jobId`，进度与结果经 `jobs` 主题送达。
 *
 * 状态：`queued → running → completed | failed | cancelled | interrupted | needs-reconciliation`。
 * `interrupted` 表示这次尝试没有做完（Worker 崩溃、Runtime 停止或重启）；Worker 崩溃时 Runtime 自动再试一次，
 * 同一个 Job 回到 `running`、`attempt` 加一（§6.5）。Runtime 重启时按恢复矩阵（§7.5）处理还没终结的 Job：
 * 没有开始的重新排队，本机任务标为 `interrupted`，结果不明的外发调用标为 `needs-reconciliation`，等用户用
 * `jobs.reconcile` 决定，从不自动重发。
 */

/**
 * 任务的种类：模型任务与它执行的能力同名；`export` 是导出（`exports.create`）；固定流程（架构设计 §7.9）是一个
 * `pipeline` 父任务，每一步是它的 `pipeline-step` 子任务；`modelInstall` 是本地模型包的安装或修复（`models.install`、
 * `models.repair`），`modelTest` 是它的检查（`models.test`），两者都不属于任何视频与智能体任务（§6.3）。
 */
export type JobKind =
  | 'transcribe'
  | 'synthesizeSpeech'
  | 'generateImage'
  | 'generateText'
  | 'export'
  | 'pipeline'
  | 'pipeline-step'
  | 'modelInstall'
  | 'modelTest'
  /** 把本地模型移到新的模型目录（`models.setDir` 的 `move`，§6.3）：不属于任何视频与智能体任务，进度按字节。 */
  | 'modelsMove'
  /** 受管外部工具的下载与校验（`externalTools.install`，§12.9）。 */
  | 'toolInstall'
  /** 按原安装方式更新系统里的外部工具（`externalTools.update`，§12.9）：执行一条命令，输出记在 `command`。 */
  | 'toolUpdate'
  /** 音色克隆（架构设计 §5.9）：把库里音色的参考录音上传给 Provider 建一个克隆。 */
  | 'voiceClone'
  /** 按需下载的字体（`fonts.download`、预览与导出自动下载，§9.1）：一个族的几个 face。 */
  | 'fontDownload'
  /**
   * 会话里的智能体自己翻译一份转写（`documents_read` 给了 `translateTo`）：没有 Worker、不排队，只是一条进度记录，
   * 让视频卡与字幕面板看得到「正在翻译」。智能体写入这门语言的译文时完成，回合结束还没写时中断（用户停止的取消）。
   */
  | 'agentTranslate';

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'needs-reconciliation';

/**
 * 把结果应用到视频的一次尝试（架构设计 §7.2）：执行与应用是两条记录。应用先落账（`pending`），校验之后带着
 * `commandId` 与 `baseVideoRevision` 记为 `validating` 再提交事务，提交之后记下回执（`committed`）。
 * 崩溃恢复时先按同一个 `commandId` 向引擎查回执，查到就补记，不重写；查不到才重新校验、换新的 `commandId` 提交。
 *
 * - `stale-input`：目标不在了、素材换了版本、视频目录不见了；不猜相邻对象，产物留作候选。
 * - `rejected`：引擎拒绝了事务，或视频打不开（被别的进程锁住、引擎不可用）。
 * - `cancelled`：停止屏障之后没有提交的应用（Run 结束、`jobs.cancel`、用户放弃）。
 */
export type ApplicationState = 'pending' | 'validating' | 'committed' | 'stale-input' | 'rejected' | 'cancelled';

export interface ApplicationRecord {
  applicationId: Id;
  jobId: Id;
  /** 要应用的产物（转写的原始结果、生成的各个输出）。 */
  artifactIds: string[];
  videoId: Id;
  /** 要写的目标：转写是输入素材，生成导入是新素材的引用名（`output1`……）。 */
  targetRefs: string[];
  /** 提交时校验所依据的视频版本；还没校验时 null。 */
  baseVideoRevision: string | null;
  /** 最近一次提交事务用的命令 ID；还没提交时 null。 */
  commandId: string | null;
  state: ApplicationState;
  /**
   * 提交之后引擎给的回执：事务、提交后的视频版本与操作里 `ref` 解析到的 ID。`recovered` 表示不是提交时拿到的，
   * 而是之后按 `commandId` 向引擎查回来的（崩溃或回执响应丢失）。
   */
  receipt: { transactionId: Id | null; videoRevision: string | null; refs: Record<string, Id>; recovered?: true } | null;
  /** 结束时的原因（`stale-input`、`rejected`、`cancelled`）。 */
  error: JobError | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 取消或放弃时分开记的三件事实（架构设计 §7.4）：本机有没有停下，远端有没有取消，费用有没有发生。
 * `remote`：`not-applicable` 本机任务；`not-submitted` 还没有发出；`cancelled` 远端确认取消；`cancel-unsupported`
 * 已经发出但供应商没有取消接口（请求可能仍在远端完成）；`unknown` 不知道有没有发出。
 * `cost`：`none` 没有外发；`possible` 可能计费（按保守规则扣预算）；`charged` 已经拿到结果，肯定计费。
 */
export interface JobCancellation {
  requestedAt: string;
  localStoppedAt: string | null;
  remote: 'not-applicable' | 'not-submitted' | 'cancelled' | 'cancel-unsupported' | 'unknown';
  cost: 'none' | 'possible' | 'charged';
}

/**
 * `jobs.reconcile` 的决定（架构设计 §7.5），集合封闭：
 * - `retry`：`needs-reconciliation` 或 `interrupted` 的转写与生成任务，同一个 Job 再执行一次（新的一次付费调用，重新准入）。
 * - `discard`：`needs-reconciliation` 的任务放弃，记为 `cancelled`（按保守规则扣的预算不退）；最近一次应用没有提交的，
 *   放弃应用，产物留作候选。
 * - `apply`：最近一次应用是 `stale-input`、`rejected` 或 `cancelled` 而产物在的，重新校验后再应用一次。
 */
export type JobReconcileDecision = 'retry' | 'discard' | 'apply';

/** 阶段：Worker 报告的推理阶段，加上 Runtime 自己的准备、校验、发布与应用。 */
export type JobPhase =
  | 'queued'
  | 'starting'
  | 'loading'
  | 'decoding'
  | 'vad'
  | 'transcribing'
  | 'aligning'
  | 'diarizing'
  | 'finalizing'
  | 'probing'
  | 'encoding'
  | 'downloading'
  /** 移动模型目录：改名或复制文件（`models.setDir` 的 `move`）。 */
  | 'moving'
  | 'generating'
  | 'validating'
  | 'publishing'
  | 'applying'
  | 'done';

/** `total` 未知时为 null，不伪造百分比。 */
export interface JobProgress {
  done: number;
  total: number | null;
  /**
   * `outputs`：生成任务已经拿到的输出个数（一次多张图片时）；`steps`：固定流程已经完成的步骤数；
   * `units`：步骤已经处理的条目数（逐句翻译的句子、转码读取的文件）；`bytes`：模型安装已经收到（或校验过）的字节数；
   * `frames`：成片导出已经画完的帧数。
   */
  unit: 'seconds' | 'segments' | 'outputs' | 'steps' | 'units' | 'bytes' | 'frames';
  /** 按片段或逐句调用模型的步骤：已经发出的调用、重试与失败（事实计数，架构设计 §7.9）。父任务汇总在跑的那一步的计数。 */
  calls?: JobCallCounts;
}

/** 一个步骤里模型调用的事实计数。 */
export interface JobCallCounts {
  /** 发出的调用（含重试）。 */
  calls: number;
  /** 因输出不合约定而重发的调用。 */
  retries: number;
  /** 以失败结束的调用。 */
  failures: number;
}

/**
 * 提交者：一个主体，而不是某种传输。`connection` 是本机网关的一条连接，`system` 是 Runtime 自己，
 * `node` 是经局域网节点服务提交的远端任务，`id` 为发起端的 `clientId`（架构设计 §6.7）。
 * `agent` 是会话里的智能体经工具提交的：`id` 为会话 ID，`taskId` 为提交时进行中的任务（架构设计 §7.9）。
 * `service` 是对外服务的客户端提交的（MCP 服务的工具、模型接口服务的一次请求）：`id` 为服务（`mcp`、`model-api`），
 * `clientId` 为发放给它的客户端（架构设计 §4.8）。
 * `pipeline` 是固定流程的步骤（子任务）：执行主体是 `system:pipeline`，父任务记发起流程的连接或服务。
 */
export type JobSubmitter =
  | { kind: 'connection' | 'system' | 'node'; id: string }
  /** 固定流程的一步：`id` 为父任务（`kind: 'pipeline'`）的 `jobId`（架构设计 §7.9）。 */
  | { kind: 'pipeline'; id: Id }
  | { kind: 'agent'; id: Id; taskId: Id }
  | { kind: 'service'; id: string; clientId: string };

/** 错误码见命令与协议规范 §11.3（`MODEL_LOAD_FAILED`、`MODEL_WORKER_CRASHED`、`MODEL_OUTPUT_INVALID`、`STALE_JOB_INPUT`……）。 */
export interface JobError {
  code: string;
  message: string;
  /** `message` 的消息引用（message-ref.ts）：界面按自己的语言重新生成；旧记录、第三方原话没有。 */
  messageRef?: MessageRef;
  details?: unknown;
}

/** 结构化警告：Worker 的 `asr-result` 警告，以及 `no-speech` / `no-audio-track` 这类结果。 */
export interface JobWarning {
  code: string;
  segmentId?: string;
  detail?: string;
  /** `detail` 的消息引用（message-ref.ts）。 */
  detailRef?: MessageRef;
  /**
   * `FONT_NOT_DOWNLOADED`（成片导出）：哪个 face 没取到、由哪个族代替（渲染内核的回退族）与原因；与 `detail` 说的是同一件事，
   * 给界面列「族 → 回退字体 · 原因」。
   */
  font?: { family: string; weight: number; italic: boolean; fallback: string; reason: string };
}

/**
 * 本地语音合成冻结的参考录音。`source`：`file` 来自请求的 `reference.file`；`library` 来自音色库条目（固定在提交时的版本）；
 * `builtin` 是内置音色随应用分发的录音。`path` 是本机绝对路径，只在本机的任务记录里出现，不进日志与产物。
 */
export interface FrozenSpeechReference {
  source: 'file' | 'library' | 'builtin';
  path: string;
  /** `sha256:<hex>` */
  sha256: string;
  byteLength: number;
  /** 参考录音的原文；没有时 null（模型据此决定走哪条克隆路径）。 */
  transcript: string | null;
}

/**
 * 生成任务冻结的参数（提交时确定，执行与重试都用这一份：不会换模型、换声音）。原文与提示词照原样记下，生成的东西
 * 可以按它们追溯与复现；视频里的素材来源只记摘要（`inputHash`），不记原文。
 */
export type GenerationParameters =
  | {
      capability: 'synthesizeSpeech';
      text: string;
      voice: string;
      /** 请求给出的语言（BCP 47）；没有时 null。 */
      language: string | null;
      format: SpeechFormat;
      instructions: string | null;
      speed: number | null;
      seed: number | null;
      /**
       * 以下只有本地语音合成才有，没有时不写（在线任务的记录与 `inputHash` 不变）。
       * `voiceMode`：这次用的声音方式；`preset` 时 `voice` 是模型的说话人或内置音色。
       */
      voiceMode?: VoiceMode;
      /** `clone` 的参考录音：提交时读出的摘要与大小，执行前再核对一次，变了就失败（不换成别的声音）。 */
      reference?: FrozenSpeechReference;
      /** `describe` 的一句描述。 */
      voiceDescription?: string;
      cfg?: number;
      steps?: number;
    }
  | {
      capability: 'generateImage';
      prompt: string;
      /** 发给供应商的尺寸 `WIDTHxHEIGHT`；null 表示由供应商决定。 */
      size: string | null;
      /** 请求给出的宽高比；给的是尺寸时 null。 */
      aspectRatio: string | null;
      count: number;
      format: ImageFormat;
      seed: number | null;
      /** 本地生图的去噪步数；请求没给时不写（用模型的默认步数），在线任务没有。 */
      steps?: number;
    }
  | {
      capability: 'generateText';
      messages: TextMessage[];
      responseFormat: TextResponseFormat;
      maxOutputTokens: number;
      temperature: number | null;
      /** 请求的推理强度（没给时是能力参数的默认值）；都没有时 null。 */
      requestedEffort: TextEffort | null;
      /** 实际发给供应商的推理强度：模型不支持那一档时是最接近的一档，不能调节时 null。 */
      effort: TextEffort | null;
      seed: number | null;
    };

/** 文本模型的一条消息：只有文本，没有图片与工具调用。 */
export interface TextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 输出的形式：纯文本，或符合给定 JSON Schema 的 JSON（返回之前按 schema 校验）。 */
export type TextResponseFormat = { type: 'text' } | { type: 'json'; schema: Record<string, unknown>; name?: string };

/**
 * 文本模型的结束原因：`stop` 是正常结束；`length` 是到了输出上限被截断（从不算完整的成功：文本结果带
 * `output-truncated` 警告，结构化输出一律失败）；`content-filter` 是供应商的内容过滤（一律以 `PROVIDER_REJECTED`、
 * `details.reason: 'content-filter'` 失败）。
 */
export type TextFinishReason = 'stop' | 'length' | 'content-filter';

/** 供应商报告的 token 用量；没有报告时整个为 null。 */
export interface TextUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** 命中缓存的输入 token（供应商单独报告时）。是 `inputTokens` 的一部分：适配器把供应商的写法换成「输入总数含缓存」。 */
  cachedTokens?: number | null;
}

/** `generateText` 任务的结果摘要：全文是 `result.artifactId` 的产物（`.txt` 或 `.json`），这里只有开头的一段。 */
export interface TextJobResult {
  mediaType: 'text/plain' | 'application/json';
  byteLength: number;
  /** 全文按 Unicode 码点计的长度。 */
  length: number;
  /** 开头至多 `TEXT_PREVIEW_CHARS` 个字符。 */
  preview: string;
  /** 预览比全文短。 */
  previewTruncated: boolean;
  finishReason: TextFinishReason;
  usage: TextUsage | null;
  /** 供应商报告的模型版本（例如带日期的快照名）；没有报告时 null。 */
  modelVersion: string | null;
  /** 推理强度被换档或忽略之类的说明。 */
  notes: string[];
}

export const TEXT_PREVIEW_CHARS = 2000;

/** 生成任务或导出的一个输出：校验过、发布为产物；生成任务给了视频时还导入为素材。 */
export interface GeneratedOutput {
  artifactId: string;
  mediaType: string;
  byteLength: number;
  /** 导入视频得到的素材；没有视频、导入失败或导出时为 null。 */
  assetId: Id | null;
  /** 校验报告的事实：音频、图片与视频（成片、转码结果）来自 ffprobe 解码，文字来自解析导出的文件（条数与覆盖的时长）。 */
  media:
    | { kind: 'audio'; durationSec: number; sampleRate: number; channels: number }
    | { kind: 'image'; width: number; height: number }
    | { kind: 'text'; entries: number; durationSec: number }
    | {
        kind: 'video';
        durationSec: number;
        width: number;
        height: number;
        videoCodec: string;
        audioCodec: string | null;
        /** 成片导出一定填：视频流的帧数与帧率（`30/1`、`30000/1001`）；文件转码可以不填。 */
        frames?: number;
        fps?: string;
      }
    /** 便携包：包里的文件数与收进来的、标为缺失的素材版本数，文档版本数。 */
    | { kind: 'package'; files: number; assets: number; missingAssets: number; documents: number }
    /** 工程导出：写进工程的片段数与没能表达、逐项报告的对象数。 */
    | { kind: 'project'; clips: number; omitted: number; durationSec: number }
    /** 交给用户的文件（`downloads_save`）：原样复制，不解码、不解析。 */
    | { kind: 'file' };
  /**
   * 写在产物库之外的输出（导出、文件转码写到用户选的目录）：发布到的绝对路径。文件转码时 `artifactId` 是文件内容的
   * 摘要 `sha256:<hex>`，`artifacts.openHandle` 找不到它。
   */
  path?: string;
  /** 导出：文件格式（`srt`、`wav`……）。 */
  format?: string;
  /** 导出：发布前的校验结果。 */
  validation?: ExportValidation;
}

export interface JobRecord {
  jobId: Id;
  kind: JobKind;
  state: JobState;
  phase: JobPhase;
  progress: JobProgress | null;
  /**
   * 视频里的输入素材；局域网节点代别的机器执行的任务（`submitter.kind === 'node'`）没有视频，三者都是 null。
   * 生成任务没有输入素材：`assetId` 与 `assetRevision` 为 null，`videoId` 是要导入结果的视频（没有时 null）。
   */
  videoId: Id | null;
  assetId: Id | null;
  assetRevision: string | null;
  /** 输入的内容摘要 `sha256:<hex>`：素材版本的、远端任务上传的文件的，或生成任务的原文与提示词（UTF-8）的。 */
  contentHash: string;
  /** 执行它的 Provider（`local`、`node:<nodeId>`、`openai`、`google`、`custom:<slug>`）与模型。 */
  providerId: string;
  /** 本地与节点是模型包 ID，在线的是供应商的模型名。 */
  modelId: string;
  /** 本地与节点的模型包；在线 Provider 为 null。 */
  bundleId: string | null;
  /** 任务规格的输入 hash（`sha256:<hex>`），相同输入的在途任务去重用。 */
  inputHash: string;
  submitter: JobSubmitter;
  /** 第几次尝试，从 1 开始。 */
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  error: JobError | null;
  /**
   * 完成时：写入视频的 `speech` 文档（没有语音、没有音轨时为 null）与原始结果的产物。远端任务的结果交还发起端，这里始终为 null。
   * 生成任务：`documentId` 为 null，`artifactId` 是第一个输出的产物，`outputs` 是全部输出（导入视频失败时也保留）。
   * 文本生成任务：`artifactId` 是全文的产物，`text` 是摘要与预览，没有 `outputs`。
   * 导出：同生成任务，`outputs` 是已经发布的文件；多个文件里有的没有发布时任务为 `failed`（`EXPORT_PARTIALLY_PUBLISHED`），
   * `result` 仍列出已经发布的。
   */
  result: { documentId: Id | null; artifactId: string; outputs?: GeneratedOutput[]; text?: TextJobResult } | null;
  warnings: JobWarning[];
  /** 生成任务冻结的参数；转写任务没有。 */
  generation?: GenerationParameters;
  /** 导出的设置、冻结快照与目标（`kind: 'export'` 才有）。 */
  export?: ExportJobInfo;
  /**
   * 视频的转写（`models.transcribe` 与流程提交的，`kind: 'transcribe'`）提交时定下的语言与说话人区分：`language` 是规范化后的请求，
   * `diarize` 是生效的值（请求没给时按模型定下的）。远端与只给文件的转写、之前的记录没有。
   */
  transcribe?: { language: LanguageRequest; diarize: boolean; replace?: TranscriptReplace };
  /** 用到的用户库条目（提交时冻结的版本与摘要），以及术语表有没有进入识别提示（架构设计 §5.9）。 */
  library?: JobLibraryUse;
  /** 外发调用用到的授权与预算：哪条授权（哪一代）、预留与结算（架构设计 §12.5、§7.8）。本机与节点任务没有。 */
  grant?: JobGrantUse;
  /** 智能体自己翻译（`kind: 'agentTranslate'`）：译自哪份转写、译成什么语言、要译多少句。 */
  translation?: AgentTranslation;
  /** 固定流程的步骤（`kind: 'pipeline-step'`）：父任务的 `jobId`。`jobs.list` 默认把子任务折叠在父任务下。 */
  parentJobId?: Id;
  /** 固定流程的父任务（`kind: 'pipeline'`）：冻结的参数与每一步的状态。 */
  pipeline?: PipelineRun;
  /** 固定流程的步骤：它是哪个流程的第几步。 */
  step?: PipelineStepRef;
  /** 把结果应用到视频的各次尝试（架构设计 §7.2），旧的在前；没有视频的任务没有。 */
  applications?: ApplicationRecord[];
  /** 取消或放弃时的三件事实（架构设计 §7.4）；没有取消过时没有。 */
  cancellation?: JobCancellation;
  /** 代用户执行的那条命令与它的输出（`kind: 'toolUpdate'`，§12.9）；开始执行之前没有。 */
  command?: JobCommandRun;
  /**
   * 排队（`queued`）时在等什么：同一队列的并发上限，或机器上的资源（架构设计 §7.6、§7.7）。开始执行后没有。
   * 固定流程里声明了需求的步骤在准入之前也有（子任务与父任务上都记着）。
   */
  wait?: JobWait;
}

/** 智能体自己翻译的范围（`JobRecord.translation`）。 */
export interface AgentTranslation {
  /** 译自的转写（kind `speech`）的 documentId。 */
  sourceDocumentId: Id;
  /** 目标语言（BCP 47）。 */
  targetLanguage: string;
  /** 转写按规则切好的句子数（`translationBasis.sentences` 的长度）。 */
  sentences: number;
}

/**
 * 代用户执行的一条命令（架构设计 §12.9）：给人看的那一行、输出与退出码，执行中随任务事件更新。输出是标准输出与标准错误
 * 按到达的顺序合在一起的原文，去掉终端颜色，`\r` 改写的进度行只留最后一次；只留末尾（约 32 KB，按整行截），全文在结果产物里。
 */
export interface JobCommandRun {
  /** 执行的命令：按 POSIX 规则加引号的一行，可以复制到终端。 */
  line: string;
  output: string;
  /** 到此刻为止写完的行数（含截掉的）；`output` 最后一行还没写完时不算它。逐行跟随输出的客户端据此只打印新的行。 */
  lines: number;
  /** 前面的输出截掉了。 */
  truncated: boolean;
  /** 退出码；还在执行、被停止或没能启动时为 null。 */
  exitCode: number | null;
}

/**
 * 固定流程的一次执行（架构设计 §7.9），记在父任务上。参数在提交时校验并冻结，执行与重试都只读这一份；
 * 每一步的产出（产物、输出文件、写入的文档）也记在这里，重试从失败的那一步开始，复用之前各步的产出。
 */
export interface PipelineRun {
  /** 流程名（`pipelines.list` 的 `name`）。 */
  name: string;
  /** 冻结的参数。 */
  params: Record<string, unknown>;
  steps: PipelineStepState[];
  /** 正在执行的步骤的序号；没有时 null。 */
  current: number | null;
  /** 让流程停下来的那一步（失败、取消或中断）；没有时 null。 */
  stoppedAt: string | null;
  /** 流程完成时的结果摘要（各流程自己的形状，见命令与协议规范 §4.1）；没完成时 null。 */
  summary: Record<string, unknown> | null;
}

export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed' | 'cancelled' | 'interrupted';

export interface PipelineStepState {
  name: string;
  /** 给人看的步骤名。 */
  label: string;
  /** `label` 的消息引用（message-ref.ts）。 */
  labelRef?: MessageRef;
  status: PipelineStepStatus;
  /** 这一步最近一次执行的子任务；还没执行时 null。重试时换成新的子任务，旧的保留在任务列表里。 */
  jobId: Id | null;
  /** 执行过几次。 */
  attempts: number;
  /** 完成时的产出：产物 ID、输出文件、文档引用之类（步骤自己的形状）。 */
  output: Record<string, unknown> | null;
}

/** 步骤名按读者当前的语言：有 `labelRef` 时重新生成，否则照用记下的 `label`。 */
export function pipelineStepLabel(step: { label: string; labelRef?: MessageRef }): string {
  return localizeText(step.label, step.labelRef);
}

export interface PipelineStepRef {
  pipeline: string;
  name: string;
  label: string;
  /** `label` 的消息引用（message-ref.ts）。 */
  labelRef?: MessageRef;
  /** 从 0 开始的序号。 */
  index: number;
}

/** 语言：断言（模型不得更改）或偏好（自动检测，`tag` 为 null 表示不偏好任何语言）。BCP 47。 */
export type LanguageRequest = { mode: 'assert'; tag: string } | { mode: 'prefer'; tag: string | null };

/**
 * `models.transcribe` 的参数：一个已打开的视频里的一个音视频素材版本。
 *
 * 用哪个 Provider 与模型按架构设计 §6.2 的顺序确定：显式的 `provider` / `model`，用户的默认值，出厂默认（本机可用的模型包），
 * 都没有时以 `CAPABILITY_NOT_CONFIGURED` 拒绝。`node: x` 等同于 `provider: 'node:<x>'`（`x` 可以是别名），
 * `bundleId: b` 等同于 `model: b`；两种写法互相矛盾时返回 `invalid-request`。
 */
export interface TranscribeRequest {
  videoId: Id;
  assetId: Id;
  /** 不给时取素材的当前版本。 */
  revision?: string;
  /** Provider：`local`、`node:<nodeId 或别名>`、`openai`、`google`、`custom:<slug>`。 */
  provider?: string;
  /** 模型：本地与节点是模型包 ID，在线的是供应商的模型名。只给 Provider 时用默认值（指向它时）或它的默认模型。 */
  model?: string;
  /** 旧写法，等同于 `model`。 */
  bundleId?: string;
  /** 不给时 `{ mode: 'prefer', tag: null }`。 */
  language?: LanguageRequest;
  /** 音轨序号，默认 0。 */
  track?: number;
  /** 术语与上下文，≤ 1200 字符。 */
  hint?: string;
  /**
   * 区分说话人（架构设计 §6.6）。不给时按模型：能区分的（`TranscribeModelInfo.speakers` 是 `native` 或 `pack`）区分，别的不区分。
   * 给 `true` 而模型不能区分时照常转写，结果带 `diarization-unavailable` 警告。
   */
  diarize?: boolean;
  /**
   * 识别用术语表（架构设计 §5.9）：规范写法接在 `hint` 之后作为提示（合计仍 ≤ 1200 字符，放不下的舍去）。模型不接受提示时
   * 忽略术语表，在 `JobRecord.library.glossaryHint` 里说明。提交时冻结条目的版本与摘要。
   */
  glossaries?: { id: Id; version?: number }[];
  /** 旧写法，等同于 `provider: 'node:<x>'`：远端节点的 `nodeId` 或别名；没有自动故障转移。 */
  node?: string;
  /**
   * 换用文稿（架构设计 §6.6，转录流程的 `destination: 'replace'`）：应用时写这份 `speech` 文档的新版本、结转依赖它的内容，
   * 一笔事务。应用前核对文稿的全文指纹仍是提交时的 `fingerprint`，不符时任务以 `TRANSCRIPT_EDITED` 失败。不给时新写一份文档。
   */
  replace?: TranscriptReplace;
  commandId?: Id;
}

/** 换用哪一份文稿：提交时的版本与全文指纹，以及译文结不结转。 */
export interface TranscriptReplace {
  documentId: Id;
  /** 提交时文稿的当前版本（摘要的 `replaced.previousVersion`）。 */
  revision: string;
  /** 提交时文稿的全文指纹（`count:firstId:lastId:hash`，与 `stages.asr` 同一种写法）。 */
  fingerprint: string;
  translations: 'carry' | 'discard';
}

/**
 * `models.synthesizeSpeech` 的参数：把一段文本合成为语音。
 *
 * Provider 与模型按架构设计 §6.2 的顺序确定（显式、用户默认值；这种能力没有出厂默认），都没有时以
 * `CAPABILITY_NOT_CONFIGURED` 拒绝。文本超过模型的 `maxInputChars` 时在提交时拒绝，不截断、不切块。
 * 给 `videoId` 时结果导入那个（已打开的）视频成为素材，不放到时间线上；不给时只发布产物。
 */
export interface SynthesizeSpeechRequest {
  text: string;
  /**
   * 音色 ID；不给时用模型的 `defaultVoice`（同时没有 `reference`、`voiceDescription` 时）。`library:<id>` 指音色库里的条目：
   * 在线 Provider 用它在该 Provider 上的有效克隆，没有或已过期时以 `VOICE_CLONE_REQUIRED` 拒绝（先创建克隆）；本地模型直接用
   * 条目的参考录音与原文克隆（`clone`，不出本机，不需要先建克隆）。
   */
  voice?: string;
  /**
   * 本地模型的 `clone`：参考录音（本机绝对路径）与它的原文。与 `voice`、`voiceDescription` 互斥。模型不支持 `clone` 时拒绝。
   * 提交时读出摘要并冻结；执行前文件变了，任务失败。
   */
  reference?: { file: string; transcript?: string };
  /** 本地模型的 `describe`：一句话描述声音。与 `voice`、`reference` 互斥；封闭词表的模型按词表检查。 */
  voiceDescription?: string;
  /** 本地模型的引导强度与扩散步数；只有模型的 `local.knobs` 列出时接受，范围见那里。 */
  cfg?: number;
  steps?: number;
  provider?: string;
  model?: string;
  /** 文本的语言（BCP 47）；模型声明了语言清单时据此检查，供应商接受时传给它。 */
  language?: string;
  format?: SpeechFormat;
  /** 语气与风格的说明；只有 `acceptsInstructions` 的模型接受。 */
  instructions?: string;
  speed?: number;
  seed?: number;
  videoId?: Id;
  /** 导入视频时的素材名。 */
  name?: string;
  /**
   * 保存位置（架构设计 §7.9「保存位置」）：本机绝对路径。给了时结果发布为产物后，再在这个目录里写一份可读名字的副本
   * （按文本开头取名，清理同下载的文件名，不覆盖已有文件），路径记在 `result.outputs[].path`；目录不存在时创建，不能写时
   * 以 `OUTPUT_DESTINATION_UNAVAILABLE` 拒绝。副本没写成不算任务失败，结果带 `save-copy-failed` 警告。
   * 不给时不写副本（模型试听、探测与编辑器里的调用都不给）；工具页给 `tools.list` 返回的 `saveDirectory`。
   */
  saveDir?: string;
  /**
   * 素材（架构设计 §7.9「Space 条目作为输入」）：Space 里的文档（.txt、.md）或字幕（.srt、.vtt，去掉时间码）条目，
   * Runtime 在方法层读出它的文字当 `text`。给了时 `text` 传空字符串。条目的拒绝同 `SpaceEntryInput`。
   */
  material?: { entryId: Id };
  commandId?: Id;
}

/** `models.generateImage` 的参数：按提示词生成图片。选择、上限与视频的规则同 `SynthesizeSpeechRequest`。 */
export interface GenerateImageRequest {
  prompt: string;
  /** `WIDTHxHEIGHT`（模型的 `sizes` 之一）或宽高比 `W:H`（模型的 `aspectRatios` 之一）；不给时用 `defaultSize`。 */
  size?: string;
  /** 张数，默认 1，不超过模型的 `maxCount`。 */
  count?: number;
  format?: ImageFormat;
  seed?: number;
  /** 本地模型的去噪步数；只有模型的 `local.steps` 列出时接受，范围见那里。 */
  steps?: number;
  provider?: string;
  model?: string;
  videoId?: Id;
  name?: string;
  /** 保存位置，规则同 `SynthesizeSpeechRequest.saveDir`；副本按提示词开头取名，多张时依次加序号。 */
  saveDir?: string;
  commandId?: Id;
}

/**
 * `models.generateText` 的参数：一次文本模型调用，结果发布为产物。选择规则同 `SynthesizeSpeechRequest`（没有出厂默认）。
 * 只有文本消息，没有图片与工具；不导入视频。`maxOutputTokens` 不给时用模型的上限；超过模型上限、模型不接受的
 * `temperature` / `seed` / 结构化输出，以及不合法的 JSON Schema，都在提交时以 `invalid-request` 拒绝。
 */
export interface GenerateTextRequest {
  messages: TextMessage[];
  /** 不给时 `{ type: 'text' }`。 */
  responseFormat?: TextResponseFormat;
  maxOutputTokens?: number;
  temperature?: number;
  /** 不给时用能力参数的默认值；模型不支持那一档时换成最接近的一档，不能调节时忽略，都在结果里注明。 */
  effort?: TextEffort;
  seed?: number;
  provider?: string;
  model?: string;
  /**
   * 保存位置，规则同 `SynthesizeSpeechRequest.saveDir`；副本按最后一条用户消息开头取名，扩展名随 `responseFormat`
   * （文本 `.md`、JSON `.json`）。写了副本时 `result.outputs` 有一项文本产物，带 `path`。
   */
  saveDir?: string;
  /**
   * 素材，规则同 `SynthesizeSpeechRequest.material`：条目的文字接在最后一条用户消息后面（空一行，先写文件名）。
   */
  material?: { entryId: Id };
  commandId?: Id;
}

/**
 * 转录中已经识别出的一段（架构设计 §6.6「实时文稿」）。时间是被转录素材自身时钟（`source-asset`）上的秒数：只转录一段
 * （`range`）时也从素材的 0 算起；完成后的 `speech` 文档是同一时钟上的 tick，除以它的 `timescale` 就是这里的值。
 * 没有说话人和词级时间——那些要等终态。它是任务事件流的投影，不是项目内容：不进文档、不进撤销栈，任务结束就丢掉。
 */
export interface JobLiveSegment {
  start: number;
  end: number;
  text: string;
}

export interface JobsSnapshot {
  /** 新的在前。 */
  jobs: JobRecord[];
  /**
   * 还在跑的转录任务到目前为止识别出的全部段落，按 `jobId`，按到达顺序；没有在跑的转录任务时省略。
   * 中途订阅（例如 Agent 发起的转录跑到一半才打开编辑器）靠它补齐此前的段落，之后接 `job.segments`。
   */
  liveSegments?: Record<Id, JobLiveSegment[]>;
}

/**
 * `job.updated`：每次状态、阶段或进度变化发一条，带完整的记录；记录不再是 `running`（终态，或崩溃重试前的 `interrupted`）
 * 时，客户端丢掉这个任务的实时段落。
 * `job.segments`：转录任务新识别出的段落（不随 `job.updated` 重发，免得长视频每次进度都带上全部文字）。`from` 是第一段在
 * 这个任务全部段落里的序号（从 0 起；崩溃后自动重试的新一次尝试从头识别，也从 0 重来），客户端据此去重：已有的序号用新内容
 * 替换；`from` 越过已有的段数（中间缺了）时整条忽略，不补猜，等下一次快照补齐。
 */
export type JobsEvent =
  | { type: 'job.updated'; job: JobRecord }
  | { type: 'job.segments'; jobId: Id; from: number; segments: JobLiveSegment[] };
