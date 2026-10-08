import { useEffect, useState, type RefObject } from 'react';

/** 元素比 `width` 窄时返回 true；留白随模式变化的容器用 border-box，避免内容宽度反过来切换模式。 */
export function useNarrow(ref: RefObject<HTMLElement | null>, width: number, box: 'content-box' | 'border-box' = 'content-box'): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = box === 'border-box'
        ? (entry?.borderBoxSize?.[0]?.inlineSize ?? element.getBoundingClientRect().width)
        : (entry?.contentRect.width ?? width);
      setNarrow(measured < width);
    });
    observer.observe(element, { box });
    return () => observer.disconnect();
  }, [ref, width, box]);
  return narrow;
}
