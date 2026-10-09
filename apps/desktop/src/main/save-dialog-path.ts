import path from 'node:path';

/** 文件名不能夹带目录；初始目录按宿主的路径规则处理。 */
export function saveDialogPath(defaultName: unknown, defaultDir: unknown, platform = process.platform): string | undefined {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const name = typeof defaultName === 'string' ? paths.basename(defaultName).slice(0, 200) : '';
  const dir = typeof defaultDir === 'string' && !/[\u0000-\u001f\u007f]/.test(defaultDir) && paths.isAbsolute(defaultDir) ? defaultDir : '';
  return dir ? paths.join(dir, name) : name || undefined;
}
