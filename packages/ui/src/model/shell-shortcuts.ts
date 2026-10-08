/** 应用级快捷键（原型 main.jsx）。编辑器、输入框自己的键不在这里。 */
export type ShellAction = 'back' | 'forward' | 'new' | 'space' | 'tasks' | 'settings' | 'sidebar';

export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * macOS 用 ⌘；Windows 与 Linux 用 Ctrl，后退前进用 Alt+←/→。
 * 字母按物理键（`code`）判断，输入法与 Shift 改写 `key` 时也认得出。
 */
export function shellShortcut(event: KeyLike, mac: boolean): ShellAction | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const letter = event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  if (mac ? mod && !event.shiftKey && event.key === '[' : event.altKey && !event.ctrlKey && event.key === 'ArrowLeft') return 'back';
  if (mac ? mod && !event.shiftKey && event.key === ']' : event.altKey && !event.ctrlKey && event.key === 'ArrowRight') return 'forward';
  if (mac && event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey && letter === 's') return 'sidebar';
  if (!mod || event.altKey) return null;
  if (!event.shiftKey && letter === 'n') return 'new';
  if (!event.shiftKey && (event.key === ',' || event.code === 'Comma')) return 'settings';
  if (event.shiftKey && letter === 'h') return 'space';
  if (event.shiftKey && letter === 'b') return 'tasks';
  return null;
}
