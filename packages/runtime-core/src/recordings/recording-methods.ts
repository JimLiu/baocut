import { RpcError } from '@baocut/protocol';
import { RcRecordings } from '@baocut/protocol/messages/runtime-core';
import type { TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import type { RecordingService } from './recording-service.ts';

type RecordingMethod =
  | 'recordings.sources'
  | 'recordings.list'
  | 'recordings.status'
  | 'recordings.start'
  | 'recordings.cancel'
  | 'recordings.pause'
  | 'recordings.resume'
  | 'recordings.stop'
  | 'recordings.discard'
  | 'recordings.recover';

/**
 * `recordings.*` 的处理函数（屏幕录制设计 §7、§12）。只录 Runtime 所在的这台电脑：桌面端与本机的 CLI 可以调，浏览器（Web 服务）与
 * 对外服务一律拒绝（`RECORDING_UNAVAILABLE`），远程会话不能把服务器的桌面当成用户的桌面。
 */
export function recordingMethods(recordings: () => RecordingService | null): Pick<RpcHandlers['methods'], RecordingMethod> {
  const own = (principal: TrustedPrincipal): RecordingService => {
    if (principal.kind === 'web' || principal.kind === 'service') {
      throw new RpcError('unsupported', RcRecordings.remote(), { code: 'RECORDING_UNAVAILABLE', reason: 'remote' });
    }
    const service = recordings();
    if (!service) throw new RpcError('unsupported', RcRecordings.unsupportedPlatform(), { code: 'RECORDING_UNAVAILABLE', reason: 'unsupported' });
    return service;
  };
  const submitter = (principal: TrustedPrincipal) => ({ kind: 'connection' as const, id: principal.connectionId });
  return {
    'recordings.sources': (_p, principal) => own(principal).sources(),
    'recordings.list': (_p, principal) => ({ recordings: own(principal).list() }),
    'recordings.status': (p, principal) => ({ recording: own(principal).status(p.recordingId) }),
    'recordings.start': async (p, principal) => ({ recording: await own(principal).start(p, submitter(principal)) }),
    'recordings.cancel': async (p, principal) => ({ recording: await own(principal).cancel(p.recordingId) }),
    'recordings.pause': async (p, principal) => ({ recording: await own(principal).pause(p.recordingId) }),
    'recordings.resume': async (p, principal) => ({ recording: await own(principal).resume(p.recordingId) }),
    'recordings.stop': async (p, principal) => ({ recording: await own(principal).stop(p.recordingId) }),
    'recordings.discard': (p, principal) => own(principal).discard(p.recordingId),
    'recordings.recover': async (p, principal) => ({ recording: await own(principal).recover(p.recordingId, submitter(principal)) }),
  };
}
