// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { NewTaskDialog } from './task-panel.tsx';

/*
 * Bot 页组件的行为测试（docs/design/bot-mode 需求 §11）：假的 Runtime 只记下发了哪些 RPC，按方法给出结果。
 */

type Handler = (params: Record<string, unknown>) => unknown;

let container: HTMLDivElement;
let root: Root;
let handlers: Record<string, Handler>;
const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
  const handler = handlers[method];
  if (!handler) throw new Error(`unexpected ${method}`);
  return handler(params);
});
const runtime = { client: { request } } as unknown as RuntimeSession;

async function render(element: ReactElement) {
  await act(() => root.render(createElement(RuntimeContext.Provider, { value: runtime }, element)));
}

function calls(method: string): Record<string, unknown>[] {
  return request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
}

async function press(label: string) {
  const target = button(label);
  if (!target) throw new Error(`no button ${label}`);
  await act(async () => target.click());
}

async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  handlers = {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  request.mockClear();
  vi.unstubAllGlobals();
});

describe('新建任务（需求 §4.4）', () => {
  it('默认「我来做」、不马上开始：直接添加时建的是用户自己的任务，进接下来', async () => {
    handlers['workItems.create'] = (p) => ({ item: { id: 'wi1', ...p } });
    await render(createElement(NewTaskDialog, { channelId: 'c1', onClose: () => {}, onCreated: () => {} }));
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.find((r) => r.checked)?.value).toBe('user');
    // 「我来做」时没有「马上开始」。
    expect(document.querySelector('input[role="switch"]')).toBeNull();
    await typeInto(document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!, '录第 12 期口播');
    await press('添加');
    expect(calls('workItems.create')).toEqual([expect.objectContaining({ channelId: 'c1', title: '录第 12 期口播', owner: 'user', start: false })]);
  });
});
