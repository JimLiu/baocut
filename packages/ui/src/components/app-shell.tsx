import { useEffect, useRef } from 'react';
import { ToastQueue } from '@react-spectrum/s2';
import { color, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { QUEUE_COPY } from '../copy.ts';
import { useRuntime } from '../runtime/context.tsx';
import { startQueueRunner } from '../runtime/message-queue-runner.ts';
import { shellShortcut } from '../model/shell-shortcuts.ts';
import { isVideoReferenced, targetKey } from '../model/workspace.ts';
import { useHelp } from '../state/help-store.ts';
import { HOME, hasSidebar, routeVideo, useShell } from '../state/shell-store.ts';
import { useVideo } from '../state/video-store.ts';
import { AppUpdateHost } from './app-update/app-update-host.tsx';
import { LegacyImportHost } from './legacy-import/legacy-import-host.tsx';
import { ConnectionBanner } from './connection-banner.tsx';
import { HelpCenter } from './help/help-center.tsx';
import { HomePage } from './home-page.tsx';
import { Rail } from './rail.tsx';
import { ServicesPage } from './services-page.tsx';
import { SettingsPage } from './settings-page.tsx';
import { ShellPeek, ShellPeekProvider } from './shell-peek.tsx';
import { SpacePage } from './space/space-page.tsx';
import { TasksPage } from './tasks-page.tsx';
import { TitleBar } from './title-bar.tsx';
import { ToolsPage } from './tools-page.tsx';

const frame = style({
  display: 'flex',
  flexDirection: 'column',
  height: 'full',
  backgroundColor: 'gray-50',
  font: 'ui',
  color: 'neutral',
});
/** 窗体底色：轻微的渐变给出层次（产品设计 §2.5 用户修订）。 */
const frameBackground = `linear-gradient(120deg, ${color('gray-75')}, ${color('gray-50')} 65%)`;
const body = style({ display: 'flex', flexGrow: 1, minHeight: 0 });
/**
 * Spectrum 2 app frame：页面侧栏与内容区是同一张 sheet。整个工作区共用一个外缘——四角圆角、轻阴影，
 * 右侧与底部露出窗体底色（产品设计 §2.5 用户修订）。
 */
const sheet = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minWidth: 0,
  marginEnd: 4,
  marginBottom: 4,
  backgroundColor: 'gray-25',
  borderRadius: '[16px]',
  boxShadow: 'emphasized',
  overflow: 'hidden',
});

export function AppShell({ platform }: { platform: string }) {
  const runtime = useRuntime();
  const route = useShell((s) => s.route);
  const video = routeVideo(route);
  const sheetRef = useRef<HTMLElement>(null);

  // 打开的视频跟着路由走：同一个视频在 Home 与 Space 之间切换时不重新打开；路由换到另一个视频时，打开它会先关掉旧的。
  // 路由上没有视频（换到文件标签、换会话、收起右侧区域、去别的入口）时，只要还有哪条会话的功能区标签引用着它就不关——
  // 编辑器留着选区、播放头与撤销栈，切回来不重新打开；视频标签都关掉了才关，Runtime 在没有打开者之后释放它。
  const videoKey = video ? JSON.stringify(video) : null;
  const openKey = useVideo((s) => (s.video ? targetKey(s.video.target) : null));
  const referenced = useShell((s) => openKey !== null && isVideoReferenced(s.workspaces, openKey));
  useEffect(() => {
    if (video) runtime.videos.open(video);
    else if (!referenced) runtime.videos.close();
  }, [runtime, videoKey, referenced]);

  // 忙时排队的消息：哪条会话的任务结束了就发它队首的那一条，不管现在看的是哪个页面。
  useEffect(() => startQueueRunner(runtime, (message) => ToastQueue.negative(QUEUE_COPY.failed(message), { timeout: 5000 })), [runtime]);

  // 全局快捷键（原型 main.jsx）：⌘[ / ⌘] 后退前进（Windows 与 Linux 用 Alt+←/→），⌘N 新建会话，⇧⌘H Space，
  // ⇧⌘B 后台任务，⌘, 设置，⌃⌘S 开合侧栏。Windows 与 Linux 上 ⌘ 换成 Ctrl。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shellShortcut(event, platform === 'darwin');
      if (!action) return;
      event.preventDefault();
      const shell = useShell.getState();
      if (action === 'back') shell.goBack();
      else if (action === 'forward') shell.goForward();
      else if (action === 'new') shell.go(HOME);
      else if (action === 'space') shell.goTab('space');
      else if (action === 'tasks') shell.goTab('tasks');
      else if (action === 'settings') shell.goTab('settings');
      else if (action === 'sidebar' && hasSidebar(shell.route)) shell.toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [platform]);

  // F1 打开帮助中心（原型 shell.jsx）：已有对话框、菜单或下拉开着时不响应（帮助本身也是对话框，开着时按 F1 不重复打开）。
  // 提示条（Toast）也带 alertdialog，它在提示区（region）里，不算挡住 F1 的对话框。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F1' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') || hasAlertDialog()) return;
      event.preventDefault();
      useHelp.getState().open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ShellPeekProvider>
      <div className={frame} style={{ backgroundImage: frameBackground }}>
        <TitleBar platform={platform} />
        <div className={body}>
          <Rail />
          <main ref={sheetRef} className={sheet}>
            <ConnectionBanner />
            {route.tab === 'home' ? (
              <HomePage conversationId={route.conversationId} projectId={route.projectId} pane={route.pane ?? null} />
            ) : route.tab === 'space' ? (
              <SpacePage category={route.category} projectId={route.projectId} video={route.video ?? null} />
            ) : route.tab === 'tasks' ? (
              <TasksPage taskId={route.taskId} />
            ) : route.tab === 'services' ? (
              <ServicesPage service={route.service} />
            ) : route.tab === 'settings' ? (
              <SettingsPage section={route.section} platform={platform} />
            ) : route.tab === 'models' ? (
              <SettingsPage model={route} platform={platform} />
            ) : (
              <ToolsPage tool={route.tool} />
            )}
          </main>
        </div>
        {/* 侧栏浮出：页面侧栏隐藏时悬停 Rail 入口或标题栏开关，浮在应用面板之上（产品设计 §2.5）。 */}
        <ShellPeek sheet={sheetRef} />
        <HelpCenter platform={platform} />
        {/* 应用更新：离开设置页照样收主进程的状态、弹 toast；更新窗与停止屏障也挂在这里。 */}
        <AppUpdateHost />
        {/* 启动时的旧版项目导入询问：Runtime 发现还没导入的旧版项目、又没有记下决定时问一次（Web 不问）。 */}
        <LegacyImportHost />
      </div>
    </ShellPeekProvider>
  );
}

/** 真开着的确认框（S2 AlertDialog）；提示区里的 Toast 同样是 alertdialog，不算。 */
function hasAlertDialog(): boolean {
  return Array.from(document.querySelectorAll('[role="alertdialog"]')).some((el) => !el.closest('[role="region"]'));
}
