import type { ExportDestination } from '@baocut/protocol';
import type { HostBridge } from '../host.ts';

/** null 是用户取消；Web 没有本机保存能力，仍由 Runtime 保存。 */
export async function pickExportDestination(
  host: HostBridge,
  names: readonly string[],
  dir: string | null,
  labels: { title: string; button: string; pickPlace: string },
): Promise<ExportDestination | null> {
  if (!host.pickSavePath) return dir ? { dir } : {};
  if (names.length !== 1) {
    const picked = await host.pickDirectory({ title: labels.pickPlace });
    return picked ? { dir: picked } : null;
  }
  const name = names[0]!;
  const extension = name.slice(name.lastIndexOf('.') + 1);
  const file = await host.pickSavePath({
    title: labels.title,
    buttonLabel: labels.button,
    defaultName: name,
    ...(dir ? { defaultDir: dir } : {}),
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  if (!file) return null;
  const cut = host.platform === 'win32' ? Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) : file.lastIndexOf('/');
  // 根目录需保留分隔符（/ 与 C:\）；UNC / 扩展路径前缀原样交给 Runtime。
  const root = cut === 0 || (cut === 2 && /^[A-Za-z]:/.test(file));
  const fileName = file.slice(cut + 1);
  // Runtime 会补上格式扩展名；补出的另一个文件未经系统窗口确认，不能替换它。
  const overwrite = fileName.toLowerCase().endsWith(`.${extension.toLowerCase()}`);
  return { dir: file.slice(0, cut + (root ? 1 : 0)), fileName, overwrite };
}
