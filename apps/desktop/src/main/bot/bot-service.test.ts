import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';

/**
 * The Electron wiring with every Electron API faked: the tray, menus, notifications, dialogs and IPC are simulated here,
 * because this Linux VM cannot show real ones (manual acceptance covers them, technical design §20).
 */
const env = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  trays: [] as any[],
  notifications: [] as any[],
  dialogResponses: [] as number[],
  dialogs: [] as any[],
  client: null as any,
  fromWebContents: null as any,
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Tray extends EventEmitter {
    menu: any = null;
    title = '';
    tooltip = '';
    destroyed = false;
    image: unknown;
    constructor(image: unknown) {
      super();
      this.image = image;
      env.trays.push(this);
    }
    setContextMenu(menu: unknown) {
      this.menu = menu;
    }
    setTitle(title: string) {
      this.title = title;
    }
    setToolTip(text: string) {
      this.tooltip = text;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class Notification extends EventEmitter {
    static isSupported = () => true;
    shown = false;
    options: unknown;
    constructor(options: unknown) {
      super();
      this.options = options;
      env.notifications.push(this);
    }
    show() {
      this.shown = true;
    }
  }
  const image = { isEmpty: () => false, resize: () => image };
  return {
    Tray,
    Notification,
    Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
    nativeImage: { createFromPath: () => image },
    dialog: {
      showMessageBox: async (...args: unknown[]) => {
        env.dialogs.push(args.at(-1));
        return { response: env.dialogResponses.shift() ?? 0 };
      },
    },
    ipcMain: {
      handle: (channel: string, handler: Function) => env.handlers.set(channel, handler),
      removeHandler: (channel: string) => env.handlers.delete(channel),
    },
    BrowserWindow: { fromWebContents: () => env.fromWebContents },
  };
});
vi.mock('../../../build/icon.png?asset', () => ({ default: '/fixture/icon.png' }));
vi.mock('@baocut/client', async (original) => {
  const { FakeClient } = await import('./testing/fakes.ts');
  return {
    ...(await original<typeof import('@baocut/client')>()),
    BaoCutClient: class {
      constructor() {
        env.client = new FakeClient();
        return env.client.client;
      }
    },
  };
});

import { installBotService, type BotServiceOptions } from './bot-service.ts';
import { channelSummary, channelsSnapshot, botStatus } from './testing/fakes.ts';

beforeEach(() => {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
  env.handlers.clear();
  env.trays.length = 0;
  env.notifications.length = 0;
  env.dialogResponses.length = 0;
  env.dialogs.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

function fakeWindow(loading: boolean) {
  const frame = {};
  return { webContents: { isLoading: () => loading, send: vi.fn(), mainFrame: frame }, frame };
}

function install(overrides: Partial<BotServiceOptions> = {}) {
  const win = fakeWindow(false);
  const options: BotServiceOptions = {
    connection: async () => ({ endpoint: 'ws://127.0.0.1:1', token: 'fixture' }),
    version: '0.0.0',
    platform: 'darwin',
    showWindow: vi.fn(() => win as never),
    quitCompletely: vi.fn(),
    onResidency: vi.fn(),
    loginItemApi: { setLoginItemSettings: vi.fn(), getLoginItemSettings: () => ({ openAtLogin: false }) },
    ...overrides,
  };
  const service = installBotService(options);
  return { service, options, win, client: env.client as import('./testing/fakes.ts').FakeClient };
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Calls the take-route IPC handler as the renderer's main frame would. */
function takeRoute(win: ReturnType<typeof fakeWindow>) {
  env.fromWebContents = win;
  return env.handlers.get('baocut:bot-take-route')!({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
}

describe('Bot service wiring (Electron simulated)', () => {
  it('shows the tray from settings and labels its menu in the current language', async () => {
    const { client } = install();
    client.snapshot(channelsSnapshot([channelSummary('chan_main', { needsYou: 2 })]));
    await flush();
    expect(env.trays).toHaveLength(1);
    expect(env.trays[0].title).toBe('2');
    expect(env.trays[0].menu.template.map((item: { label?: string }) => item.label)).toEqual([
      'Open BaoCut',
      'Working Tasks (0)',
      undefined,
      'Pause All Automation',
      undefined,
      'Quit Background Service',
    ]);
  });

  it('a clicked notification opens the window and hands the task route to the renderer once', async () => {
    const { client, win, options } = install();
    client.snapshot(channelsSnapshot([channelSummary('chan_pod', { name: 'Weekly podcast' })]));
    await flush();
    client.event({
      type: 'bot.notification',
      channelId: 'chan_pod',
      workItemId: 'wi_1',
      reason: 'needs-input',
      headline: 'Which thumbnail?',
      question: null,
      at: new Date().toISOString(),
      muted: false,
    });
    const notification = env.notifications[0];
    expect(notification.options).toEqual({ title: 'Weekly podcast', subtitle: 'Needs your input', body: 'Which thumbnail?' });
    expect(notification.shown).toBe(true);
    notification.emit('click');
    expect(options.showWindow).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith('baocut:bot-route');
    expect(takeRoute(win)).toEqual({ tab: 'bot', channelId: 'chan_pod', workItemId: 'wi_1', view: 'task' });
    expect(takeRoute(win)).toBeNull();
  });

  it('a window still loading is not pinged; it takes the route when its page is up', () => {
    const loading = fakeWindow(true);
    const { service } = install({ showWindow: vi.fn(() => loading as never) });
    service.openRoute({ tab: 'bot', channelId: null, workItemId: null, view: 'inbox' });
    expect(loading.webContents.send).not.toHaveBeenCalled();
    expect(takeRoute(loading)).toEqual({ tab: 'bot', channelId: null, workItemId: null, view: 'inbox' });
  });

  it('only app windows (main frame) can take a route', () => {
    const { service, win } = install();
    service.openRoute({ tab: 'bot', channelId: null, workItemId: null, view: 'inbox' });
    env.fromWebContents = null;
    expect(env.handlers.get('baocut:bot-take-route')!({ sender: win.webContents, senderFrame: win.webContents.mainFrame })).toBeNull();
    env.fromWebContents = win;
    expect(env.handlers.get('baocut:bot-take-route')!({ sender: win.webContents, senderFrame: {} })).toBeNull();
  });

  it('“Quit Background Service” confirms with the work that will stop, then quits completely', async () => {
    const { client, options } = install();
    client.status = botStatus({ resident: true, workingThreads: [{ workItemId: 'wi_1', channelId: 'c', title: 'Trim the intro' }] });
    client.snapshot(channelsSnapshot([channelSummary('chan_main')]));
    await flush();
    const quit = () => env.trays[0].menu.template[5].click();

    env.dialogResponses.push(1);
    quit();
    await flush();
    expect(env.dialogs[0].detail).toContain('• Trim the intro');
    expect(options.quitCompletely).not.toHaveBeenCalled();

    env.dialogResponses.push(0);
    quit();
    await flush();
    expect(options.quitCompletely).toHaveBeenCalledTimes(1);
  });

  it('the resident before-quit dialog maps its buttons', async () => {
    const { service } = install({ platform: 'win32' });
    env.dialogResponses.push(0, 1, 2);
    expect(await service.confirmResidentQuit(null)).toBe('keep');
    expect(await service.confirmResidentQuit(null)).toBe('quit');
    expect(await service.confirmResidentQuit(null)).toBe('cancel');
    expect(env.dialogs[0].buttons).toEqual(['Keep in Background', 'Quit Completely', 'Cancel']);
  });

  it('reports residency changes and cleans up on dispose', async () => {
    const { service, client, options } = install();
    client.status = botStatus({ resident: true });
    client.snapshot(channelsSnapshot([channelSummary('chan_main')]));
    await flush();
    expect(options.onResidency).toHaveBeenCalledWith(true, expect.objectContaining({ resident: true }));
    service.dispose();
    expect(env.handlers.has('baocut:bot-take-route')).toBe(false);
    expect(env.trays[0].destroyed).toBe(true);
    expect(client.closed).toBe(true);
  });
});
