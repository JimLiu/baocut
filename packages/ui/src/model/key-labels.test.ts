import { describe, expect, it } from 'vitest';
import { keyLabel } from './key-labels.ts';

describe('keyLabel', () => {
  it('macOS 原样给出', () => {
    expect(keyLabel('⌘Z / ⇧⌘Z', true)).toBe('⌘Z / ⇧⌘Z');
    expect(keyLabel('⌥← / ⌥→', true)).toBe('⌥← / ⌥→');
  });

  it('Windows 与 Linux 换成 Ctrl+ / Shift+ / Alt+', () => {
    expect(keyLabel('⌘Z / ⇧⌘Z', false)).toBe('Ctrl+Z / Shift+Ctrl+Z');
    expect(keyLabel('⌥← / ⌥→', false)).toBe('Alt+← / Alt+→');
    expect(keyLabel('⇧← / ⇧→', false)).toBe('Shift+← / Shift+→');
  });

  it('单独写的修饰键后面跟空格时不加「+」', () => {
    expect(keyLabel('方向键（⇧ 走 5%，⌥↑ / ⌥↓ 走 0.1%）', false)).toBe('方向键（Shift 走 5%，Alt+↑ / Alt+↓ 走 0.1%）');
  });

  it('不带修饰键的写法不变', () => {
    expect(keyLabel('Space / K', false)).toBe('Space / K');
    expect(keyLabel('?', false)).toBe('?');
  });
});
