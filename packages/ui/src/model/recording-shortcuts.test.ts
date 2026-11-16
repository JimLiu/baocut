import { describe, expect, it } from 'vitest';
import { acceleratorLabel, acceleratorOf, lacksModifier, type KeyPress } from './recording-shortcuts.ts';

const press = (over: Partial<KeyPress>): KeyPress => ({ code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe('录制快捷键', () => {
  it('按键写成 accelerator：要带 ⌘、⌥ 或 ⌃，只加 Shift 与单个 F 键都不算；只按修饰键还在等', () => {
    expect(acceleratorOf(press({ code: 'Digit2', metaKey: true, shiftKey: true }), 'darwin')).toBe('CommandOrControl+Shift+2');
    expect(acceleratorOf(press({ code: 'KeyR', ctrlKey: true, altKey: true }), 'win32')).toBe('CommandOrControl+Alt+R');
    expect(acceleratorOf(press({ code: 'KeyR', ctrlKey: true }), 'darwin')).toBe('Control+R');
    expect(acceleratorOf(press({ code: 'KeyR' }), 'darwin')).toBeNull();
    expect(acceleratorOf(press({ code: 'KeyR', shiftKey: true }), 'darwin')).toBeNull();
    expect(acceleratorOf(press({ code: 'F9' }), 'darwin')).toBeNull();
    expect(acceleratorOf(press({ code: 'F9', altKey: true }), 'darwin')).toBe('Alt+F9');
    expect(lacksModifier(press({ code: 'KeyR', shiftKey: true }))).toBe(true);
    expect(lacksModifier(press({ code: 'ShiftLeft', shiftKey: true }))).toBe(false);
    expect(lacksModifier(press({ code: 'KeyR', ctrlKey: true }))).toBe(false);
    expect(acceleratorOf(press({ code: 'ShiftLeft', shiftKey: true }), 'darwin')).toBeNull();
  });

  it('给人看的写法按系统', () => {
    expect(acceleratorLabel('CommandOrControl+Shift+2', 'darwin')).toBe('⇧⌘2');
    expect(acceleratorLabel('CommandOrControl+Shift+2', 'win32')).toBe('Ctrl+Shift+2');
    expect(acceleratorLabel('', 'darwin')).toBe('');
  });
});
