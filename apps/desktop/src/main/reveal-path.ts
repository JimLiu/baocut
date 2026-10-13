import path from 'node:path';

/** Convert known Windows file namespaces at the shell boundary; stored paths stay unchanged. */
export function revealPath(value: unknown, platform: NodeJS.Platform = process.platform): string | null {
  if (typeof value !== 'string' || value.includes('\0')) return null;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(value)) return null;
  const normalized = paths.normalize(value);
  if (platform !== 'win32') return normalized;
  if (/^\\\\\?\\[A-Za-z]:\\/.test(normalized)) return normalized.slice(4);
  if (/^\\\\\?\\UNC\\[^\\]+\\[^\\]+(?:\\|$)/i.test(normalized)) return `\\\\${normalized.slice(8)}`;
  // Volume GUIDs and device namespaces do not have a general DOS/UNC mapping.
  return normalized;
}

/** Files and directories use the same native shell action. */
export function showInFolder(value: unknown, show: (target: string) => void, platform: NodeJS.Platform = process.platform): void {
  const target = revealPath(value, platform);
  if (target !== null) show(target);
}
