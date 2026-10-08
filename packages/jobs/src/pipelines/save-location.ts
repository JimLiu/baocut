import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { RpcError } from '@baocut/protocol';
import { JobsSaveLocation } from '@baocut/protocol/messages/jobs/save-location.ts';
import { PipelineStepError } from './pipeline.ts';
import { sanitizeFileName } from './yt-dlp.ts';

/**
 * 保存位置（架构设计 §7.9「保存位置」）：没有视频的结果落在一个目录里。目录在提交时确定并冻结，不存在时创建，
 * 不能写入是 `OUTPUT_DESTINATION_UNAVAILABLE`。目录怎么选（调用给的、设置、主机的下载文件夹）由 Runtime 决定，
 * 这里只负责「建好、确认能写」与可读的文件名。
 */

export const OUTPUT_DESTINATION_UNAVAILABLE = 'OUTPUT_DESTINATION_UNAVAILABLE';

/** 建好目录并确认能写；不行时返回原因，否则 null。 */
export async function writableDirectoryProblem(dir: string): Promise<string | null> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return JobsSaveLocation.notDirectory().text;
    await fs.access(dir, fsConstants.W_OK);
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));
  }
}

/** 提交时（`prepare`、直接任务的提交）：目录建不了或不能写时以 `conflict` 拒绝，不建任务。 */
export async function ensureSaveDirectory(dir: string): Promise<void> {
  const problem = await writableDirectoryProblem(dir);
  if (problem !== null) {
    throw new RpcError('conflict', JobsSaveLocation.unwritable({ dir, problem }), { code: OUTPUT_DESTINATION_UNAVAILABLE, dir, reason: problem });
  }
}

/** 发布时（流程的一步）：目录在提交之后被挪走或改了权限，这一步以 `OUTPUT_DESTINATION_UNAVAILABLE` 失败，可以重试。 */
export async function ensureSaveDirectoryForStep(dir: string): Promise<void> {
  const problem = await writableDirectoryProblem(dir);
  if (problem !== null) throw new PipelineStepError(OUTPUT_DESTINATION_UNAVAILABLE, JobsSaveLocation.unwritable({ dir, problem }), { dir, reason: problem });
}

/** 取自提示词或原文开头的字数上限：够认出是哪一份，又不至于成一长串。 */
const TITLE_CHARS = 40;

/**
 * 可读的文件名（不含扩展名）：取文字开头一段（空白合成一个空格），按下载的文件同样的规则清理（`sanitizeFileName`）；
 * 文字是空的时用 `fallback`。
 */
export function readableStem(text: string, fallback: string): string {
  const head = [...text.replace(/\s+/g, ' ').trim()].slice(0, TITLE_CHARS).join('');
  return sanitizeFileName(head || fallback);
}
