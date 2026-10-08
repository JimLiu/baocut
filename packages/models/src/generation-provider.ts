import type { GenerationParameters, JobWarning } from '@baocut/protocol';
import type { TextResult } from './text-generation.ts';

/**
 * 生成类能力（`synthesizeSpeech`、`generateImage`、`generateText`）的 Provider 接口（架构设计 §6.1、§6.6）：输入是冻结的文本与参数，
 * 输出是写在 staging 里的文件（媒体，或文本模型的全文）。校验（ffprobe 解码）、发布与导入视频都在 JobManager 里，不在 Provider 里。
 *
 * 一次 `generate` 是一次尝试。在线 Provider 自己按 §6.4 有界重试连不上与 5xx；JobManager 不再重试，
 * 也不换 Provider、模型或声音。
 */

export type GenerationCapability = GenerationParameters['capability'];

export interface GenerationRun {
  jobId: string;
  attempt: number;
  providerId: string;
  modelId: string;
  /** 提交时冻结的参数。 */
  parameters: GenerationParameters;
  /** 这次尝试的 staging 目录（绝对路径）；Provider 只能把输出写在这里。 */
  staging: string;
}

export interface GenerationSink {
  /** 进入生成阶段（请求已经发出）。 */
  generating(): void;
  /** 多个输出时，已经拿到几个（`outputs`，默认）；本地合成报告的是扩散或解码的步数（`steps`）。 */
  progress(done: number, total: number, unit?: 'outputs' | 'steps'): void;
  /** 不影响产出的警告（本地合成念不了的读音标注），记进任务的 `warnings`。 */
  warning?(warning: JobWarning): void;
}

/** staging 里的一个输出文件。`mediaType` 是 Provider 按请求的格式声明的，JobManager 按文件头核对。 */
export interface GenerationOutputFile {
  /** 相对 staging 的路径。 */
  path: string;
  /** 小写十六进制，不带前缀。 */
  sha256: string;
  byteLength: number;
  mediaType: string;
}

export type GenerationAttempt =
  | {
      outcome: 'completed';
      outputs: GenerationOutputFile[];
      /** 适配器版本，记进日志与诊断。 */
      workerVersion: string;
      /** 供应商原样报告的用量。 */
      usage?: unknown;
      /** `generateText`：检查过的结果（结束原因、用量、模型版本与说明），任务的结果摘要用它。 */
      text?: TextResult;
    }
  | { outcome: 'cancelled' };

export interface GenerationProvider {
  readonly id: string;
  /** 执行一次尝试。`signal` 中止时中止在途的请求，以 `cancelled` 兑现。失败抛 `ProviderFailure`。 */
  generate(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt>;
  /** 正常停止：中止在途的请求。 */
  close(): Promise<void>;
}
