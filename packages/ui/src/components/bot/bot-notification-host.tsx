import { useEffect, useRef } from 'react';
import { MAIN_CHANNEL_ID } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { channelById, useChannels } from '../../state/channels-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { BOT_COPY as C } from './bot-copy.ts';

/**
 * 应用在跟前时的 Bot 提醒（需求 §11.10、BOT-NF-*）：收到 `bot.notification` 弹一条提示，点「打开」进那条任务。
 * 静音频道不弹；正看着那个频道时不弹（线程卡与任务面板已经在眼前）；窗口不在前台时不弹，系统通知由桌面端负责。
 */
export function BotNotificationHost() {
  const notification = useChannels((s) => s.notification);
  const seen = useRef(notification?.seq ?? 0);
  useEffect(() => {
    if (!notification || notification.seq <= seen.current) return;
    seen.current = notification.seq;
    const { event } = notification;
    if (event.muted || !document.hasFocus()) return;
    const route = useShell.getState().route;
    const viewing = route.tab === 'bot' && route.view !== 'inbox' && (route.channelId ?? MAIN_CHANNEL_ID) === event.channelId;
    if (viewing) return;
    const channel = channelById(event.channelId);
    const text = C.notify.toast(channel?.name ?? C.notify.reason[event.reason], event.headline || C.notify.reason[event.reason]);
    ToastQueue.info(text, {
      timeout: 8000,
      actionLabel: C.notify.open,
      shouldCloseOnAction: true,
      onAction: () => useShell.getState().go({ tab: 'bot', channelId: event.channelId, workItemId: event.workItemId, view: 'channel' }),
    });
  }, [notification]);
  return null;
}
