import { RpcError } from '@baocut/protocol';
import type { Localized } from '@baocut/protocol';

/** 用户库的错误码（命令与协议规范 §11），放在 `RpcError.details.code`。 */
export type LibraryErrorCode =
  | 'LIBRARY_FORMAT_INVALID'
  | 'LIBRARY_KIND_RESERVED'
  | 'LIBRARY_VERSION_CONFLICT'
  | 'LIBRARY_ENTRY_NOT_APPLICABLE'
  | 'VOICE_CONSENT_REQUIRED'
  | 'VOICE_CLONE_REQUIRED'
  | 'VOICE_CLONE_UNSUPPORTED'
  | 'VOICE_CLONE_EXISTS';

export function libraryError(
  code: LibraryErrorCode,
  rpc: 'invalid-request' | 'conflict',
  message: string | Localized,
  details: Record<string, unknown> = {},
): RpcError {
  return new RpcError(rpc, message, { code, ...details });
}

/** 内容或交换文件不合规：`invalid-request`。 */
export function formatInvalid(message: string | Localized, details: Record<string, unknown> = {}): RpcError {
  return libraryError('LIBRARY_FORMAT_INVALID', 'invalid-request', message, details);
}
