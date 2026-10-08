import type { SpaceMessages } from './space-copy.ts';

export const zhHans: SpaceMessages = {
  kind: {
    video: '视频',
    export: '成片',
    'video-file': '视频素材',
    image: '图片',
    audio: '音频',
    subtitle: '字幕',
    document: '文档',
    package: '视频包',
    template: '模板',
  },
  categoryAll: '全部',
  favorite: '收藏',
  trash: '回收站',
  sort: { created: '创建时间', updated: '更新时间', recent: '最近活动', name: '名称', kind: '类型' },
  status: {
    generating: '生成中',
    candidate: '候选',
    applied: '已应用',
    published: '已发布',
    'source-changed': '来源已变',
    missing: '缺失',
    failed: '失败',
  },
  statusAny: '全部状态',
  statusNone: '无状态',
  noProject: '不属于任何项目',
  removedProject: '已移除的项目',
  conversation: (title: string) => `会话「${title}」`,
};
