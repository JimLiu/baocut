import crypto from 'node:crypto';
import type { GenerationParameters } from '@baocut/protocol';

/** 规范 JSON：对象的键按字典序，没有空白；`undefined` 的字段省略。相同的值总得到相同的字符串。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** 转写任务规格中决定结果的字段（架构设计 §6.6）。 */
export interface TranscribeInputSpec {
  contentHash: string;
  track: number;
  range: { start: number; end: number; timescale: number } | null;
  language: { mode: 'assert'; tag: string } | { mode: 'prefer'; tag: string | null };
  /** 执行它的 Provider（`local`、`node:<nodeId>`、`openai`……）与模型（§6.2：任务冻结 `providerId` 与 `modelId`）。 */
  providerId: string;
  modelId: string;
  /** 本地与节点的模型包；在线 Provider 为 null。 */
  bundleId: string | null;
  diarize: boolean;
  hint: string | null;
  outputContract: string;
}

/** 输入 hash：`sha256:<hex>`，对上面字段的规范 JSON 求摘要。不同的 Provider 或模型得到不同的 hash。 */
export function transcribeInputHash(spec: TranscribeInputSpec): string {
  const { contentHash, track, range, language, providerId, modelId, bundleId, diarize, hint, outputContract } = spec;
  return `sha256:${sha256Hex(canonicalJson({ contentHash, track, range, language, providerId, modelId, bundleId, diarize, hint, outputContract }))}`;
}

/** 生成任务规格中决定结果的字段（架构设计 §6.6）：能力、Provider、模型与冻结的参数（含原文或提示词）。 */
export interface GenerationInputSpec {
  capability: GenerationParameters['capability'];
  providerId: string;
  modelId: string;
  parameters: GenerationParameters;
  /** 要导入结果的视频；没有时 null。不进输入 hash。 */
  videoId: string | null;
  /** 导入的素材名（不进输入 hash）。 */
  name: string | null;
  /**
   * 保存位置的副本（架构设计 §7.9「保存位置」，不进输入 hash）：发布后在 `dir` 里按 `stem` 写一份可读名字的副本。
   * 没有给 `saveDir` 的请求与旧账本里的任务没有这一项。
   */
  save?: { dir: string; stem: string } | null;
}

/**
 * 不经模型的任务（导出，架构设计 §9.11）的规格：执行所需的一切在冻结快照的产物里，账本只记它的 ID，
 * 不把大的计划写进 `jobs.json`。执行者只在内存里（Runtime 重启后这类任务标为 `interrupted`，不续跑）。
 * 模型包的安装、修复与自检（§6.3）也是这类任务：账本只记模型包与要做的事。
 */
export type TaskInputSpec =
  | {
      task: 'export';
      /** 冻结快照（`baocut.export-snapshot/1`）的产物。 */
      snapshotArtifactId: string;
    }
  | { task: 'modelInstall'; bundleId: string; repair: boolean; confirmBytes: number }
  | { task: 'modelTest'; bundleId: string }
  /** 模型目录的移动（§6.3）：从哪里移到哪里、要搬的仓库与字节数。 */
  | { task: 'modelsMove'; from: string; to: string; repos: string[]; bytes: number }
  /** 受管外部工具的下载（架构设计 §12.9）：工具、版本与这台机器要下载的文件的摘要。 */
  | { task: 'toolInstall'; tool: string; version: string; sha256: string }
  /** 按原安装方式更新外部工具（§12.9）：工具、办法与要执行的命令（参数数组）。 */
  | { task: 'toolUpdate'; tool: string; method: string; argv: string[] }
  /** 音色克隆（§5.9）：库里的哪个音色（冻结的版本与摘要）、传给哪个 Provider。 */
  | { task: 'voiceClone'; library: 'voices'; id: string; version: number; contentHash: string; providerId: string }
  /** 按需下载的字体（§9.1）：一个族与要下载的 face（按字体目录对好的字重与斜体）。不记下载地址。 */
  | { task: 'fontDownload'; family: string; faces: { weight: number; italic: boolean }[] };

export function generationInputHash(spec: GenerationInputSpec): string {
  const { capability, providerId, modelId, parameters } = spec;
  return `sha256:${sha256Hex(canonicalJson({ capability, providerId, modelId, parameters }))}`;
}
