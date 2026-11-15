/*
 * 录制的全局快捷键（屏幕录制设计 §11「录制中」）：设置里录一组键、写成 Electron accelerator，再给人看。纯函数，有单测。
 */

/** 按下的一组键（键盘事件里要用的那几项）。 */
export interface KeyPress {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * 把一次按键写成 accelerator（`CommandOrControl+Shift+2`）。只按了修饰键时 `null`（还在等主键）；没有修饰键的单键
 * （F 键除外）与只加 Shift 的不收：全局快捷键会吞掉别的应用里的这一下打字。主键按 `code` 取，不受键盘布局与 Shift 影响。
 */
export function acceleratorOf(press: KeyPress, platform: string): string | null {
  const main = mainKey(press.code);
  if (!main) return null;
  const mods: string[] = [];
  const mac = platform === 'darwin';
  if (mac ? press.metaKey : press.ctrlKey) mods.push('CommandOrControl');
  if (mac && press.ctrlKey) mods.push('Control');
  if (!mac && press.metaKey) mods.push('Super');
  if (press.altKey) mods.push('Alt');
  if (press.shiftKey) mods.push('Shift');
  const fn = /^F\d{1,2}$/.test(main);
  if (!fn && (mods.length === 0 || (mods.length === 1 && mods[0] === 'Shift'))) return null;
  return [...mods, main].join('+');
}

const NAMED: Record<string, string> = {
  Space: 'Space',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
};

function mainKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  return NAMED[code] ?? null;
}

const MAC_SYMBOLS: Record<string, string> = { CommandOrControl: '⌘', Command: '⌘', Super: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };
const MAC_ORDER = ['Control', 'Alt', 'Shift', 'CommandOrControl', 'Command', 'Super'];
const PC_NAMES: Record<string, string> = { CommandOrControl: 'Ctrl', Control: 'Ctrl', Super: 'Win' };

/** accelerator 给人看的写法：macOS 用 ⌃⌥⇧⌘ 符号，别的系统写 `Ctrl+Shift+2`。空串（不用）返回空串，由调用方写「不用」。 */
export function acceleratorLabel(accelerator: string, platform: string): string {
  if (!accelerator) return '';
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  if (platform === 'darwin') {
    const mods = [...parts].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return mods.map((m) => MAC_SYMBOLS[m] ?? m).join('') + key;
  }
  return [...parts.map((m) => PC_NAMES[m] ?? m), key].join('+');
}
