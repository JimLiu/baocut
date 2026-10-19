import { useEffect, useRef } from 'react';

/**
 * 组件还挂着没有：异步结果回来时先看一眼，卸下后不再写状态。建立时要重新置为 true——StrictMode 开发模式会把 effect
 * 先清理一遍再建立，只在清理里置 false 的写法会让它从此一直是 false，结果全被丢掉。
 */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}
