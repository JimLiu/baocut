import { startDesktopApp } from './app-main.ts';
import { compositionHostScript, runCompositionHost } from './composition-host-entry.ts';

/**
 * 主进程入口。先判断这次是不是代码包的离屏宿主（`--composition-host <脚本>`，见 `composition-host-entry.ts`）：是就只跑宿主脚本；
 * 否则走桌面应用（`app-main.ts`）。两边的模块在导入时都没有副作用，判断之前不会起 Runtime、注册 IPC 或开窗口。
 */
const hostScript = compositionHostScript(process.argv);
if (hostScript !== null) runCompositionHost(hostScript);
else startDesktopApp();
