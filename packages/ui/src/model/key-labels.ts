/**
 * 快捷键的写法：清单一律按 macOS 记（⌘ ⇧ ⌥），Windows 与 Linux 上把修饰键换成 Ctrl+、Shift+、Alt+。
 * 编辑器的快捷键清单（shortcut-sheet）与帮助中心的快捷键页共用这一处（原型 help-center.jsx `keyLabel`）。
 */
export function keyLabel(keys: string, mac: boolean): string {
  if (mac) return keys;
  // 单独写的修饰键（「⇧ 走 5%」「⌥ 以中心对称」）后面跟空格，不加「+」。
  return keys
    .replace(/⇧(?= )/g, 'Shift')
    .replace(/⌘(?= )/g, 'Ctrl')
    .replace(/⌥(?= )/g, 'Alt')
    .replace(/⇧/g, 'Shift+')
    .replace(/⌘/g, 'Ctrl+')
    .replace(/⌥/g, 'Alt+');
}
