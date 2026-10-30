import { useEffect, useRef } from 'react';
import { ToastQueue } from '@react-spectrum/s2';
import { attentionChannel, attentionEvents, waitingCount, type AttentionEvent } from '../model/attention.ts';
import { useRuntime } from '../runtime/context.tsx';
import { useDirectory } from '../state/directory-store.ts';
import { useShell } from '../state/shell-store.ts';
import { ATTENTION_COPY as A } from './attention-copy.ts';

/** 算「人在跟前」的输入。 */
const INPUTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * 提醒（产品设计 §3.1「提醒」）：会话等你批准或回答、任务做完或失败时，按你在不在跟前选择不打扰、应用内提示或系统通知；
 * 徽标上是在等你的会话条数。规则在 model/attention.ts，系统那一侧在宿主（`HostBridge.notifications`，Web 没有，只在页面内提示）。
 * 设置 › 通用里关掉时都不提醒，徽标清零。挂在外壳上，离开哪一页都在。
 */
export function AttentionHost() {
  const host = useRuntime().host.notifications;
  const enabled = useShell((s) => s.notifications);
  // 打开应用这一刻算人在跟前。
  const lastInputAt = useRef<number | null>(Date.now());

  useEffect(() => {
    const mark = () => {
      lastInputAt.current = Date.now();
    };
    const options = { capture: true, passive: true };
    for (const type of INPUTS) window.addEventListener(type, mark, options);
    return () => {
      for (const type of INPUTS) window.removeEventListener(type, mark, options);
    };
  }, []);

  // 点系统通知：窗口已经回到前台（宿主做的），这里打开那条会话。
  useEffect(() => host?.onClick((conversationId) => open(conversationId)), [host]);

  useEffect(() => {
    if (!enabled) return;
    return useDirectory.subscribe((next, prev) => {
      // 快照（首次连上、重连）是新的基线：断开期间的变化不补发。
      if (!next.ready || !prev.ready || next.snapshots !== prev.snapshots || next.conversations === prev.conversations) return;
      const route = useShell.getState().route;
      // 只有 Home 的会话区显示会话本身；Space 的悬浮会话每次都是新会话的输入框，看不到在跑的那条，照常提示。
      const presence = {
        focused: document.hasFocus() && document.visibilityState === 'visible',
        viewing: route.tab === 'home' ? route.conversationId : null,
        lastInputAt: lastInputAt.current,
      };
      const now = Date.now();
      for (const event of attentionEvents(prev.conversations, next.conversations)) {
        const channel = attentionChannel(presence, event.conversationId, now);
        if (channel === 'toast') toast(event);
        else if (channel === 'system')
          host?.show({ title: event.title.trim() || 'BaoCut', body: A[event.kind], conversationId: event.conversationId });
      }
    });
  }, [enabled, host]);

  const waiting = useDirectory((s) => waitingCount(s.conversations));
  useEffect(() => {
    host?.setBadge(enabled ? waiting : 0);
  }, [host, enabled, waiting]);

  return null;
}

function open(conversationId: string) {
  useShell.getState().go({ tab: 'home', conversationId, projectId: null });
}

function toast(event: AttentionEvent) {
  const message = `${event.title.trim() || 'BaoCut'} · ${A[event.kind]}`;
  const options = { timeout: 5000, actionLabel: A.view, onAction: () => open(event.conversationId), shouldCloseOnAction: true };
  if (event.kind === 'failed') ToastQueue.negative(message, options);
  else ToastQueue.neutral(message, options);
}
