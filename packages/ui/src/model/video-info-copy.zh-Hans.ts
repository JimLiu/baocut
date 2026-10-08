import type { VideoInfoMessages } from './video-info-copy.ts';

export const zhHans: VideoInfoMessages = {
  section: { media: '来源与媒体', source: '来源信息' },
  speakers: (count: number) => `${count} 位说话人`,
  chapters: (count: number) => `${count} 章`,
  paragraphs: (count: number) => `${count} 段`,
  list: (names: readonly string[]) => names.join('、'),
  sourceKind: {
    'link-import': '网址导入',
    'user-import': '本地文件',
    generated: '生成',
    library: '用户库',
  },
  row: {
    contents: '内容',
    translation: '译文',
    location: '位置',
    media: '媒体',
    transcript: '转录',
    channel: '频道',
    published: '发布',
    platform: '平台',
    mediaId: '视频 ID',
    url: '网址',
  },
};
