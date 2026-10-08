/*
 * toast 只停几秒（2026-10-08 用户要求：「toast 只显示几秒即可，不用一直在那里」）。S2 的 ToastQueue 有两处不合：
 * 不给 `timeout` 的 toast 一直挂着；带按钮（`actionLabel`）的 toast 不管给不给 `timeout` 都不自动关（S2 按 WCAG 2.2.1 的取舍）。
 * 这里在启动时包一层：没给 `timeout` 的按 DEFAULT_MS；带按钮的由这里计时关掉，指针停在 toast 上或焦点在里面时顺延，
 * 免得正要点「撤销」时它消失。时长不短于 S2 的 5 秒下限。
 */

export const DEFAULT_MS = 5000;
const MIN_MS = 5000;

type Variant = 'neutral' | 'positive' | 'negative' | 'info';
const VARIANTS: readonly Variant[] = ['neutral', 'positive', 'negative', 'info'];

/** S2 `ToastQueue` 的形状（参数按 S2 的 `SpectrumToastOptions` 取需要的几样）。 */
export interface ToastOptions {
  timeout?: number;
  actionLabel?: string;
  onClose?: () => void;
  [key: string]: unknown;
}
export type ToastQueueLike = Record<Variant, (children: string, options?: ToastOptions) => () => void>;

/** 指针或焦点还在 toast 上：S2 自己计时的 toast 这时也会暂停。 */
function toastHeld(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[role="region"] [role="alertdialog"]:hover, [role="region"] [role="alertdialog"]:focus-within');
}

const installed = new WeakSet<object>();

/** 给 toast 队列（S2 的 `ToastQueue`）装上自动关闭；同一个队列只装一次。返回卸下的函数（测试用）。 */
export function installToastAutoDismiss(queue: ToastQueueLike, held = toastHeld): () => void {
  if (installed.has(queue)) return () => {};
  installed.add(queue);
  const original = { ...queue };
  for (const variant of VARIANTS) {
    const add = original[variant];
    queue[variant] = (children, options = {}) => {
      const ms = Math.max(options.timeout ?? DEFAULT_MS, MIN_MS);
      if (!options.actionLabel) return add(children, { ...options, timeout: ms });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const close = add(children, {
        ...options,
        onClose: () => {
          clearTimeout(timer);
          options.onClose?.();
        },
      });
      const arm = () => {
        timer = setTimeout(() => (held() ? arm() : close()), ms);
      };
      arm();
      return () => {
        clearTimeout(timer);
        close();
      };
    };
  }
  return () => {
    Object.assign(queue, original);
    installed.delete(queue);
  };
}
