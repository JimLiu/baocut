import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getLocale, intlLocale, onLocaleChange, resolveLanguage, setLocale, type LanguagePreference, type Locale } from '@baocut/protocol';
import { useRuntime } from '../runtime/context.tsx';
import { useConnection } from './connection-store.ts';
import { useSetting, useSettings } from './settings-store.ts';
import { useShell } from './shell-store.ts';

/*
 * 界面语言（设置 › 通用 › 界面语言）：偏好存在 shell-store（这台电脑上的界面），`system` 时跟随浏览器 / 系统的首选语言，
 * 没有对应的出货语言时英文。解析出的语言设成进程的当前语言（@baocut/protocol i18n），文案目录按它取字。
 * 切换时界面根以语言为 key 整体重画（app.tsx），所以组件不用各自订阅；跨屏状态在 store 里，不受影响。
 */

function systemLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

function apply(): void {
  setLocale(resolveLanguage(useShell.getState().language, systemLanguages()));
  if (typeof document !== 'undefined') document.documentElement.lang = intlLocale();
}

// 模块加载时就定下语言：第一帧就用对的语言画，不先闪一下英文。
apply();
useShell.subscribe((s, prev) => {
  if (s.language !== prev.language) apply();
});
if (typeof window !== 'undefined') window.addEventListener('languagechange', apply);

/** 当前界面语言；变化时重画调用它的组件。 */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, getLocale, getLocale);
}

/**
 * 能改 Runtime 设置的宿主（桌面端）把界面语言写进 `ui.language`：Runtime 生成文字（错误原因、任务说明、它建的默认名字）
 * 用的语言跟界面一致。连上时以界面的偏好为准；之后别处（CLI 的 `baocut settings set ui.language`）改了它，界面跟着换。
 * 浏览器客户端改不了 Runtime 设置（Web 服务的方法白名单），只换自己的界面。宿主也可以借 `setLocale` 换原生菜单与对话框的语言。
 */
export function useLanguageSync(): void {
  const runtime = useRuntime();
  const preference = useShell((s) => s.language);
  const setLanguage = useShell((s) => s.setLanguage);
  const seen = useRef<LanguagePreference | null>(null);
  const locale = useLocale();
  const stored = useSetting('ui.language');
  const loaded = useSettings((s) => s.snapshot !== null);
  const connected = useConnection((s) => s.state.status === 'connected');
  const canWrite = runtime.host.platform !== 'web';

  useEffect(() => {
    runtime.host.setLocale?.(locale);
  }, [runtime, locale]);

  useEffect(() => {
    if (!canWrite || !connected || !loaded) return;
    const previous = seen.current;
    seen.current = stored;
    if (stored === preference) return;
    if (previous !== null && stored !== null && stored !== previous) {
      setLanguage(stored);
      return;
    }
    runtime.client.request('settings.set', { values: { 'ui.language': preference } }).catch(() => {
      // 写不进去时界面照样换语言；Runtime 下次连上再写。
    });
  }, [runtime, canWrite, connected, loaded, stored, preference, setLanguage]);
}
