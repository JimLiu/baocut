import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { setLocale } from '@baocut/protocol';
import { appMenuTemplate } from './app-menu.ts';
import { M } from './main-copy.ts';
import { localeFromRenderer, startupLocale } from './main-locale.ts';

function labels(items: MenuItemConstructorOptions[]): string[] {
  return items.map((item) => item.label ?? '');
}

function submenu(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  return (item?.submenu ?? []) as MenuItemConstructorOptions[];
}

function useEnglish(): void {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
}

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('appMenuTemplate', () => {
  it('builds the macOS menu in English', () => {
    useEnglish();
    const menu = appMenuTemplate('darwin', 'BaoCut');
    expect(labels(menu)).toEqual(['BaoCut', 'File', 'Edit', 'View', 'Window']);
    expect(labels(submenu(menu[0]))).toContain('Quit BaoCut');
    expect(submenu(menu[2]).find((item) => item.role === 'copy')?.label).toBe('Copy');
    // 「窗口」菜单带 role，macOS 才会列出打开的窗口。
    expect(menu[4]?.role).toBe('window');
  });

  it('builds the Windows menu without the app menu', () => {
    useEnglish();
    const menu = appMenuTemplate('win32', 'BaoCut');
    expect(labels(menu)).toEqual(['File', 'Edit', 'View', 'Window']);
    expect(submenu(menu[0])).toEqual([{ role: 'quit', label: 'Exit' }]);
    expect(menu[3]?.role).toBeUndefined();
  });

  it('follows the current locale on every build', () => {
    expect(labels(appMenuTemplate('darwin', 'BaoCut'))).toEqual(['BaoCut', '文件', '编辑', '显示', '窗口']);
    useEnglish();
    expect(labels(appMenuTemplate('darwin', 'BaoCut'))).toEqual(['BaoCut', 'File', 'Edit', 'View', 'Window']);
  });

  it('gives every item with a role a label, so nothing falls back to Electron’s English defaults', () => {
    const walk = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
      items.flatMap((item) => [item, ...walk(submenu(item))]);
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const item of walk(appMenuTemplate(platform, 'BaoCut'))) {
        if (item.type !== 'separator') expect(item.label, `${platform} ${item.role}`).toBeTruthy();
      }
    }
  });
});

describe('main process copy', () => {
  it('reads dialog and error text in English', () => {
    useEnglish();
    expect(M.openProjectTitle).toBe('Open project folder');
    expect(M.mediaFilter).toBe('Videos, audio, and images');
    expect(M.runtimeExited(1)).toBe('Runtime failed to start (exit code 1)');
    expect(M.webOpenScheme).toBe('Only http and https URLs can be opened');
  });

  it('keeps the Chinese text', () => {
    expect(M.openProjectTitle).toBe('打开项目目录');
    expect(M.runtimeExited(1)).toBe('Runtime 启动失败（退出码 1）');
  });
});

describe('main process locale', () => {
  it('starts from the system languages, falling back to English', () => {
    expect(startupLocale(['zh-Hans-CN', 'en-US'])).toBe('zh-Hans');
    expect(startupLocale(['en-GB'])).toBe('en');
    expect(startupLocale(['fr-FR', 'de-DE'])).toBe('fr');
    expect(startupLocale(['ar-EG', 'de-DE'])).toBe('de');
    expect(startupLocale(['ar-EG'])).toBe('en');
    expect(startupLocale([])).toBe('en');
  });

  it('only accepts shipped locales from the renderer', () => {
    expect(localeFromRenderer('en')).toBe('en');
    expect(localeFromRenderer('zh-Hans')).toBe('zh-Hans');
    expect(localeFromRenderer('zh-CN')).toBeNull();
    expect(localeFromRenderer('system')).toBeNull();
    expect(localeFromRenderer(42)).toBeNull();
    expect(localeFromRenderer(undefined)).toBeNull();
  });
});
