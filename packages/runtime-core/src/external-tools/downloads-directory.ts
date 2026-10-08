import os from 'node:os';
import path from 'node:path';

/**
 * 下载目录（架构设计 §7.9）：从链接导入只下载时的文件，以及不属于项目的会话里智能体交给用户的结果（`downloads_save`），
 * 都放在这里。设置 `downloads.directory` 优先；没有设置时是主机的下载文件夹。
 *
 * `BAOCUT_DOWNLOADS_DIR` 是主机的下载文件夹：桌面应用经它传入系统的下载文件夹（Windows 的已知文件夹、Linux 的 XDG 目录），
 * 测试用它指到临时目录、不往真实的下载文件夹里写；别的方式启动的 Runtime（CLI）没有它，用主目录下的 Downloads。
 */
export function resolveDownloadsDirectory(configured: string | null): string {
  if (configured) return configured;
  return process.env.BAOCUT_DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads');
}

/**
 * 保存位置（架构设计 §7.9「保存位置」）：工具没有视频的结果（文件到文件的流程、无目标的转录、直接任务的生成物副本）都落在这里。
 * 调用给了目录（流程参数 `outDir`、直接任务的 `saveDir`）用它；否则同下载目录：设置 `downloads.directory`，再否则主机的下载文件夹。
 * 主机的判断只在 `resolveDownloadsDirectory` 一处。
 */
export function resolveSaveDirectory(options: { override?: string | null | undefined; settings: string | null }): string {
  if (options.override) return options.override;
  return resolveDownloadsDirectory(options.settings);
}
