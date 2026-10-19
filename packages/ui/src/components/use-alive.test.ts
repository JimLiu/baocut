// @vitest-environment happy-dom
import { StrictMode, act, createElement, useEffect, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAlive } from './use-alive.ts';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

it('stays alive after StrictMode re-runs effects, so async results still land (version history spinner)', async () => {
  let alive: RefObject<boolean> | null = null;
  let setups = 0;
  function Probe() {
    alive = useAlive();
    useEffect(() => {
      setups++;
    }, []);
    return null;
  }
  await act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
  // 开发版 React 在 StrictMode 下把 effect 清理后再建立一次；没跑两遍说明这里测不到要防的情况。
  expect(setups).toBe(2);
  expect(alive!.current).toBe(true);
  await act(() => root.unmount());
  expect(alive!.current).toBe(false);
});
