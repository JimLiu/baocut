import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './harness-projects.zh-Hans.ts';
import { zhHant } from './harness-projects.zh-Hant.ts';
import { ja } from './harness-projects.ja.ts';
import { ko } from './harness-projects.ko.ts';
import { es } from './harness-projects.es.ts';
import { fr } from './harness-projects.fr.ts';
import { de } from './harness-projects.de.ts';
import { nl } from './harness-projects.nl.ts';
import { ptBR } from './harness-projects.pt-BR.ts';
import { it } from './harness-projects.it.ts';
import { ru } from './harness-projects.ru.ts';
import { pl } from './harness-projects.pl.ts';
import { tr } from './harness-projects.tr.ts';
import { vi } from './harness-projects.vi.ts';

/** 项目与会话的查找、项目目录与项目标记的错误（`packages/harness`）。 */
const en = {
  conversationNotFound: (p: { id: string }) => `Session not found: ${p.id}`,
  projectNotFound: (p: { id: string }) => `Project not found: ${p.id}`,
  folderInaccessible: (p: { dir: string }) => `Folder doesn't exist or can't be accessed: ${p.dir}`,
  markerReadFailed: (p: { error: string }) => `Couldn't read the project marker: ${p.error}`,
  markerNewer: (p: { version: number }) =>
    `This project was created by a newer version of BaoCut (project marker version ${p.version}). Update BaoCut, then open it again`,
  /** 新建项目没给名字时的目录名。 */
  untitledProject: 'Untitled project',
  /** 启动时收容没有对应会话的视频（升级前留在会话工作目录里的）的项目名，也是它的目录名。 */
  recoveredVideos: 'Recovered videos',
  createFolderFailed: (p: { error: string }) => `Couldn't create the project folder: ${p.error}`,
  tooManySameName: 'Too many project folders have this name. Choose another name',
  markerNotWritable: (p: { dir: string }) =>
    `The project folder isn't writable, so the project marker .bcut/project.json couldn't be written: ${p.dir}`,
  markerWriteFailed: (p: { error: string }) => `Couldn't write the project marker: ${p.error}`,
  /** 无项目会话放进项目、删会话之前：它工作目录里的视频还开着（别的窗口、任务或连接），不能搬（架构设计 §3.10）。`names` 是视频目录名。 */
  sessionVideosOpen: (p: { names: string }) => `Some videos in this session are still open: ${p.names}. Close them, then try again`,
  /** 项目登记的目录此刻不在（被删掉、移走，或所在的卷没有接上）：不在它里面新建会话、发消息，也不悄悄重建目录（架构设计 §5.1）。 */
  projectFolderMissing: (p: { dir: string }) =>
    `The project folder isn't there anymore: ${p.dir}. Put it back, open it from where it is now, or remove the project from BaoCut`,
  /** 从 BaoCut 移除项目之前：项目里的视频还开着（别的窗口、任务或连接）。`names` 是相对项目目录的路径。 */
  projectVideosOpen: (p: { names: string }) => `Some videos in this project are still open: ${p.names}. Close them, then try again`,
};

export type HarnessProjectsMessages = typeof en;

export const HarnessProjects = defineCatalog('harnessProjects', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
