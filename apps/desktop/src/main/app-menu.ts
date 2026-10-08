import type { MenuItemConstructorOptions } from 'electron';
import { M } from './main-copy.ts';

/**
 * 应用菜单的模板：与 Electron 的缺省菜单同样的几组（应用、文件、编辑、显示、窗口），只是标签按当前界面语言取，
 * 快捷键与行为仍由各项的 role 决定。缺省菜单的「帮助」只有 Electron 自己网站的链接，这里不带。
 * 不依赖 Electron 运行时，便于测试；界面语言变了由主进程重新生成并设上（index.ts）。
 */
export function appMenuTemplate(platform: NodeJS.Platform, appName: string): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const quit: MenuItemConstructorOptions = { role: 'quit', label: platform === 'win32' ? M.exit : M.quit(appName) };

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: 'about', label: M.about(appName) },
      separator,
      { role: 'services', label: M.services },
      separator,
      { role: 'hide', label: M.hide(appName) },
      { role: 'hideOthers', label: M.hideOthers },
      { role: 'unhide', label: M.showAll },
      separator,
      quit,
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: M.fileMenu,
    submenu: [mac ? { role: 'close', label: M.closeWindow } : quit],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: M.editMenu,
    submenu: [
      { role: 'undo', label: M.undo },
      { role: 'redo', label: M.redo },
      separator,
      { role: 'cut', label: M.cut },
      { role: 'copy', label: M.copy },
      { role: 'paste', label: M.paste },
      ...(mac
        ? ([
            { role: 'pasteAndMatchStyle', label: M.pasteAndMatchStyle },
            { role: 'delete', label: M.delete },
            { role: 'selectAll', label: M.selectAll },
            separator,
            {
              label: M.speech,
              submenu: [
                { role: 'startSpeaking', label: M.startSpeaking },
                { role: 'stopSpeaking', label: M.stopSpeaking },
              ],
            },
          ] satisfies MenuItemConstructorOptions[])
        : ([{ role: 'delete', label: M.delete }, separator, { role: 'selectAll', label: M.selectAll }] satisfies MenuItemConstructorOptions[])),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: M.viewMenu,
    submenu: [
      { role: 'reload', label: M.reload },
      { role: 'forceReload', label: M.forceReload },
      { role: 'toggleDevTools', label: M.toggleDevTools },
      separator,
      { role: 'resetZoom', label: M.actualSize },
      { role: 'zoomIn', label: M.zoomIn },
      { role: 'zoomOut', label: M.zoomOut },
      separator,
      { role: 'togglefullscreen', label: M.toggleFullScreen },
    ],
  };

  // role 'window'：macOS 把它当作「窗口」菜单，在末尾列出打开的窗口。
  const windowMenu: MenuItemConstructorOptions = {
    label: M.windowMenu,
    ...(mac ? { role: 'window' as const } : {}),
    submenu: [
      { role: 'minimize', label: M.minimize },
      { role: 'zoom', label: M.zoom },
      ...(mac
        ? ([separator, { role: 'front', label: M.bringAllToFront }] satisfies MenuItemConstructorOptions[])
        : ([{ role: 'close', label: M.close }] satisfies MenuItemConstructorOptions[])),
    ],
  };

  return [...(mac ? [appMenu] : []), fileMenu, editMenu, viewMenu, windowMenu];
}
