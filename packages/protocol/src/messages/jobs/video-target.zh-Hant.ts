import type { JobsVideoTargetMessages } from './video-target.ts';

export const zhHant: JobsVideoTargetMessages = {
  stepLabel: '解析目標',
  notSameVideo: '與 videoId 指向不同的影片',
  targetShapeOneOf: '必須是 { videoId }、{ entryId } 或 { create } 其中之一',
  createUnsupported: '這個流程無法建立影片：請指定現有的影片（videoId 或 entryId）',
  createShape: '必須是 { projectId, name? } 或 { conversationId, name? }',
  mediaNotAllowed: '不能指定：媒體是這個流程的結果',
  unknownField: (p: { key: string }) => `含有未知欄位 ${p.key}`,
  scopeOnlyOne: '只能指定 projectId 與 conversationId 其中之一',
  scopeRequired: '需要 projectId 或 conversationId',
  nameLength: '必須是 1 到 200 字',
  mediaPath: '必須是本機媒體檔案的絕對路徑',
};
