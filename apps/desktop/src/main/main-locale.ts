import { isLocale, resolveLanguage, type Locale } from '@baocut/protocol';

/*
 * 主进程的界面语言（仓库约定 §5）：菜单与对话框跟界面用同一种语言。启动时界面还没告诉主进程，先按系统的首选语言定一个；
 * 之后界面每次换语言（启动时也一次）经 `baocut:set-locale` 告诉主进程（preload 的 `setLocale`，界面的 `useLanguageSync`）。
 */

/** 界面还没告诉主进程之前的语言：跟随系统的首选语言，没有对应的出货语言时英文。 */
export function startupLocale(systemLanguages: readonly string[]): Locale {
  return resolveLanguage('system', systemLanguages);
}

/** 渲染进程传来的语言：只认出货语言，别的（类型不对、不认识的标签）丢掉。 */
export function localeFromRenderer(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}
