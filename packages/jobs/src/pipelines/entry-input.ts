import { JobsEntryInput } from '@baocut/protocol/messages/jobs/entry-input.ts';
import { invalid } from './params.ts';

/**
 * Space 条目作为流程的文件输入（架构设计 §7.9「Space 条目作为输入」）：参数里可以是绝对路径或 `{ entryId }`。
 * 条目由 Runtime 在 `pipelines.start` 的方法层换成路径，流程只冻结路径；没换掉的条目到这里以 `invalid-request` 拒绝。
 */
export function fileInputSchema(pathDescription: string, entryDescription: string): Record<string, unknown> {
  return {
    oneOf: [
      { type: 'string', description: pathDescription },
      {
        type: 'object',
        properties: { entryId: { type: 'string', description: entryDescription } },
        required: ['entryId'],
        additionalProperties: false,
      },
    ],
  };
}

/** 参数里没换掉的 `{ entryId }`：说明要经 `pipelines.start` 提交。不是条目时什么都不做，交给调用方的检查。 */
export function rejectUnresolvedEntry(key: string, value: unknown): void {
  if (typeof value === 'object' && value !== null && typeof (value as { entryId?: unknown }).entryId === 'string') {
    throw invalid(key, JobsEntryInput.unresolvedEntry());
  }
}
