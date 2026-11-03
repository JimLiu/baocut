// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useAccessState } from '../../state/system-access-store.ts';
import { FullDiskNotice, OpenAccessButton } from './full-disk-access.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const open = vi.fn(async () => {});
const relaunch = vi.fn(async () => true);

function session(bridge: boolean): RuntimeSession {
  return {
    host: { platform: 'darwin', ...(bridge ? { systemAccess: { openFullDiskAccess: open, relaunch } } : {}) },
    access: async () => ({ platform: 'darwin', fullDiskAccess: 'missing' as const }),
  } as unknown as RuntimeSession;
}

async function render(node: React.ReactElement, bridge = true) {
  await act(async () => {
    root.render(createElement(RuntimeContext.Provider, { value: session(bridge) }, node));
  });
}

beforeEach(() => {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
  open.mockClear();
  relaunch.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useAccessState.setState({ loaded: true, platform: 'darwin', access: 'missing', step: 'idle', asked: false });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await act(async () => root.unmount());
  host.remove();
  setLocale('zh-Hans');
});

const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

describe('FullDiskNotice', () => {
  it('names the browsers and opens System Settings, then switches to the restart step', async () => {
    await render(createElement(FullDiskNotice, { browsers: ['safari'] }));
    expect(host.textContent).toContain('Allow BaoCut to read Safari cookies');
    await act(async () => button('Open System Settings')!.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Turn on BaoCut in System Settings, then come back');
    await act(async () => button('Restart BaoCut')!.click());
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(button('Open System Settings again')).toBeTruthy();
  });

  it('shows nothing once access is granted, without a desktop bridge, or when no browser needs it', async () => {
    await render(createElement(FullDiskNotice, { browsers: ['safari'] }), false);
    expect(host.textContent).toBe('');
    await render(createElement(FullDiskNotice, { browsers: [] }));
    expect(host.textContent).toBe('');
    useAccessState.setState({ access: 'granted' });
    await render(createElement(FullDiskNotice, { browsers: ['safari'] }));
    expect(host.textContent).toBe('');
  });
});

describe('OpenAccessButton', () => {
  it('is only offered while access is missing and the host can open System Settings', async () => {
    await render(createElement(OpenAccessButton));
    expect(button('Open System Settings')).toBeTruthy();
    await render(createElement(OpenAccessButton), false);
    expect(host.textContent).toBe('');
    useAccessState.setState({ access: 'granted' });
    await render(createElement(OpenAccessButton));
    expect(host.textContent).toBe('');
  });
});
