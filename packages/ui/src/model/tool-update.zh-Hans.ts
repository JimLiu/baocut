import type { ToolUpdateMessages } from './tool-update.ts';

export const zhHans: ToolUpdateMessages = {
  standalone: '官方独立程序',
  updateInTerminal: '在终端里更新',
  unknownInstall: '判断不了这份 yt-dlp 是怎么装的。按当初的安装方式执行其中一条，完成后点「重新检测」。',
  cannotRun: 'BaoCut 不能代为执行这条命令。',
  thenRecheck: '完成后点「重新检测」。',
  runThenRecheck: '在终端里执行这条命令，完成后点「重新检测」。',
  updateWith: (method) => `用 ${method} 更新`,
  stoppedTitle: '已停止更新',
  stoppedBody: '命令可能只做了一部分。看下方输出，点「重新检测」确认 yt-dlp 现在的版本。',
  failedTitle: (exitCode) => (exitCode === null ? '更新没有完成' : `更新没有完成（退出码 ${exitCode}）`),
  failedBody: (error) => `${error ? `${error.replace(/[。.]$/, '')}。` : ''}原来的 yt-dlp 不受影响。输出在下方；也可以复制命令到终端里执行，再点「重新检测」。`,
  updatedTo: (version) => `已更新到 ${version}`,
  upToDate: (version) => (version ? `已是最新版本 ${version}` : '已是最新版本'),
  logTruncated: '…（前面的输出已省略，完整输出在任务记录里）\n',
  logStopped: '（已停止）',
  logExitCode: (exitCode) => `（退出码 ${exitCode}）`,
};
