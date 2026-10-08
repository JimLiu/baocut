import type { HarnessProjectsMessages } from './harness-projects.ts';

export const ja: HarnessProjectsMessages = {
  conversationNotFound: (p) => `セッションが見つかりません：${p.id}`,
  projectNotFound: (p) => `プロジェクトが見つかりません：${p.id}`,
  folderInaccessible: (p) => `フォルダが存在しないか、アクセスできません：${p.dir}`,
  markerReadFailed: (p) => `プロジェクトマーカーを読み取れませんでした：${p.error}`,
  markerNewer: (p) =>
    `このプロジェクトは新しいバージョンの BaoCut で作成されています（プロジェクトマーカーのバージョン ${p.version}）。BaoCut を更新してから、もう一度開いてください`,
  untitledProject: '名称未設定のプロジェクト', recoveredVideos: '復元された動画',
  createFolderFailed: (p) => `プロジェクトフォルダを作成できませんでした：${p.error}`,
  tooManySameName: '同じ名前のプロジェクトフォルダが多すぎます。別の名前を選んでください',
  markerNotWritable: (p) =>
    `プロジェクトフォルダに書き込めないため、プロジェクトマーカー .bcut/project.json を書き込めませんでした：${p.dir}`,
  markerWriteFailed: (p) => `プロジェクトマーカーを書き込めませんでした：${p.error}`,
};
