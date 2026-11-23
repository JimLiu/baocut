import path from 'node:path';
import type { FileTarget, VideoAnnotation } from '@baocut/protocol';
import type { ResolvedVideoAnnotation } from '@baocut/harness';

/**
 * 消息带的视频标注（产品设计 §3.2.3「视频标注」）：每条的视频目录换成相对会话工作目录的路径
 * （`/` 分隔、以 `/` 结尾，工作目录外是绝对路径）；找不到时由 `locate` 抛 `not-found`。`revision` 落后于当前版本时不拒绝。
 * 没有标注时为 undefined。
 */
export function resolveVideoAnnotations(
  annotations: readonly VideoAnnotation[] | undefined,
  cwd: string,
  locate: (target: FileTarget) => { root: string; file: string },
): ResolvedVideoAnnotation[] | undefined {
  if (!annotations?.length) return undefined;
  return annotations.map((annotation) => ({ annotation, videoPath: dirPathFor(locate(annotation.video), cwd) }));
}

/** 目录相对会话工作目录的写法：`/` 分隔、以 `/` 结尾；不在工作目录里时是绝对路径；就是工作目录时是 `./`。 */
export function dirPathFor({ root, file }: { root: string; file: string }, cwd: string): string {
  const dir = path.resolve(root, file);
  const rel = path.relative(cwd, dir);
  const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  const shown = outside ? dir : rel.split(path.sep).filter(Boolean).join('/');
  return shown ? `${shown.replace(/[\\/]+$/, '')}/` : './';
}
