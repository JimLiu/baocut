import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { refOf, RpcError, type Localized, type MessageRef, type VideoRef } from '@baocut/protocol';
import { RcExport } from '@baocut/protocol/messages/runtime-core';

/**
 * 导出的落点与发布（架构设计 §9.11）：默认在视频来源目录（项目目录，或不属于项目的会话的工作目录）下的 `exports/`；
 * 文件名是「视频名.种类后缀.扩展名」，重名时加序号「 (2)」，不覆盖已有的文件，除非明确要求。
 *
 * 发布：先把 staging 里校验过的文件复制到目标目录里的隐藏临时文件（staging 与目标可能不在一个卷上），再用硬链接
 * 把它挂到最终的名字上——链接在名字已存在时失败，不会覆盖别人的文件，也不会有写了一半的文件出现在最终的名字下。
 * 目标卷不支持硬链接（例如 exFAT）时退回「确认不存在再改名」，两步之间有很短的竞态窗口。要求覆盖时直接改名替换。
 */

export class DestinationError extends Error {
  readonly code: 'EXPORT_DESTINATION_EXISTS' | 'EXPORT_DESTINATION_UNWRITABLE';
  readonly path: string;
  readonly messageRef: MessageRef | undefined;
  constructor(code: DestinationError['code'], message: string | Localized, file: string) {
    super(String(message));
    this.code = code;
    this.path = file;
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }

  toRpc(): RpcError {
    const recovery =
      this.code === 'EXPORT_DESTINATION_EXISTS' ? RcExport.destinationExistsRecovery() : RcExport.destinationUnwritableRecovery();
    return new RpcError('conflict', this.message, { code: this.code, path: this.path, recovery: recovery.text }, this.messageRef);
  }
}

/** 视频的来源目录：视频目录去掉相对来源目录的路径。 */
export function sourceRoot(ref: VideoRef): string {
  const depth = ref.relPath.split('/').filter((s) => s && s !== '.').length;
  return depth === 0 ? path.dirname(ref.path) : path.resolve(ref.path, ...Array<string>(depth).fill('..'));
}

/** 文件名里不能有的字符换成 `_`；空名用 `video`。 */
export function safeFileStem(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return cleaned || 'video';
}

/** 给定的文件名补上（或换成）正确的扩展名。 */
export function withExtension(fileName: string, extension: string): string {
  return path.extname(fileName).toLowerCase() === `.${extension}` ? fileName : `${fileName}.${extension}`;
}

/** 第 n 个候选名：`a.srt`、`a (2).srt`、`a (3).srt`…… */
export function candidateName(fileName: string, n: number): string {
  if (n <= 1) return fileName;
  const ext = path.extname(fileName);
  return `${fileName.slice(0, fileName.length - ext.length)} (${n})${ext}`;
}

async function exists(file: string): Promise<boolean> {
  return fs.lstat(file).then(
    () => true,
    () => false,
  );
}

/**
 * 预检目标目录：给了的必须是已经存在、可写的绝对路径；默认的 `exports/` 按需建。返回目录的绝对路径。
 */
export async function prepareDirectory(dir: string, isDefault: boolean): Promise<string> {
  if (!path.isAbsolute(dir)) throw new DestinationError('EXPORT_DESTINATION_UNWRITABLE', RcExport.destinationNotAbsolute(), dir);
  if (isDefault) {
    await fs.mkdir(dir, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
      throw new DestinationError('EXPORT_DESTINATION_UNWRITABLE', RcExport.destinationCreateFailed({ reason: error.code ?? error.message }), dir);
    });
  }
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) throw new DestinationError('EXPORT_DESTINATION_UNWRITABLE', RcExport.destinationNotDirectory(), dir);
  try {
    await fs.access(dir, fsConstants.W_OK);
  } catch {
    throw new DestinationError('EXPORT_DESTINATION_UNWRITABLE', RcExport.destinationNotWritable(), dir);
  }
  return dir;
}

/** 预检：给定的文件名已经存在而没有要求覆盖时拒绝。默认名重名时发布再加序号，这里不拒绝。 */
export async function checkFixedName(dir: string, fileName: string, overwrite: boolean): Promise<void> {
  const file = path.join(dir, fileName);
  if (!overwrite && (await exists(file))) {
    throw new DestinationError('EXPORT_DESTINATION_EXISTS', RcExport.destinationFileExists({ fileName }), file);
  }
}

/**
 * 把 staging 里的文件发布到 `dir/fileName`。`fixed` 时名字不能变（重名就拒绝），否则重名加序号。
 * 返回最终的绝对路径。临时文件在任何结局下都清掉。
 */
export async function publishFile(
  staged: string,
  dir: string,
  fileName: string,
  options: { overwrite: boolean; fixed: boolean },
): Promise<string> {
  const tmp = hiddenTemp(dir, fileName);
  try {
    await fs.copyFile(staged, tmp);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new DestinationError(
      'EXPORT_DESTINATION_UNWRITABLE',
      RcExport.destinationWriteFailed({ reason: (error as NodeJS.ErrnoException).code ?? String(error) }),
      dir,
    );
  }
  return publishInPlace(tmp, dir, fileName, options);
}

/** 目标目录里的隐藏临时文件名：发布前的输出先写在这里。 */
export function hiddenTemp(dir: string, fileName: string): string {
  return path.join(dir, `.${fileName}.${randomUUID().slice(0, 8)}.tmp`);
}

/** `name` 是不是 `hiddenTemp` 为输出 `fileName` 取的临时文件名（`.<fileName>.<8 位十六进制>.tmp`）。 */
export function isHiddenTempOf(name: string, fileName: string): boolean {
  const prefix = `.${fileName}.`;
  return name.startsWith(prefix) && /^[0-9a-f]{8}\.tmp$/.test(name.slice(prefix.length));
}

/**
 * 把已经写在目标目录里的隐藏临时文件 `tmp` 挂到最终的名字上（规则同 `publishFile`）。便携包直接写在目标目录里，
 * 不经 staging 再复制一遍。临时文件在任何结局下都清掉。
 */
export async function publishInPlace(
  tmp: string,
  dir: string,
  fileName: string,
  options: { overwrite: boolean; fixed: boolean },
): Promise<string> {
  try {
    if (options.overwrite) {
      const final = path.join(dir, fileName);
      await fs.rename(tmp, final);
      return final;
    }
    for (let n = 1; n <= 999; n++) {
      const name = candidateName(fileName, n);
      const final = path.join(dir, name);
      try {
        await fs.link(tmp, final);
        return final;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          if (options.fixed) throw new DestinationError('EXPORT_DESTINATION_EXISTS', RcExport.destinationFileExists({ fileName: name }), final);
          continue;
        }
        // 不支持硬链接的卷：确认不存在再改名。
        if (await exists(final)) {
          if (options.fixed) throw new DestinationError('EXPORT_DESTINATION_EXISTS', RcExport.destinationFileExists({ fileName: name }), final);
          continue;
        }
        await fs.rename(tmp, final);
        return final;
      }
    }
    throw new DestinationError('EXPORT_DESTINATION_EXISTS', RcExport.destinationTooManyDuplicates(), path.join(dir, fileName));
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
