import { describe, expect, it } from 'vitest';
import { shellShortcut, type KeyLike } from './shell-shortcuts.ts';

const key = (init: Partial<KeyLike> & { key: string }): KeyLike => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init });

describe('应用级快捷键', () => {
  it('macOS：⌘[ ⌘] ⌘N ⌘, ⇧⌘H ⇧⌘B ⌃⌘S', () => {
    expect(shellShortcut(key({ key: '[', metaKey: true }), true)).toBe('back');
    expect(shellShortcut(key({ key: ']', metaKey: true }), true)).toBe('forward');
    expect(shellShortcut(key({ key: 'n', code: 'KeyN', metaKey: true }), true)).toBe('new');
    expect(shellShortcut(key({ key: ',', code: 'Comma', metaKey: true }), true)).toBe('settings');
    expect(shellShortcut(key({ key: 'H', code: 'KeyH', metaKey: true, shiftKey: true }), true)).toBe('space');
    expect(shellShortcut(key({ key: 'B', code: 'KeyB', metaKey: true, shiftKey: true }), true)).toBe('tasks');
    expect(shellShortcut(key({ key: 's', code: 'KeyS', metaKey: true, ctrlKey: true }), true)).toBe('sidebar');
  });

  it('不带修饰键或多带了修饰键时不接', () => {
    expect(shellShortcut(key({ key: 'n', code: 'KeyN' }), true)).toBeNull();
    expect(shellShortcut(key({ key: 'n', code: 'KeyN', metaKey: true, altKey: true }), true)).toBeNull();
    expect(shellShortcut(key({ key: 's', code: 'KeyS', metaKey: true }), true)).toBeNull();
  });

  it('Windows / Linux：Ctrl 代替 ⌘，Alt+←/→ 后退前进', () => {
    expect(shellShortcut(key({ key: 'ArrowLeft', altKey: true }), false)).toBe('back');
    expect(shellShortcut(key({ key: 'n', code: 'KeyN', ctrlKey: true }), false)).toBe('new');
    expect(shellShortcut(key({ key: 'n', code: 'KeyN', metaKey: true }), false)).toBeNull();
  });
});
