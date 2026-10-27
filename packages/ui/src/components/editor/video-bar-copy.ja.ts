import type { VideoBarMessages } from './video-bar-copy.ts';

export const ja: VideoBarMessages = {
  closeToSpace: '動画を閉じる · Space に戻る',
  untitled: '動画',
  rename: '動画の名前を変更',
  details: '動画の詳細',
  actions: '動画の操作',
  showInSpace: 'Space で表示',
  revealVideoFolder: '動画フォルダを表示',
  close: '動画を閉じる',
  nameLabel: '名前',
  save: '保存',
  openFailed: '開けません',
  stale: '未同期 · 現在は編集できません',
  openingAria: '開いています',
  opening: '開いています…',
  savingAria: '保存中',
  saving: '保存中…',
  agentChanged: (label: string) => `Agent が動画を変更しました：${label}`,
  savedByAgent: (label: string) => `保存済み · Agent：${label}`,
  saved: '保存済み',
};
