import path from 'node:path';
import { stat } from 'node:fs/promises';

/** 只交给系统打开文档与媒体，不从模型回复启动程序、脚本或快捷方式。 */
const DOCUMENT_EXTENSIONS = new Set(('pdf txt md markdown csv tsv json xml yaml yml toml log rtf doc docx odt xls xlsx ods ppt pptx odp html htm ' +
  'png jpg jpeg gif webp svg bmp avif heic tif tiff mp4 mov m4v webm mkv avi mp3 wav m4a aac flac ogg opus srt vtt ass ssa').split(' '));

export function localDocumentPath(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || !path.isAbsolute(value)) return null;
  return DOCUMENT_EXTENSIONS.has(path.extname(value).slice(1).toLowerCase()) ? path.normalize(value) : null;
}

/** null 表示不支持，空串成功，其余是操作系统给出的错误。 */
export async function openLocalFile(value: unknown, open: (file: string) => Promise<string>): Promise<string | null> {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || !path.isAbsolute(value)) return null;
  const file = path.normalize(value);
  try {
    if (!(await stat(file)).isFile() || !localDocumentPath(file)) return null;
    return await open(file);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
