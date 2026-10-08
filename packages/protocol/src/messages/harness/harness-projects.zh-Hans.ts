import type { HarnessProjectsMessages } from './harness-projects.ts';

export const zhHans: HarnessProjectsMessages = {
  conversationNotFound: (p) => `会话不存在：${p.id}`,
  projectNotFound: (p) => `项目不存在：${p.id}`,
  folderInaccessible: (p) => `目录不存在或不可访问：${p.dir}`,
  markerReadFailed: (p) => `无法读取项目标记：${p.error}`,
  markerNewer: (p) => `这个项目由更新版本的 BaoCut 创建（项目标记版本 ${p.version}），请升级后再打开`,
  untitledProject: '未命名项目',
  createFolderFailed: (p) => `无法创建项目目录：${p.error}`,
  tooManySameName: '同名的项目目录太多了，换一个名字',
  markerNotWritable: (p) => `项目目录不可写，无法写入项目标记 .bcut/project.json：${p.dir}`,
  markerWriteFailed: (p) => `无法写入项目标记：${p.error}`,
};
