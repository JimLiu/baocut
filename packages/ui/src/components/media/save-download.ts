import { useMemo } from 'react';
import { ToastQueue } from '@react-spectrum/s2';
import type { FileFilter, HostBridge } from '../../host.ts';
import { shortenPath } from '../../model/format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useSetting } from '../../state/settings-store.ts';
import { downloadBlob } from './gif.ts';
import { SAVE as M } from './save-download-copy.ts';

type SaveHost = Pick<HostBridge, 'saveUrl' | 'saveFile'>;

/** 组件里的下载入口用：带上宿主与设置里的默认保存位置（`downloads.directory`），失败时提示原因。 */
export function useSaveDownload(): { media(url: string, name: string): void; blob(blob: Blob, name: string): void } {
  const { host } = useRuntime();
  const dir = useSetting('downloads.directory');
  return useMemo(
    () => ({
      media: (url: string, name: string) => reportSave(saveMedia(host, url, name, dir)),
      blob: (blob: Blob, name: string) => reportSave(saveBlob(host, blob, name, dir)),
    }),
    [host, dir],
  );
}

/**
 * 下载 Runtime 媒体通道里的文件（图片预览的下载、音视频的「保存副本…」、文件标签与生成结果的下载）。桌面端经主进程
 * （`host.saveUrl`）弹系统存储对话框、按地址流式写盘，不交给系统浏览器；存好后提示路径，取消不提示。`defaultDir` 是对话框
 * 初始打开的目录（设置里的默认保存位置），不给时从系统的下载文件夹开始。Web 交给浏览器下载。失败时抛出，消息是给人看的原因。
 */
export async function saveMedia(host: SaveHost, url: string, name: string, defaultDir?: string | null): Promise<void> {
  if (!host.saveUrl) {
    browserDownload(url, name);
    return;
  }
  saved(await host.saveUrl({ url, ...saveOptions(name, defaultDir) }).catch(rethrow));
}

/** 下载界面手上的一份内容（例如 GIF 的单帧）：桌面端经 `host.saveFile` 由主进程写盘，Web 交给浏览器下载。失败时抛出。 */
export async function saveBlob(host: SaveHost, blob: Blob, name: string, defaultDir?: string | null): Promise<void> {
  if (!host.saveFile) {
    downloadBlob(blob, name);
    return;
  }
  saved(await host.saveFile({ data: new Uint8Array(await blob.arrayBuffer()), ...saveOptions(name, defaultDir) }).catch(rethrow));
}

/** 不另外处理失败的入口用：失败时提示原因。 */
export function reportSave(task: Promise<void>): void {
  task.catch((error: unknown) => ToastQueue.negative(M.failed(saveError(error)), { timeout: 6000 }));
}

/** 失败的原因：去掉 Electron 给主进程错误加的「Error invoking remote method …」前缀。 */
export function saveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}

function rethrow(error: unknown): never {
  throw new Error(saveError(error));
}

function saveOptions(name: string, defaultDir?: string | null): { defaultName: string; filters?: FileFilter[]; defaultDir?: string } {
  const ext = /\.([A-Za-z0-9]{1,16})$/.exec(name)?.[1];
  return {
    defaultName: name,
    ...(ext ? { filters: [{ name: ext.toUpperCase(), extensions: [ext] }] } : {}),
    ...(defaultDir ? { defaultDir } : {}),
  };
}

function saved(path: string | null): void {
  if (path) ToastQueue.positive(M.saved(shortenPath(path)), { timeout: 5000 });
}

/**
 * 浏览器下载：同源地址用 `download` 属性按给的文件名存；跨源时浏览器不认这个属性，带 `download=1` 让 Runtime 回
 * `Content-Disposition: attachment`，浏览器下载而不是打开它。
 */
function browserDownload(url: string, name: string): void {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin && (target.protocol === 'http:' || target.protocol === 'https:')) target.searchParams.set('download', '1');
  const link = document.createElement('a');
  link.href = target.href;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}
