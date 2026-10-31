import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { FakeTrayHost } from './testing/fakes.ts';
import { TrayController, type TrayActions, type TrayMenuItem } from './tray.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

function english() {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
}

function setup(platform: NodeJS.Platform = 'darwin') {
  const hosts: FakeTrayHost[] = [];
  const actions: TrayActions = { openWindow: vi.fn(), openTask: vi.fn(), setPaused: vi.fn(), quitService: vi.fn() };
  const tray = new TrayController(
    () => {
      const host = new FakeTrayHost();
      hosts.push(host);
      return host;
    },
    actions,
    platform,
  );
  return { tray, hosts, actions };
}

function labels(items: TrayMenuItem[]): (string | undefined)[] {
  return items.map((item) => (item.type === 'separator' ? '---' : item.label));
}

describe('TrayController', () => {
  it('creates the tray on show, removes it on hide, and only once', () => {
    const { tray, hosts } = setup();
    expect(tray.visible).toBe(false);
    tray.update({ needsYou: 2 });
    expect(hosts).toHaveLength(0);
    tray.show();
    tray.show();
    expect(hosts).toHaveLength(1);
    tray.hide();
    expect(hosts[0]!.destroyed).toBe(true);
    expect(tray.visible).toBe(false);
  });

  it('lists the menu: open, working tasks submenu, pause toggle, quit', () => {
    english();
    const { tray, hosts, actions } = setup();
    tray.show();
    const host = hosts[0]!;
    expect(labels(host.menu)).toEqual(['Open BaoCut', 'Working Tasks (0)', '---', 'Pause All Automation', '---', 'Quit Background Service']);
    expect(host.menu[1]!.submenu).toEqual([{ label: 'No tasks working', enabled: false }]);

    const task = { workItemId: 'wi_1', channelId: 'chan_a', title: '  Trim\nthe   intro  ' };
    tray.update({ working: [task], paused: true });
    expect(labels(host.menu)).toEqual(['Open BaoCut', 'Working Tasks (1)', '---', 'Resume Automation', '---', 'Quit Background Service']);
    expect(host.menu[1]!.submenu![0]!.label).toBe('Trim the intro');

    host.menu[0]!.click!();
    host.menu[1]!.submenu![0]!.click!();
    host.menu[3]!.click!();
    host.menu[5]!.click!();
    expect(actions.openWindow).toHaveBeenCalled();
    expect(actions.openTask).toHaveBeenCalledWith(task);
    expect(actions.setPaused).toHaveBeenCalledWith(false);
    expect(actions.quitService).toHaveBeenCalled();
    tray.update({ paused: false });
    host.menu[3]!.click!();
    expect(actions.setPaused).toHaveBeenLastCalledWith(true);
  });

  it('caps the working list and clips long titles', () => {
    english();
    const { tray, hosts } = setup();
    tray.show();
    const working = Array.from({ length: 12 }, (_, i) => ({ workItemId: `wi_${i}`, channelId: 'c', title: `Task ${i} ${'x'.repeat(80)}` }));
    tray.update({ working });
    const submenu = hosts[0]!.menu[1]!.submenu!;
    expect(submenu).toHaveLength(11);
    expect(submenu[0]!.label!.length).toBe(60);
    expect(submenu[0]!.label!.endsWith('…')).toBe(true);
    expect(submenu[10]).toEqual({ label: 'and 2 more', enabled: false });
  });

  it('shows the needs-you count as the macOS menu-bar title and in the tooltip', () => {
    english();
    const { tray, hosts } = setup('darwin');
    tray.show();
    const host = hosts[0]!;
    expect(host.title).toBe('');
    expect(host.tooltip).toBe('BaoCut background service');
    tray.update({ needsYou: 3 });
    expect(host.title).toBe('3');
    expect(host.tooltip).toBe('BaoCut: 3 things need you');
    tray.update({ needsYou: 0, paused: true });
    expect(host.title).toBe('');
    expect(host.tooltip).toBe('BaoCut: automation paused');
    // macOS opens the menu on click; no extra click handler.
    expect(host.clickListener).toBeNull();
  });

  it('on Windows puts the count in the tooltip (no title) and opens the window on click', () => {
    english();
    const { tray, hosts, actions } = setup('win32');
    tray.show();
    tray.update({ needsYou: 1 });
    const host = hosts[0]!;
    expect(host.title).toBe('');
    expect(host.tooltip).toBe('BaoCut: 1 thing needs you');
    host.clickListener!();
    expect(actions.openWindow).toHaveBeenCalled();
  });

  it('re-renders in the current language', () => {
    const { tray, hosts } = setup();
    tray.show();
    expect(hosts[0]!.menu[0]!.label).toBe('打开 BaoCut');
    english();
    tray.render();
    expect(hosts[0]!.menu[0]!.label).toBe('Open BaoCut');
  });
});
