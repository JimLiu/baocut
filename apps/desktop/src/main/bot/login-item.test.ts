import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_ARG, LoginItem, launchedHidden, loginItemSupported, type LoginItemApi } from './login-item.ts';

/** Stands in for Electron's app.setLoginItemSettings / getLoginItemSettings. */
function fakeApi(initial = false, wasOpenedAtLogin = false) {
  const state = { openAtLogin: initial };
  const set = vi.fn<(settings: { openAtLogin: boolean; args?: string[] }) => void>();
  const get = vi.fn<(options?: { args?: string[] }) => void>();
  const api = {
    set,
    get,
    setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[] }) {
      set(settings);
      state.openAtLogin = settings.openAtLogin;
    },
    getLoginItemSettings(options?: { args?: string[] }) {
      get(options);
      return { openAtLogin: state.openAtLogin, wasOpenedAtLogin };
    },
  } satisfies LoginItemApi & Record<string, unknown>;
  return api as typeof api & LoginItemApi;
}

describe('login item', () => {
  it('is supported on macOS and Windows only', () => {
    expect(['darwin', 'win32', 'linux'].map((p) => loginItemSupported(p as NodeJS.Platform))).toEqual([true, true, false]);
  });

  it('macOS: registers or removes the login item when the setting differs', () => {
    const api = fakeApi(false);
    const item = new LoginItem(api, 'darwin');
    expect(item.sync(false)).toBe(false);
    expect(api.set).not.toHaveBeenCalled();
    expect(item.sync(true)).toBe(true);
    expect(api.set).toHaveBeenLastCalledWith({ openAtLogin: true });
    expect(item.sync(true)).toBe(false);
    expect(item.sync(false)).toBe(true);
    expect(api.set).toHaveBeenLastCalledWith({ openAtLogin: false });
  });

  it('Windows: registers with the background argument and queries with the same arguments', () => {
    const api = fakeApi(false);
    new LoginItem(api, 'win32').sync(true);
    expect(api.get).toHaveBeenCalledWith({ args: [BACKGROUND_ARG] });
    expect(api.set).toHaveBeenCalledWith({ openAtLogin: true, args: [BACKGROUND_ARG] });
  });

  it('Linux: does nothing', () => {
    const api = fakeApi(false);
    expect(new LoginItem(api, 'linux').sync(true)).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.set).not.toHaveBeenCalled();
  });

  it('still applies the setting when the current state cannot be read', () => {
    const api = fakeApi(false);
    api.getLoginItemSettings = () => {
      throw new Error('unavailable');
    };
    expect(new LoginItem(api, 'darwin').sync(false)).toBe(true);
  });

  it('detects a hidden launch from the Windows argument or the macOS login-item flag', () => {
    expect(launchedHidden('win32', ['BaoCut.exe', BACKGROUND_ARG], fakeApi())).toBe(true);
    expect(launchedHidden('win32', ['BaoCut.exe'], fakeApi(true, true))).toBe(false);
    expect(launchedHidden('darwin', ['BaoCut'], fakeApi(true, true))).toBe(true);
    expect(launchedHidden('darwin', ['BaoCut'], fakeApi(true, false))).toBe(false);
    expect(launchedHidden('linux', ['baocut'], fakeApi(true, true))).toBe(false);
  });
});
