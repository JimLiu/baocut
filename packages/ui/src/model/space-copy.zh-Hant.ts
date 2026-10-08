import type { SpaceMessages } from './space-copy.ts';

export const zhHant: SpaceMessages = {
  kind: {
    video: '影片',
    export: '成品',
    'video-file': '影片素材',
    image: '圖片',
    audio: '音訊',
    subtitle: '字幕',
    document: '文件',
    package: '影片套件',
    template: '範本',
  },
  categoryAll: '全部',
  favorite: '收藏',
  trash: '垃圾桶',
  sort: { recent: '最近活動', name: '名稱', kind: '類型' },
  status: {
    generating: '生成中',
    candidate: '候選',
    applied: '已套用',
    published: '已發布',
    'source-changed': '來源已變更',
    missing: '遺失',
    failed: '失敗',
  },
  statusAny: '所有狀態',
  statusNone: '無狀態',
  noProject: '不屬於任何專案',
  removedProject: '已移除的專案',
  conversation: (title: string) => `對話「${title}」`,
};
