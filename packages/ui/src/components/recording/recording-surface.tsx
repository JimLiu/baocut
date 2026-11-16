import './recording-surface.css';
import { createContext, StrictMode, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { RecordingSources } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import { Provider } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { RecordingSurfaceAction, RecordingSurfaceBridge, RecordingSurfaceInit, RecordingSurfaceState } from '../../host.ts';
import { choiceFromOptions, resolveChoice, type RecordingChoice } from '../../model/recording.ts';
import { localeReady, useLocale } from '../../state/locale.ts';
import { useRecordingPrefs } from '../../state/recordings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { SurfaceBar } from './surface-bar.tsx';
import { SurfaceCamera } from './surface-camera.tsx';
import { SurfaceLauncher } from './surface-launcher.tsx';
import { SurfacePicker } from './surface-picker.tsx';

/*
 * 录制的小窗（屏幕录制设计 §11）：启动器、每块屏幕一个选取覆盖层、控制条、摄像头浮窗。都是主进程开的透明窗口，载入同一个页面
 * （`?surface=`），经 preload 的 `window.recordingSurface` 拿状态、发动作；不连 Runtime，开始、取消等由主进程代办。
 * 开始之前的这次「会话」（落点、选择、哪种覆盖层）归主进程，各个小窗看到的是同一份；从倒计时起归 Runtime 的那次录制。
 */

/** 颜色跟随明暗主题：S2 的色板换成变量给 recording-surface.css 用。字体取 S2 的界面字体（Provider 没有 background 时不设字体）。 */
const surfaceVars = style({
  font: 'ui',
  '--rec-gray-25': { type: 'backgroundColor', value: 'gray-25' },
  '--rec-gray-50': { type: 'backgroundColor', value: 'gray-50' },
  '--rec-gray-100': { type: 'backgroundColor', value: 'gray-100' },
  '--rec-gray-200': { type: 'backgroundColor', value: 'gray-200' },
  '--rec-gray-300': { type: 'backgroundColor', value: 'gray-300' },
  '--rec-gray-400': { type: 'backgroundColor', value: 'gray-400' },
  '--rec-gray-500': { type: 'backgroundColor', value: 'gray-500' },
  '--rec-gray-600': { type: 'backgroundColor', value: 'gray-600' },
  '--rec-gray-700': { type: 'backgroundColor', value: 'gray-700' },
  '--rec-gray-800': { type: 'backgroundColor', value: 'gray-800' },
  '--rec-gray-900': { type: 'backgroundColor', value: 'gray-900' },
  '--rec-blue-100': { type: 'backgroundColor', value: 'blue-100' },
  '--rec-blue-400': { type: 'backgroundColor', value: 'blue-400' },
  '--rec-blue-800': { type: 'backgroundColor', value: 'blue-800' },
  '--rec-blue-900': { type: 'backgroundColor', value: 'blue-900' },
  '--rec-orange-100': { type: 'backgroundColor', value: 'orange-100' },
  '--rec-orange-200': { type: 'backgroundColor', value: 'orange-200' },
  '--rec-orange-400': { type: 'backgroundColor', value: 'orange-400' },
  '--rec-orange-700': { type: 'backgroundColor', value: 'orange-700' },
  '--rec-orange-900': { type: 'backgroundColor', value: 'orange-900' },
  '--rec-red-100': { type: 'backgroundColor', value: 'red-100' },
  '--rec-red-400': { type: 'backgroundColor', value: 'red-400' },
  '--rec-red-900': { type: 'backgroundColor', value: 'red-900' },
  '--rec-green-900': { type: 'backgroundColor', value: 'green-900' },
  '--rec-yellow-400': { type: 'backgroundColor', value: 'yellow-400' },
  '--rec-focus': { type: 'outlineColor', value: 'focus-ring' },
});

export interface Surface {
  init: RecordingSurfaceInit;
  state: RecordingSurfaceState;
  sources: RecordingSources | null;
  /** 这次会话的选择（还没落到设备上时 null）。 */
  choice: RecordingChoice | null;
  act(action: RecordingSurfaceAction): Promise<{ ok: true } | { ok: false; message: string }>;
  /** 改选择的一部分（主进程那份是准的，所有小窗随它更新）。 */
  choose(patch: Partial<RecordingChoice>): void;
}

const SurfaceContext = createContext<Surface | null>(null);

export function useSurface(): Surface {
  const s = useContext(SurfaceContext);
  if (!s) throw new Error('recording surface context missing');
  return s;
}

/** 录制小窗页面的入口（apps/desktop 的 renderer 按 `?surface=` 调用）。 */
export async function mountRecordingSurface(root: HTMLElement, bridge: RecordingSurfaceBridge): Promise<void> {
  document.documentElement.classList.add('bc-rec-surface');
  const [init] = await Promise.all([bridge.init(), localeReady()]);
  createRoot(root).render(
    <StrictMode>
      <SurfaceRoot bridge={bridge} init={init} />
    </StrictMode>,
  );
}

// 主窗口改了明暗主题或语言：读回来（同一个源，共用 localStorage）。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'baocut.shell') void useShell.persist.rehydrate();
  });
}

function SurfaceRoot({ bridge, init }: { bridge: RecordingSurfaceBridge; init: RecordingSurfaceInit }) {
  const [state, setState] = useState<RecordingSurfaceState | null>(null);
  const scheme = useShell((s) => s.colorScheme);
  const locale = useLocale();
  useEffect(() => bridge.onState(setState), [bridge]);

  const surface = useMemo<Surface | null>(() => {
    if (!state) return null;
    const choice = state.session?.choice ?? null;
    return {
      init,
      state,
      sources: state.sources.sources,
      choice,
      act: (action) => bridge.act(action),
      choose: (patch) => {
        if (choice) void bridge.act({ type: 'choose', choice: { ...choice, ...patch } });
      },
    };
  }, [bridge, init, state]);

  useResolveChoice(surface);

  if (!surface) return null;
  return (
    <Provider locale={intlLocale(locale)} colorScheme={scheme === 'system' ? undefined : scheme}>
      <SurfaceContext.Provider value={surface}>
        <div className={`bc-rec-root ${surfaceVars}`} key={locale}>
          <SurfaceBody kind={init.kind} />
        </div>
      </SurfaceContext.Provider>
    </Provider>
  );
}

function SurfaceBody({ kind }: { kind: RecordingSurfaceInit['kind'] }) {
  const { state } = useSurface();
  const session = state.session;
  if (kind === 'launcher') return session?.phase === 'launcher' ? <SurfaceLauncher key={session.id} /> : null;
  if (kind === 'picker') return session?.phase === 'picker' && session.choice ? <SurfacePicker key={`${session.id}-${session.picker}`} /> : null;
  if (kind === 'bar') return state.recording ? <SurfaceBar key={state.recording.recordingId} /> : null;
  return <SurfaceCamera />;
}

/**
 * 记下的选择落到这台电脑现在的设备上（`resolveChoice`）：会话刚打开、来源问到了时，启动器或覆盖层里先看到的那个落一次，主进程只收第一份。
 * 智能体发起的用它填好的选项；直接进覆盖层的（菜单栏、快捷键）换成那一种。
 */
function useResolveChoice(surface: Surface | null): void {
  const session = surface?.state.session ?? null;
  const sources = surface?.sources ?? null;
  const pending = !!session && session.choice === null && !!sources && surface?.state.sources.status === 'ready';
  const kind = surface?.init.kind;
  useEffect(() => {
    if (!pending || !session || !sources || !surface || (kind !== 'launcher' && kind !== 'picker')) return;
    const saved = useRecordingPrefs.getState().choice;
    const base = session.agent ? choiceFromOptions(session.agent.options, saved) : saved;
    const { choice, notices } = resolveChoice(base, sources);
    if (session.phase === 'picker') choice.source = session.picker;
    void surface.act({ type: 'resolve', choice, notices });
    // 每次会话落一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, session?.id]);
}
