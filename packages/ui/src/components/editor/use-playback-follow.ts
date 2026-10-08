import { useEffect, useRef, type RefObject } from 'react';
import { useEditor } from '../../state/editor-store.ts';

/**
 * 字幕列表与译文对照列表的播放跟随开关（产品设计 §5.7，与文稿同一条规则）：播放中用户手动滚开就停，在本面板里跳播
 * （点时间、点卡片、查找跳转）或从暂停重新开始播放时恢复。跟到哪、怎么对齐由列表自己做（这两处只滚到可见，不居中）。
 *
 * 手动滚开只认用户输入，与文稿面板（transcript-panel.tsx 的 `leaveFollow`）和原型同一口径：滚轮、触摸拖动、按在滚动容器
 * 本身上（即滚动条）。不看 scroll 事件——虚拟列表补锚点、对准时写的 scrollTop，以及点开一张半露的卡编辑时输入框 focus()
 * 带出的那一下滚动，都不算滚开。键盘翻页（PageDown 等）也不算，与文稿相同。暂停时的输入不算（暂停本来就不跟）。
 */
export function usePlaybackFollow(scrollRef: RefObject<HTMLElement | null>): { off: RefObject<boolean>; resume(): void } {
  const off = useRef(false);
  const playing = useEditor((s) => s.playing);
  const resume = useRef(() => {
    off.current = false;
  }).current;
  // 要排在列表自己的跟随 effect 前面（同一次提交里先恢复再跟）：调用方先调这个 hook。
  useEffect(() => {
    if (playing) resume();
  }, [playing, resume]);

  // 滚动容器可能晚于 hook 出现（先画「正在读取…」）：每次提交后看一眼，换了就重接。
  const attached = useRef<{ el: HTMLElement; detach(): void } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (attached.current?.el === el) return;
    attached.current?.detach();
    attached.current = null;
    if (!el) return;
    const leave = () => {
      if (useEditor.getState().playing) off.current = true;
    };
    // 按在容器本身（不是里面的卡）上：只可能是滚动条。
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === el) leave();
    };
    el.addEventListener('wheel', leave, { passive: true });
    el.addEventListener('touchmove', leave, { passive: true });
    el.addEventListener('pointerdown', onPointerDown);
    attached.current = {
      el,
      detach: () => {
        el.removeEventListener('wheel', leave);
        el.removeEventListener('touchmove', leave);
        el.removeEventListener('pointerdown', onPointerDown);
      },
    };
  });
  useEffect(
    () => () => {
      attached.current?.detach();
      attached.current = null;
    },
    [],
  );
  return { off, resume };
}
