import { shortenPath } from './format.ts';

/*
 * 旧版项目导入询问的纯逻辑（设计稿 model-legacy-import.js；架构设计 §2.7）。询问本身由 Runtime 给出（`legacy-import` 主题），
 * 默认目录也是 Runtime 算的（系统「文稿 / 文档」文件夹下的 `BaoCut`）；这一层只算回答发什么、目录怎么写给人看。
 */

/** 对话框上的两个按钮；关掉对话框按「跳过」算。 */
export type LegacyImportChoice = 'import' | 'skip';

/**
 * 回答 → 发给 Runtime 的决定。null 表示不发：这次跳过，询问留在 Runtime 里，界面这次启动不再弹、下次启动再问。
 * 勾了「不再提醒」又点「导入」：照常导入——导入之后本来就不会再问。
 */
export function legacyImportDecision(choice: LegacyImportChoice, never: boolean): 'import' | 'never' | null {
  if (choice === 'import') return 'import';
  return never ? 'never' : null;
}

/**
 * 导入目录给人看的写法：macOS 与 Linux 把家目录缩成 `~`；Windows 没有 `~` 的说法，原样写盘符与反斜杠。
 * 都去掉结尾的分隔符（根目录除外）。
 */
export function displayDirectory(dir: string, platform: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  const shown = trimmed === '' || /^[A-Za-z]:$/.test(trimmed) ? dir : trimmed;
  return platform === 'win32' ? shown : shortenPath(shown);
}
