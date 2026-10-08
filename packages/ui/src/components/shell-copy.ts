import { defineMessages } from '@baocut/protocol';
import { zhHans } from './shell-copy.zh-Hans.ts';
import { zhHant } from './shell-copy.zh-Hant.ts';
import { ja } from './shell-copy.ja.ts';
import { ko } from './shell-copy.ko.ts';
import { es } from './shell-copy.es.ts';
import { fr } from './shell-copy.fr.ts';
import { de } from './shell-copy.de.ts';
import { nl } from './shell-copy.nl.ts';
import { ptBR } from './shell-copy.pt-BR.ts';
import { it } from './shell-copy.it.ts';
import { ru } from './shell-copy.ru.ts';
import { pl } from './shell-copy.pl.ts';
import { tr } from './shell-copy.tr.ts';
import { vi } from './shell-copy.vi.ts';

/**
 * 应用外壳（components 根目录下各组件）的文案。英文写在这里，译文在 `shell-copy.zh-Hans.ts`；
 * 用词见 docs/glossary.md。界面读取时才取值，切换语言后重新渲染即生效。
 */

/** 会话所在位置：属于项目，或只是一个工作目录。 */
export type ConversationPlace = 'project' | 'workdir';

const en = {
  /** 并列名词的分隔（如「A、B」）。 */
  list: (items: readonly string[]): string => items.join(', '),
  separator: ', ',
  common: {
    cancel: 'Cancel',
    save: 'Save',
    rename: 'Rename',
    renameEllipsis: 'Rename…',
    name: 'Name',
    pin: 'Pin',
    unpin: 'Unpin',
    newSession: 'New session',
    newSessionInProject: 'New session in this project',
    working: 'Working',
    loading: 'Loading',
    loadingEllipsis: 'Loading…',
    tools: 'Tools',
    services: 'Services',
    tasks: 'Background tasks',
    settings: 'Settings',
    back: 'Back',
    forward: 'Forward',
  },
  conversationHeader: {
    running: 'Working',
    waiting: 'Waiting for approval',
    actions: 'Session actions',
    viewInSpace: (name: string) => `View “${name}” in Space`,
    revealProject: 'Show Project Folder',
    revealWorkdir: 'Show Working Folder',
    deleteSession: 'Delete session',
    deleteSessionEllipsis: 'Delete session…',
    deleteTitle: 'Delete this session?',
    deleteConfirm: 'Delete',
    deleteBody:
      'The session history will be removed from BaoCut, and any running task will be stopped first. Files in the project folder are not affected.',
    deleteFailed: (message: string) => `Couldn’t delete: ${message}`,
    renameTitle: 'Rename session',
    videosIn: (place: ConversationPlace): string => (place === 'project' ? 'Videos in the project' : 'Videos in the working folder'),
    noVideosIn: (place: ConversationPlace): string => (place === 'project' ? 'No videos in the project yet' : 'No videos in the working folder yet'),
    mediaIn: (place: ConversationPlace): string =>
      place === 'project' ? 'Videos and audio in the project' : 'Videos and audio in the working folder',
    noMediaIn: (place: ConversationPlace): string =>
      place === 'project' ? 'No videos or audio in the project yet' : 'No videos or audio in the working folder yet',
    scanning: 'Scanning…',
    none: 'None',
    newVideoFailed: (message: string) => `Couldn’t create the video: ${message}`,
    openVideo: 'Open video',
    newVideo: 'New video',
    playMedia: 'Play video or audio',
  },
  sidebar: {
    openFolderFailed: (message: string) => `Couldn’t open the folder: ${message}`,
    archived: (title: string) => `Archived “${title}”`,
    undo: 'Undo',
    sessions: 'Sessions',
    projectsAndSessions: 'Projects and sessions',
    pinned: 'Pinned',
    projects: 'Projects',
    recent: 'Recent',
    newOrOpenProject: 'New or open project',
    newProjectEllipsis: 'New project…',
    openFolderEllipsis: 'Open existing folder…',
    noSessions: 'No sessions yet.',
    noProjects: 'No projects yet. Create one or open an existing folder; the agent works there.',
    newProjectTitle: 'New project',
    projectName: 'Project name',
    untitledProject: 'Untitled project',
    newProjectHint: (dir: string) => `A folder with the same name will be created in ${dir}.`,
    create: 'Create',
    projectCreated: (name: string) => `Created project “${name}”`,
    renameProjectTitle: 'Rename project',
    renameProjectHint: 'Only changes the name shown in BaoCut; the folder name stays the same.',
    toggleSection: (collapsed: boolean, label: string) => `${collapsed ? 'Expand' : 'Collapse'} ${label}`,
    organizeLabel: 'Organize projects and sessions',
    sidebarSettings: 'Sidebar settings',
    organize: 'Organize sidebar',
    byProject: 'Group by project',
    flat: 'In one list',
    sortSessions: 'Sort sessions',
    byRecent: 'Recent activity',
    byName: 'Name',
  },
  sidebarRows: {
    noProject: 'Not in a project',
    rowActions: (title: string) => `Actions for “${title}”`,
    togglePin: (pinned: boolean, title: string) => `${pinned ? 'Unpin' : 'Pin'} “${title}”`,
    archiveNamed: (title: string) => `Archive “${title}”`,
    archive: 'Archive session',
    projectActions: (name: string) => `Actions for project “${name}”`,
    showInSpace: 'Show in Space',
    newHere: 'New session here',
  },
  settingsPage: {
    general: 'General',
    models: 'Models',
    nav: 'Settings navigation',
    sections: 'Settings sections',
    shortcutNewSession: 'New session',
    shortcutTasks: 'Background tasks',
    shortcutSettings: 'Settings',
    shortcutSidebar: 'Show or hide sidebar',
    shortcutBack: 'Back',
    shortcutForward: 'Forward',
    app: 'App',
    privacyTitle: 'Your data stays on this computer',
    privacyHint:
      'Sessions, the project list, and Space marks are stored in the data folder; project files stay in their own folders, and BaoCut doesn’t upload them. Whether the agent engine goes online is up to the engine.',
    dataDir: 'Data folder',
    projectsDir: 'New projects go in',
    logsDir: 'Logs folder',
    webCleared: 'Web data cleared',
    webClearFailed: (message: string) => `Couldn’t clear web data: ${message}`,
    webData: 'Web data',
    webDataHint: 'Cookies, sign-ins, and cache left by web pages opened in the workspace. After clearing, you’ll need to sign in to those sites again.',
    webDataNone: 'This environment has no web tabs.',
    clear: 'Clear',
    runtimeHint: 'When something goes wrong, the files in the logs folder help track it down.',
    version: 'Version',
    appVersion: (version: string, build: number) => `App ${version}${build > 0 ? ` (Build ${build})` : ''}`,
    uiVersion: (version: string, protocol: number | string) => `Interface ${version} (protocol ${protocol})`,
    runtimeVersion: (version: string, protocol: number | string) => `${version} (protocol ${protocol})`,
    versionNote: 'You’ll be prompted to update when the interface and Runtime protocol versions don’t match.',
  },
  conversationView: {
    missing: 'This session doesn’t exist or has been deleted.',
    loadingSession: 'Loading session',
    switchFailed: (message: string) => `Couldn’t switch: ${message}`,
    accessModeFailed: (message: string) => `Couldn’t change the access mode: ${message}`,
    placeholder: 'Keep going, or try a different direction',
    removeFailed: (message: string) => `Couldn’t remove: ${message}`,
    stopFailed: (message: string) => `Couldn’t stop: ${message}`,
  },
  composer: {
    disconnected: 'Not connected to Runtime',
    driverUnavailable: (name: string, detail: string) => `${name} unavailable: ${detail}`,
    stopping: 'Stopping',
    stop: 'Stop',
    send: 'Send',
    dropEditorState: 'Don’t include editor state with this message',
    spaceEntries: 'Space items sent with this message',
    dropSpaceEntries: 'Don’t include these Space items with this message',
    message: 'Message to the agent',
  },
  rail: {
    running: (label: string, count: number) => `${label}, ${count} running or queued`,
    nav: 'Main navigation',
    primary: 'Main sections',
    secondary: 'Services and background tasks',
  },
  utilitySidebar: {
    overviewTasks: 'All tasks',
    overviewTools: 'All tools',
    overviewServices: 'Services overview',
    noteTasks: 'Tasks keep running in the background; switch pages any time.',
    noteTools: 'Use tools on their own; bring results back to a video or session.',
    noteServices: 'Manage connections this computer offers to other apps and devices.',
    nav: (title: string) => `${title} navigation`,
    localServices: 'Local services',
  },
  titleBar: {
    backTip: 'Back ⌘[',
    forwardTip: 'Forward ⌘]',
    openTab: 'New tab',
    enterSplit: 'Enter split view',
    hideTabs: 'Hide tabs',
    showTabs: 'Show tabs',
    openTabsCount: (n: number) => (n === 1 ? '1 open tab' : `${n} open tabs`),
    openTabs: 'Open tabs',
    openInFull: (name: string) => `Open “${name}” in full view`,
    enterFull: 'Enter full view',
    exitFull: 'Exit full view',
    summary: 'Summary',
    summaryOutputs: (n: number) => `Outputs · ${n}`,
    summaryEmpty: 'This session has no outputs yet.',
  },
  connectionBanner: {
    incompatible: (reason: string) => `The interface and Runtime protocol versions are incompatible: ${reason}`,
    closed: 'Connection closed',
    lost: (reason: string, retrying: boolean) => `${reason}.${retrying ? ' Reconnecting…' : ''}`,
    reconnectingEllipsis: 'Reconnecting…',
    title: 'Not connected to BaoCut Runtime',
    reconnecting: 'Reconnecting',
  },
  videoInfo: {
    title: 'Video details',
    name: 'Name',
    summary: 'Summary',
    notes: 'Notes',
    notSaved: 'Can’t save yet',
    copyAll: 'Copy all',
    done: 'Done',
    copied: 'Video details copied',
    copyFailed: 'Couldn’t copy. Select the text and copy it manually.',
    renameInEditor: 'Open the video to rename it',
    renameFailed: (message: string) => `Couldn’t rename: ${message}`,
  },
  filePreview: {
    tooLarge: 'The file is too large to show in full here',
    loading: 'Loading preview',
    unsupported: 'BaoCut can’t preview this kind of file yet. Show it in the folder and open it with another app.',
    failed: (message: string) => `Couldn’t load the preview: ${message}`,
  },
  accessPicker: {
    current: (label: string) => `Access mode: ${label}`,
    label: 'Access mode',
  },
  agentPicker: {
    current: (label: string) => `Coding agent and model: ${label}`,
    label: 'Coding agent and model',
    models: (name: string) => `${name} models`,
  },
  nameDialog: {
    failed: (action: string, message: string) => `Couldn’t ${action.toLowerCase()}: ${message}`,
  },
  editorReference: {
    label: (videoName: string, selected: number) =>
      `“${videoName}”${selected ? ` · ${selected} ${selected === 1 ? 'clip' : 'clips'} selected` : ''}`,
    description: 'Sends this video’s current version, selected clips, and playhead position with the message',
  },
  voicePicker: { placeholder: 'Choose a voice' },
  pageSidebar: {
    resize: 'Resize sidebar',
    /** 侧栏浮出右上角的按钮：恢复常驻侧栏（产品设计 §2.5）。 */
    pin: 'Pin sidebar',
  },
  filePane: { label: (name: string) => `File: ${name}` },
};

export type ShellMessages = typeof en;

export const S = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
