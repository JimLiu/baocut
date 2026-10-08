import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_SUBTITLE_BYTES,
  SubtitleFileError,
  TRANSCODE_PIPELINE,
  TRANSCRIBE_PIPELINE,
  TRANSLATE_SUBTITLES_PIPELINE,
  decodeSubtitleBytes,
  subtitleFormatOf,
  subtitleText,
} from '@baocut/jobs';
import {
  RpcError,
  type GenerateTextRequest,
  type Id,
  type Localized,
  type SpaceEntry,
  type SpaceEntryKind,
  type SynthesizeSpeechRequest,
} from '@baocut/protocol';
import { methodParamSchemas } from '@baocut/protocol/schemas';
import { RcSpace } from '@baocut/protocol/messages/runtime-core';

/**
 * Space 条目作为工具的输入（架构设计 §7.9「Space 条目作为输入」）：`{ entryId }` 在方法层按 Space 目录换成条目的文件
 * 或文字，流程与任务只看到路径和文本，冻结的参数里没有条目 id。条目的拒绝（不在、回收站、种类不合、没有文件）由
 * `SpaceCatalog.resolveFile` 给出，都在提交时、不建任务。
 */
export interface SpaceFileResolver {
  resolveFile(entryId: Id, kinds: readonly SpaceEntryKind[]): { entry: SpaceEntry; file: string };
}

/** 要媒体文件的输入（转录的 `file`、转码的 `inputs`）：视频文件、成片与音频。 */
export const MEDIA_ENTRY_KINDS: readonly SpaceEntryKind[] = ['video-file', 'export', 'audio'];
/** 字幕文件的翻译的 `input`。 */
export const SUBTITLE_ENTRY_KINDS: readonly SpaceEntryKind[] = ['subtitle'];
/** 语音合成与文本生成的素材：文档与字幕。 */
export const MATERIAL_ENTRY_KINDS: readonly SpaceEntryKind[] = ['document', 'subtitle'];

/** 当文字读的文档扩展名；别的文档（PDF、Word 等）不是纯文字，不收。 */
const TEXT_DOCUMENT_EXTENSIONS = new Set(['txt', 'md', 'markdown']);

function entryIdOf(value: unknown): Id | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entryId = (value as { entryId?: unknown }).entryId;
  return typeof entryId === 'string' && Object.keys(value).length === 1 ? entryId : null;
}

/**
 * `pipelines.start` 的参数里换掉 Space 条目：`transcribe` 的 `file`、`transcode` 的 `inputs[]`、`translate-subtitles`
 * 的 `input`。别的流程与别的字段原样返回；不是 `{ entryId }` 的值留给流程自己的参数检查。
 */
export function resolvePipelineEntryInputs(
  space: SpaceFileResolver,
  pipeline: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const file = (value: unknown, kinds: readonly SpaceEntryKind[]) => {
    const entryId = entryIdOf(value);
    return entryId === null ? value : space.resolveFile(entryId, kinds).file;
  };
  switch (pipeline) {
    case TRANSCRIBE_PIPELINE:
      return 'file' in params ? { ...params, file: file(params.file, MEDIA_ENTRY_KINDS) } : params;
    case TRANSCODE_PIPELINE:
      return Array.isArray(params.inputs) ? { ...params, inputs: params.inputs.map((input) => file(input, MEDIA_ENTRY_KINDS)) } : params;
    case TRANSLATE_SUBTITLES_PIPELINE:
      return 'input' in params ? { ...params, input: file(params.input, SUBTITLE_ENTRY_KINDS) } : params;
    default:
      return params;
  }
}

/**
 * 素材条目的文字：文档（.txt、.md）按文字解码；字幕（.srt、.vtt）去掉时间码与标记，每条一行。别的格式（PDF、ASS 等）
 * `SPACE_ENTRY_UNSUPPORTED`；超过 4 MiB 或字幕读不准时 `invalid-request`（字幕带它的错误码）。
 */
export async function materialText(space: SpaceFileResolver, entryId: Id): Promise<{ text: string; fileName: string }> {
  const { entry, file } = space.resolveFile(entryId, MATERIAL_ENTRY_KINDS);
  const fileName = entry.fileName || path.basename(file);
  const unsupported = (reason: Localized, extra: Record<string, unknown> = {}) =>
    new RpcError('invalid-request', reason, { code: 'SPACE_ENTRY_UNSUPPORTED', entryId, kind: entry.kind, ...extra });
  const subtitle = entry.kind === 'subtitle' ? subtitleFormatOf(file) : null;
  const extension = path.extname(file).slice(1).toLowerCase();
  if (entry.kind === 'subtitle' ? !subtitle : !TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    throw unsupported(RcSpace.materialTextOnly({ fileName }), { accepted: ['txt', 'md', 'markdown', 'srt', 'vtt'] });
  }
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new RpcError('conflict', RcSpace.noReadableFile(), { code: 'SPACE_ENTRY_NO_FILE', entryId });
  if (stat.size > MAX_SUBTITLE_BYTES) {
    throw unsupported(RcSpace.materialTooLarge({ fileName, bytes: stat.size, limit: MAX_SUBTITLE_BYTES }), { bytes: stat.size, limit: MAX_SUBTITLE_BYTES });
  }
  const bytes = await fsp.readFile(file);
  if (!subtitle) return { text: decodeSubtitleBytes(bytes).replace(/^﻿/, ''), fileName };
  try {
    return { text: subtitleText(bytes, subtitle), fileName };
  } catch (error) {
    if (error instanceof SubtitleFileError) {
      throw new RpcError('invalid-request', error.message, { code: error.code, entryId, file, ...error.details });
    }
    throw error;
  }
}

/** 按方法的参数规则再检查一次填好素材之后的请求（长度上限、不能为空），不合时 `invalid-request`。 */
function recheck<T>(method: 'models.synthesizeSpeech' | 'models.generateText', request: T): T {
  const parsed = methodParamSchemas[method].safeParse(request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RpcError('invalid-request', RcSpace.afterMaterial({ reason: issue?.message ?? RcSpace.invalidParams() }), { path: issue?.path ?? [] });
  }
  return request;
}

/** `models.synthesizeSpeech` 的素材：条目的文字当 `text`。不给素材时原样返回。 */
export async function withSpeechMaterial(space: SpaceFileResolver, request: SynthesizeSpeechRequest): Promise<SynthesizeSpeechRequest> {
  if (!request.material) return request;
  const { material, ...rest } = request;
  const { text } = await materialText(space, material.entryId);
  return recheck('models.synthesizeSpeech', { ...rest, text: text.trim() });
}

/** `models.generateText` 的素材：条目的文字接在最后一条用户消息后面（空一行，先写文件名）。不给素材时原样返回。 */
export async function withTextMaterial(space: SpaceFileResolver, request: GenerateTextRequest): Promise<GenerateTextRequest> {
  if (!request.material) return request;
  const { material, ...rest } = request;
  const { text, fileName } = await materialText(space, material.entryId);
  const messages = [...rest.messages];
  const last = messages.findLastIndex((m) => m.role === 'user');
  const block = `${fileName}\n\n${text.trim()}`;
  if (last === -1) messages.push({ role: 'user', content: block });
  else messages[last] = { ...messages[last]!, content: `${messages[last]!.content.trimEnd()}\n\n${block}` };
  return recheck('models.generateText', { ...rest, messages });
}
