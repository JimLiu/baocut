/** Rust canonical paths use the Windows extended namespace; Node path.relative expects ordinary drive/UNC paths. */
export function hostPath(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return value;
  if (value.startsWith('\\\\?\\UNC\\')) return '\\\\' + value.slice(8);
  if (/^\\\\\?\\[A-Za-z]:\\/.test(value)) return value.slice(4);
  return value;
}
