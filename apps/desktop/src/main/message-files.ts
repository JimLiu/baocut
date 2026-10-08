import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '@baocut/protocol';
import type { MessageFile } from '@baocut/ui';

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/** macOS 可混选；Windows / Linux 必须在打开系统选择器前决定选文件还是目录。 */
export function messageFileProperties(platform: string, folders: boolean): ('openFile' | 'openDirectory' | 'multiSelections')[] {
  return platform === 'darwin' ? ['openFile', 'openDirectory', 'multiSelections'] : [folders ? 'openDirectory' : 'openFile', 'multiSelections'];
}

/** 只读取系统选择器刚返回的图片；其他文件和目录保留路径，不递归读取目录内容。 */
export async function messageFiles(paths: readonly string[], images: boolean): Promise<MessageFile[]> {
  let imageCount = 0;
  const result: MessageFile[] = [];
  for (const selected of paths) {
    const stat = await fs.stat(selected);
    const entry: MessageFile = { path: selected, kind: stat.isDirectory() ? 'directory' : 'file' };
    const mimeType = IMAGE_MIME[path.extname(selected).toLowerCase()];
    if (images && stat.isFile() && mimeType && stat.size > 0 && stat.size <= MAX_ATTACHMENT_BYTES && imageCount < MAX_ATTACHMENTS_PER_MESSAGE) {
      // 用固定上限读取，文件在 stat 后变大时也不会向渲染进程发送超大数据。
      const handle = await fs.open(selected, 'r');
      try {
        const bytes = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < bytes.length) {
          const read = await handle.read(bytes, length, bytes.length - length, length);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length > 0 && length <= stat.size) {
          entry.image = { mimeType, bytes: new Uint8Array(bytes.subarray(0, length)) };
          imageCount++;
        }
      } finally { await handle.close(); }
    }
    result.push(entry);
  }
  return result;
}
