/**
 * 设计稿运行时的 `downloads` 能力（docs/design/canvas §4、§8.3）：导出的文件在 iframe 里，保存要由 BaoCut 界面来做。
 *
 * 运行时导出（整份设计稿、单个画板、选区）时调 `save({ filename, data })`，这里转成 `editor:save-file` 发给父窗口；
 * 父窗口交给浏览器下载或弹存储对话框，回 `editor:save-file-result`。`declined`（用户取消了）与 `failed` 都拒绝，
 * 错误带 `code`：运行时把 `declined` 当作用户取消，别的当作宿主没能保存（单个画板的导出退回 iframe 里的浏览器下载）。
 * 不设超时：存储对话框可以一直开着。
 *
 * 页面单独打开（不在 BaoCut 的 iframe 里，例如 claude-design skill 的本地服务）时没有父窗口可交，用 createBrowserDownloads：
 * 文件直接交给浏览器下载，`save` 随即兑现，运行时按已保存处理（整份导出由此能存下，PDF 的字体说明等也照常提示）。
 */
import type { SaveFileOutcome } from '@baocut/slides/editor-messages';
import type { ParentLink } from '@baocut/slides/editor';

export interface HostSaveFile {
  filename: string;
  data: Blob | ArrayBuffer;
  /** 父窗口经 frame 协议要的那次导出的编号；BaoCut 不用它对应。 */
  request?: string;
}

export interface HostDownloadsCapability {
  save(file: HostSaveFile): Promise<void>;
}

export interface DownloadsBridge {
  capability: HostDownloadsCapability;
  /** 停止收父窗口的消息，等着的都按没保存处理。 */
  dispose(): void;
}

/** 拒绝时给运行时读的错误：`code` 是 `declined` 或 `failed`（export/downloads.tsx 的 downloadErrorCode）。 */
class SaveFileError extends Error {
  readonly code: Exclude<SaveFileOutcome, 'saved'>;
  constructor(code: Exclude<SaveFileOutcome, 'saved'>) {
    super(code === 'declined' ? 'the save was cancelled' : 'the file was not saved');
    this.code = code;
  }
}

export function createDownloadsBridge(link: ParentLink, newId: () => string = () => crypto.randomUUID()): DownloadsBridge {
  const pending = new Map<string, (outcome: SaveFileOutcome) => void>();
  const stop = link.onMessage(message => {
    if (message.type === 'editor:save-file-result') pending.get(message.requestId)?.(message.outcome);
  });
  return {
    capability: {
      save: ({ filename, data }) =>
        new Promise<void>((resolve, reject) => {
          const requestId = newId();
          pending.set(requestId, outcome => {
            pending.delete(requestId);
            if (outcome === 'saved') resolve();
            else reject(new SaveFileError(outcome));
          });
          link.post({ type: 'editor:save-file', requestId, filename, data });
        }),
    },
    dispose() {
      stop();
      for (const settle of [...pending.values()]) settle('failed');
    },
  };
}

/** 页面单独打开时的 `downloads`：用一个临时的 `<a download>` 交给浏览器下载。 */
export function createBrowserDownloads(win: Window & typeof globalThis = window): HostDownloadsCapability {
  return {
    save: async ({ filename, data }) => {
      const blob = data instanceof win.Blob ? data : new win.Blob([data]);
      const url = win.URL.createObjectURL(blob);
      const anchor = win.document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      win.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // 浏览器开始下载后才能撤销，留足时间
      win.setTimeout(() => win.URL.revokeObjectURL(url), 60_000);
    },
  };
}
