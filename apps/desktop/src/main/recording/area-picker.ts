import { BrowserWindow, ipcMain, screen } from 'electron';
import { RB } from './recording-bar-copy.ts';
import { areaRect, parseAreaDrag, pickDisplay, type Bounds } from './recording-rules.ts';

/*
 * 录制面板「一个区域」的选框（屏幕录制设计 §11 第 1 项）：在所选屏幕上盖一个透明、总在最前的窗口，用户拖出一个框，
 * 交回相对那块屏幕左上角的逻辑点；Esc、切走、屏幕拔掉、关窗都当作取消。同一时间只有一个选框，再开一个时旧的先取消。
 * 坐标换算（窗口可能被压到菜单栏下面、夹在屏幕里、太小当作没选）在 recording-rules.ts 并有单测。
 */

export const AREA_VIEW_CHANNEL = 'baocut:recording-area-view';
export const AREA_READY_CHANNEL = 'baocut:recording-area-ready';
export const AREA_DONE_CHANNEL = 'baocut:recording-area-done';

/** 选框页面收到的样子：文字由主进程按当前语言给。 */
export interface AreaPayload {
  hint: string;
  cancel: string;
}

export interface AreaPick {
  displayId: string;
  rect: Bounds;
}

export interface AreaPicker {
  /** 在那块屏幕上框一个区域；取消时 null。 */
  pick(displayId: unknown): Promise<AreaPick | null>;
  isPickerWindow(win: BrowserWindow): boolean;
  dispose(): void;
}

type Drag = { from: { x: number; y: number }; to: { x: number; y: number } };
type Active = { win: BrowserWindow; finish(result: AreaPick | null): void; compute(drag: Drag): AreaPick | null };

export function createAreaPicker(options: { page: { url: string } | { file: string }; preload: string }): AreaPicker {
  let active: Active | null = null;

  const onReady = (event: Electron.IpcMainEvent) => {
    if (!active || active.win.isDestroyed() || event.sender !== active.win.webContents) return;
    const payload: AreaPayload = { hint: RB.areaHint, cancel: RB.areaCancel };
    active.win.webContents.send(AREA_VIEW_CHANNEL, payload);
  };
  const onDone = (event: Electron.IpcMainEvent, raw: unknown) => {
    if (!active || active.win.isDestroyed() || event.sender !== active.win.webContents) return;
    const current = active;
    const drag = raw === null ? null : parseAreaDrag(raw);
    if (!drag) return current.finish(null);
    current.finish(current.compute(drag));
  };
  ipcMain.on(AREA_READY_CHANNEL, onReady);
  ipcMain.on(AREA_DONE_CHANNEL, onDone);

  const pick = (displayId: unknown): Promise<AreaPick | null> => {
    active?.finish(null);
    const display = pickDisplay(screen.getAllDisplays(), displayId, screen.getPrimaryDisplay());
    // 交回界面的屏幕 ID：界面给的对得上就原样交回，对不上（或没给）时是实际盖住的那块屏的 ID。
    const id = typeof displayId === 'string' && String(display.id) === displayId ? displayId : String(display.id);
    const bounds = display.bounds;
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        enableLargerThanScreen: true,
        skipTaskbar: true,
        show: false,
        title: RB.areaHint,
        webPreferences: { preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      // Esc 在页面里也接；这里再接一次，页面没拿到焦点时也能取消。
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          event.preventDefault();
          me.finish(null);
        }
      });
      let focused = false;
      win.on('focus', () => (focused = true));
      // 切到别的应用（失去焦点）当作取消；还没拿到过焦点时不算。
      win.on('blur', () => {
        if (focused) me.finish(null);
      });
      win.on('closed', () => me.finish(null));
      const onRemoved = (_event: unknown, removed: Electron.Display) => {
        if (removed.id === display.id) me.finish(null);
      };
      screen.on('display-removed', onRemoved);

      let done = false;
      const me: Active = {
        win,
        finish(result) {
          if (done) return;
          done = true;
          screen.removeListener('display-removed', onRemoved);
          if (active === me) active = null;
          if (!win.isDestroyed()) win.destroy();
          resolve(result);
        },
        compute(drag) {
          if (win.isDestroyed()) return null;
          const rect = areaRect(drag.from, drag.to, win.getContentBounds(), bounds);
          return rect ? { displayId: id, rect } : null;
        },
      };
      active = me;
      win.once('ready-to-show', () => {
        if (done) return;
        win.show();
        win.focus();
      });
      if ('url' in options.page) void win.loadURL(options.page.url);
      else void win.loadFile(options.page.file);
    });
  };

  return {
    pick,
    isPickerWindow: (win) => !!active && active.win === win,
    dispose() {
      active?.finish(null);
      ipcMain.removeListener(AREA_READY_CHANNEL, onReady);
      ipcMain.removeListener(AREA_DONE_CHANNEL, onDone);
    },
  };
}
