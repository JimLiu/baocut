import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { sanitizeFileName } from '@baocut/jobs';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import { inside, refuseVideoDirectory } from './artifact-save.ts';
import { formatBytes } from './model-install-tools.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolPrincipal, type ToolScope } from './tool-scope.ts';

/**
 * `downloads_save`（架构设计 §3.5、§7.9）：把会话工作目录里的一个文件复制到下载目录，交给用户。不属于项目的会话的工作目录
 * 用户看不到，智能体自己做出的结果（例如译好的字幕）经它放到下载目录，与从链接导入下载的文件放在一起。
 *
 * - 源：工作目录里的相对路径，按真实路径判断，不能经 `..`、绝对路径或符号链接指到外面；必须是普通文件，不能在视频目录
 *   （含 `video.db`）或 `.bcut` 里；不超过 `DOWNLOAD_SAVE_MAX_BYTES`。检查不过的直接拒绝，不生成审批。
 * - 目标：下载目录（与从链接导入同一个，见 `resolveDownloadsDirectory`），不存在时新建。只新建文件、不覆盖：重名时像从链接
 *   导入那样加序号（`名字-2.srt`）。文件名清理过（与下载的文件同一套规则），扩展名沿用源文件的。写完按真实路径确认在下载目录里。
 * - 风险 `command`（§3.12）：写的是工作目录以外的新文件，`autoAcceptEdits` 下照样询问；只进下载目录、不覆盖，与从链接导入
 *   下载文件同级。只给会话里的智能体（`surfaces` 只有 `agent`）：对外服务与 CLI 没有会话工作目录。
 */

/**
 * 单个文件的上限：这个工具交出去的是智能体做出的文字结果（字幕、文稿、笔记）和少量生成的媒体，几百 KB 到几十 MB；
 * 复制在工具调用里同步完成，上限让一次调用的时间与下载目录的占用有界。更大的成片用 `export` 导出。
 */
export const DOWNLOAD_SAVE_MAX_BYTES = 200 * 1024 * 1024;

/** 文件名（含扩展名）的上限，按字符计：与从链接导入下载的文件名相同。 */
const NAME_MAX_CHARS = 120;
const EXTENSION = /^\.[A-Za-z0-9]{1,16}$/;

export interface DownloadToolsDeps {
  scope: ToolScope;
  /** 此刻的下载目录（设置 `downloads.directory`，否则主机的下载文件夹）。 */
  downloadsDirectory: () => string;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const schemas = {
  downloads_save: z.strictObject({
    path: z.string().min(1).max(1000).describe('工作目录里要交给用户的文件（相对工作目录的路径）'),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。下载目录里的文件名；不给时用源文件名。扩展名沿用源文件的（没写时补上），重名时自动加序号，不覆盖'),
  }),
};

type Args = z.infer<(typeof schemas)['downloads_save']>;

const DEFINITIONS: Record<'downloads_save', ToolInfo> = {
  downloads_save: {
    title: '保存到下载目录',
    description: [
      '把工作目录里的一个文件复制到下载目录（设置 downloads.directory，默认系统的下载文件夹），交给用户。会话不属于项目时，工作目录用户看不到：你自己做出的结果（例如译好的 SRT 字幕、文稿）写在工作目录里，再用它放进下载目录。',
      `path 相对工作目录，不能用 .. 或符号链接指到外面，不能是视频目录或 .bcut 里的文件；只能是普通文件，不超过 ${formatBytes(DOWNLOAD_SAVE_MAX_BYTES)}。只新建文件、不覆盖：重名时自动加序号。`,
      '会按访问模式向用户确认。返回下载目录里的绝对路径 path 与字节数 bytes：把 path 告诉用户。',
    ].join('\n'),
    annotations: { destructiveHint: false },
    effect: 'mutation',
    examples: [{ title: '把译好的字幕交给用户', args: { path: 'out/demo.zh.srt', name: '发布会中文字幕' } }],
    // 只给会话里的智能体：对外服务与 CLI 没有会话工作目录。
    surfaces: ['agent'],
  },
};
// i18n-ignore-end

export class DownloadTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: DownloadToolsDeps;

  constructor(deps: DownloadToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (name !== 'downloads_save') return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    return this.#save(args as Args, principal);
  }

  /** 先检查源与文件名（不合法的不生成审批），确认之后才建目录、写文件。 */
  async #save(args: Args, principal: ToolPrincipal) {
    const { scope } = this.#deps;
    const access = scope.authorize(principal, true);
    const plan = await prepareDownloadSave({
      root: scope.saveRoot(access),
      path: args.path,
      ...(args.name !== undefined ? { name: args.name } : {}),
      downloadsDir: this.#deps.downloadsDirectory(),
    });
    const planned = path.join(plan.directory, plan.name);
    const approval = await scope.confirm(access, {
      tool: 'downloads_save',
      targets: [planned],
      ...confirmSummary(RcAgentTools.downloadSaveSummary({ source: plan.source, size: formatBytes(plan.bytes), target: planned })),
    });
    const saved = await plan.commit();
    return {
      path: saved.path,
      bytes: saved.bytes,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '文件已复制到下载目录（path 是绝对路径）。把这个路径告诉用户；工作目录里的原文件不变。',
    };
  }
}

/** 检查过的复制计划：源（相对工作目录）、目标目录与文件名（重名时 `commit` 加序号）、源的大小。 */
export interface DownloadSavePlan {
  source: string;
  directory: string;
  name: string;
  bytes: number;
  commit(): Promise<{ path: string; bytes: number }>;
}

interface PrepareParams {
  /** 会话的工作目录。 */
  root: string;
  /** 相对工作目录的源路径。 */
  path: string;
  name?: string;
  downloadsDir: string;
  maxBytes?: number;
}

/** 先检查、后写：这一步只读，不建目录、不写文件；`commit` 时按打开的文件句柄再核对一次，检查之后被换掉的源拒绝。 */
export async function prepareDownloadSave(params: PrepareParams): Promise<DownloadSavePlan> {
  const max = params.maxBytes ?? DOWNLOAD_SAVE_MAX_BYTES;
  const rootReal = await fs.realpath(params.root);
  const given = params.path;
  if (path.isAbsolute(given) || path.win32.isAbsolute(given) || given.split(/[\\/]+/).includes('..')) throw outsideSource();
  const resolved = path.resolve(rootReal, given);
  if (resolved === rootReal || !inside(resolved, rootReal)) throw outsideSource();

  const stat = await fs.lstat(resolved).catch(() => null);
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  if (!stat) throw new ToolError('FILE_NOT_FOUND', `工作目录里没有这个文件：${given}`);
  if (stat.isSymbolicLink()) throw new ToolError('PATH_IS_SYMLINK', 'path 是一个符号链接：给它指向的、在工作目录里的文件');
  if (!stat.isFile()) throw new ToolError('NOT_A_FILE', 'path 要是一个普通文件（不是目录）');
  // i18n-ignore-end
  // 上级目录按真实路径判断：经过指向别处的符号链接目录的也算在外面。
  const dirReal = await fs.realpath(path.dirname(resolved));
  if (!inside(dirReal, rootReal)) throw outsideSource();
  const base = path.basename(resolved);
  await refuseVideoDirectory(rootReal, dirReal, [base]).catch((error: unknown) => {
    if (error instanceof ToolError && error.code === 'PATH_INSIDE_VIDEO') {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('PATH_INSIDE_VIDEO', '不能复制视频目录（含 video.db 的目录）或 .bcut 里的文件：要交出视频的内容用 export');
    }
    throw error;
  });
  if (stat.size > max) throw tooLarge(stat.size, max);

  const file = path.join(dirReal, base);
  const name = downloadFileName(params.name ?? base, path.extname(base));
  const directory = path.resolve(params.downloadsDir);
  return {
    source: path.relative(rootReal, file),
    directory,
    name,
    bytes: stat.size,
    commit: () => copyInto(file, stat, directory, name, max),
  };
}

/**
 * 下载目录里的文件名：扩展名沿用源文件的（不是 `.` 加 1–16 个字母数字的不算扩展名），名字没以它结尾时补上；其余部分按下载的
 * 文件名同一套规则清理（去掉路径分隔符、控制字符与开头的 `.`、`-`），连扩展名不超过 120 个字符。
 */
export function downloadFileName(given: string, sourceExtension: string): string {
  const ext = EXTENSION.test(sourceExtension) ? sourceExtension : '';
  const matched = ext !== '' && given.toLowerCase().endsWith(ext.toLowerCase()) && given.length > ext.length;
  const stem = sanitizeFileName(matched ? given.slice(0, -ext.length) : given);
  const limited = [...stem]
    .slice(0, NAME_MAX_CHARS - ext.length)
    .join('')
    .replace(/[.\s]+$/, '');
  return `${limited || 'download'}${matched ? given.slice(-ext.length) : ext}`;
}

async function copyInto(
  file: string,
  checked: Stats,
  directory: string,
  name: string,
  max: number,
): Promise<{ path: string; bytes: number }> {
  // 不跟随符号链接打开源，再按句柄核对它还是检查过的那个文件。
  let source: fs.FileHandle;
  try {
    source = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if (code === 'ELOOP') throw new ToolError('PATH_IS_SYMLINK', 'path 是一个符号链接：给它指向的、在工作目录里的文件');
    if (code === 'ENOENT') throw new ToolError('FILE_NOT_FOUND', '文件在检查之后不见了');
    // i18n-ignore-end
    throw error;
  }
  try {
    const now = await source.stat();
    if (!now.isFile() || now.ino !== checked.ino || now.dev !== checked.dev) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('SOURCE_CHANGED', '文件在检查之后被换掉了：确认它是你要交出的文件后重新调用');
    }
    if (now.size > max) throw tooLarge(now.size, max);

    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error) {
      throw unavailable(directory, error);
    }
    const dirReal = await fs.realpath(directory);
    const ext = path.extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    for (let n = 1; n < 10_000; n++) {
      const target = path.join(dirReal, `${stem}${n === 1 ? '' : `-${n}`}${ext}`);
      let out: fs.FileHandle;
      try {
        // 'wx'：已经存在（含符号链接）时失败，不覆盖、不跟随；权限按 0644 新建，不沿用源文件的可执行位。
        out = await fs.open(target, 'wx', 0o644);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw unavailable(directory, error);
      }
      let bytes = 0;
      try {
        // 按块从句柄读、往句柄写，不把整个文件读进内存；读到的超过上限（检查之后文件变大了）时放弃。
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        for (;;) {
          const { bytesRead } = await source.read(buffer, 0, buffer.length, bytes);
          if (bytesRead === 0) break;
          bytes += bytesRead;
          if (bytes > max) throw tooLarge(bytes, max);
          for (let written = 0; written < bytesRead;) written += (await out.write(buffer, written, bytesRead - written)).bytesWritten;
        }
      } catch (error) {
        await out.close().catch(() => {});
        await fs.rm(target, { force: true });
        throw error;
      }
      await out.close();
      if (!inside(await fs.realpath(target), dirReal)) {
        await fs.rm(target, { force: true });
        throw unavailable(directory);
      }
      return { path: target, bytes };
    }
    // i18n-ignore: 给模型的工具说明、错误与下一步
    throw new ToolError('DOWNLOAD_NAME_EXHAUSTED', `下载目录里同名的文件太多：换一个 name`);
  } finally {
    await source.close().catch(() => {});
  }
}

function outsideSource(): ToolError {
  // i18n-ignore: 给模型的工具说明、错误与下一步
  return new ToolError('PATH_OUTSIDE_WORKSPACE', 'path 要是这个会话工作目录里的文件（相对路径，不含 ..，不经过指向别处的符号链接）');
}

function tooLarge(size: number, max: number): ToolError {
  // i18n-ignore: 给模型的工具说明、错误与下一步
  return new ToolError('FILE_TOO_LARGE', `文件有 ${formatBytes(size)}，超过了 ${formatBytes(max)} 的上限：成片用 export 导出`, {
    bytes: size,
    limit: max,
  });
}

function unavailable(directory: string, error?: unknown): ToolError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  return new ToolError(
    'DOWNLOADS_UNAVAILABLE',
    `下载目录不能写入：${directory}。请用户检查设置里的下载目录（downloads.directory）是否存在、可写${code === 'ENOSPC' ? '，磁盘是否已满' : ''}`,
    code ? { reason: code } : {},
  );
  // i18n-ignore-end
}
