import type { ToolUpdateMessages } from './tool-update.ts';

export const zhHant: ToolUpdateMessages = {
  standalone: '官方獨立執行檔',
  updateInTerminal: '在終端機中更新',
  unknownInstall: '無法判斷這份 yt-dlp 的安裝方式。請依你當初的安裝方式執行對應的指令，完成後按一下「重新檢查」。',
  cannotRun: 'BaoCut 無法代你執行這個指令。',
  thenRecheck: '完成後按一下「重新檢查」。',
  runThenRecheck: '請在終端機中執行這個指令，完成後按一下「重新檢查」。',
  updateWith: (method) => `使用 ${method} 更新`,
  stoppedTitle: '已停止更新',
  stoppedBody: '指令可能只執行了一部分。請查看下方的輸出，再按一下「重新檢查」確認目前的 yt-dlp 版本。',
  failedTitle: (exitCode) => (exitCode === null ? '更新未完成' : `更新未完成（結束代碼 ${exitCode}）`),
  failedBody: (error) =>
    `${error ? `${error.replace(/[。.]$/, '')}。` : ''}原有的 yt-dlp 不受影響。輸出在下方；也可以複製指令到終端機中執行，再按一下「重新檢查」。`,
  updatedTo: (version) => `已更新到 ${version}`,
  upToDate: (version) => (version ? `已是最新版本（${version}）` : '已是最新版本'),
  logTruncated: '…（前面的輸出已省略，完整輸出在任務記錄中）\n',
  logStopped: '（已停止）',
  logExitCode: (exitCode) => `（結束代碼 ${exitCode}）`,
};
