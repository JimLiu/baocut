import type { EditOperation, GenerationParameters, JobRecord } from '@baocut/protocol';
import { JobsGeneratedImport as J } from '@baocut/protocol/messages/jobs/generated-import.ts';

/**
 * 生成的输出导入视频的那一个操作（架构设计 §5.7、§7.3）。生成任务给了视频时由 JobManager 用它导入；没给视频的任务，
 * 之后把产物「加到视频」也用它（智能体经 `edits_apply` 的 `importAsset` + `artifactId`），两条路记下的来源完全相同。
 *
 * - bytes 总是收进视频目录（`managed`）：产物库里的文件不是用户的原文件，不能链接（视频格式规范 §4.2）。
 * - 来源只记任务、Provider、模型、参数与摘要，不记原文与提示词（它们只在任务记录里）。
 */
export function generatedImportOperation(
  record: JobRecord,
  output: { artifactId: string; file: string; index: number; total: number },
  options: { name?: string | null; ref?: string } = {},
): EditOperation {
  const generation = record.generation!;
  const base = options.name ?? defaultAssetName(generation);
  const { text: _text, prompt: _prompt, ...parameters } = generation as GenerationParameters & { text?: string; prompt?: string };
  return {
    type: 'importAsset',
    path: output.file,
    name: output.total > 1 ? `${base} ${output.index + 1}` : base,
    ...(options.ref !== undefined ? { ref: options.ref } : {}),
    storage: 'managed',
    provenance: {
      origin: 'generated',
      source: {
        jobId: record.jobId,
        capability: generation.capability,
        providerId: record.providerId,
        modelId: record.modelId,
        inputHash: record.inputHash,
        contentHash: record.contentHash,
        artifactId: output.artifactId,
        parameters,
      },
    },
  };
}

/** 不给名字时的素材名：种类加原文或提示词的开头。（文本生成不导入视频，这里只为类型完整。） */
function defaultAssetName(parameters: GenerationParameters): string {
  const source =
    parameters.capability === 'synthesizeSpeech'
      ? parameters.text
      : parameters.capability === 'generateImage'
        ? parameters.prompt
        : (parameters.messages.findLast((m) => m.role === 'user')?.content ?? '');
  const head = [...source.replace(/\s+/g, ' ').trim()].slice(0, 24).join('');
  const more = [...source.trim()].length > 24 ? '…' : '';
  const name = parameters.capability === 'synthesizeSpeech' ? J.voiceOverName : J.imageName;
  return name({ head: `${head}${more}` }).text;
}
