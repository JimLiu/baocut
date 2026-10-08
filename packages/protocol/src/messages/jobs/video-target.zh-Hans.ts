import type { JobsVideoTargetMessages } from './video-target.ts';

export const zhHans: JobsVideoTargetMessages = {
  stepLabel: '解析目标',
  notSameVideo: '与 videoId 指的不是同一个视频',
  targetShapeOneOf: '应为 { videoId }、{ entryId } 或 { create } 之一',
  createUnsupported: '这个流程不能新建视频：给已有的视频（videoId 或 entryId）',
  createShape: '应为 { projectId, name? } 或 { conversationId, name? }',
  mediaNotAllowed: '不能给：媒体是这个流程的结果',
  unknownField: (p: { key: string }) => `不认识的字段 ${p.key}`,
  scopeOnlyOne: 'projectId 与 conversationId 只能给一个',
  scopeRequired: '要给 projectId 或 conversationId',
  nameLength: '应为 1 到 200 个字符',
  mediaPath: '应为本机媒体文件的绝对路径',
};
