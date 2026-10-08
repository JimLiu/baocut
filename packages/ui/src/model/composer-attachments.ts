import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, type AttachmentMimeType } from '@baocut/protocol';
import { ATTACHMENT_COPY } from '../copy.ts';

/**
 * 输入区附图的校验（产品设计 §3.2.4，原型 agent-thread.jsx `composerImageFiles` / `addImages`）。
 * 客户端先拦，Runtime 再验；上限与格式都取 limits.ts，不在这里另写一份。
 */

export type AttachmentRejection = 'type' | 'size' | 'count';

export interface ImageCandidate {
  type: string;
  size: number;
}

export function isAttachmentMimeType(type: string): type is AttachmentMimeType {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(type);
}

/** 单张能不能收：格式在白名单里，大小在 (0, 上限] 之间。 */
export function checkImage(file: ImageCandidate): AttachmentRejection | null {
  if (!isAttachmentMimeType(file.type)) return 'type';
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) return 'size';
  return null;
}

/**
 * 一批新图片（选文件、粘贴、拖放）里收哪些。逐张判断：合格的按顺序收，直到这条消息的张数上限；
 * 不合格的和放不下的退回，`rejected` 给第一条原因，界面只提示一句。
 */
export function admitImages<T extends ImageCandidate>(
  existing: number,
  incoming: readonly T[],
): { accepted: T[]; rejected: AttachmentRejection | null } {
  const accepted: T[] = [];
  let rejected: AttachmentRejection | null = null;
  for (const file of incoming) {
    const problem = checkImage(file) ?? (existing + accepted.length >= MAX_ATTACHMENTS_PER_MESSAGE ? 'count' : null);
    if (problem) rejected ??= problem;
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export function rejectionMessage(reason: AttachmentRejection): string {
  return reason === 'count' ? ATTACHMENT_COPY.tooMany : reason === 'size' ? ATTACHMENT_COPY.tooLarge : ATTACHMENT_COPY.badType;
}

/** Ordinary uploads share the attachment count/size bounds; MIME is normalized by uploadAttachment. */
export function admitFiles<T extends ImageCandidate>(existing:number,incoming:readonly T[]):{accepted:T[];rejected:AttachmentRejection|null}{
  const accepted:T[]=[];let rejected:AttachmentRejection|null=null;
  for(const file of incoming){const problem=file.size<=0||file.size>MAX_ATTACHMENT_BYTES?'size':existing+accepted.length>=MAX_ATTACHMENTS_PER_MESSAGE?'count':null;
    if(problem)rejected??=problem;else accepted.push(file);}
  return {accepted,rejected};
}
