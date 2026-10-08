/** 工具输出只保留末尾这么多字符；完整输出不进会话记录。Runtime 与客户端用同一个规则截断。 */
export const OUTPUT_LIMIT = 32_000;

export function clampOutput(output: string): string {
  return output.length > OUTPUT_LIMIT ? `…\n${output.slice(-OUTPUT_LIMIT)}` : output;
}

/** 消息附件（产品设计 §3.2.4）：单张图片的上限、每条消息最多几张、接受的格式。客户端先拦，Runtime 再验。 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 8;
export const ATTACHMENT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

/** `projects.files.list` 一次最多返回多少项。 */
export const MAX_PROJECT_FILES_LIMIT = 1000;

/** Uploaded documents are opaque files; the Runtime classifies their content when previewing. */
export const FILE_ATTACHMENT_MIME_TYPES = ['application/octet-stream','application/pdf','text/plain','text/html','text/csv','text/tab-separated-values','application/json','audio/mpeg','audio/wav','audio/mp4','video/mp4','video/webm'] as const;
export const ATTACHMENT_UPLOAD_MIME_TYPES = [...ATTACHMENT_MIME_TYPES, ...FILE_ATTACHMENT_MIME_TYPES] as const;
export function attachmentUploadMime(type:string):string {return (ATTACHMENT_UPLOAD_MIME_TYPES as readonly string[]).includes(type)?type:'application/octet-stream';}

/**
 * `media.playback` 的 `playable`（架构设计 §4.5）：客户端能原生解码的 WebM 编码，名字同 ffprobe 的 `codec_name`。
 * 源文件的首条画面与声音都在里面时 Runtime 直接给原句柄，不做兼容副本。
 */
export const PLAYBACK_CODECS = ['vp8', 'vp9', 'av1', 'opus', 'vorbis'] as const;
export type PlaybackCodec = (typeof PLAYBACK_CODECS)[number];
