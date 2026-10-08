// ElevenLabs 即时音色克隆（Instant Voice Cloning，架构设计 §5.9）。2026-10-03 按公开文档写成，离线没能逐项核对：
//   https://elevenlabs.io/docs/api-reference/voices/ivc/create
//   https://elevenlabs.io/docs/api-reference/voices/delete
// 按文档写的：`POST {base}/voices/add`，请求头 `xi-api-key`，multipart/form-data：`name`（必填）、`files`（一个或多个音频文件，
// 必填）、`description`（可选）、`remove_background_noise`（可选，默认 false，不发）；200 的响应体 `{ voice_id, requires_verification }`。
// `DELETE {base}/voices/{voice_id}`，200 的响应体 `{ status: 'ok' }`。
// 没能确认、列在架构设计 §14 待评审的：音色已经不存在时删除返回的状态码（按 404 当作「远端已经没有」）；`requires_verification`
// 为 true 时克隆能不能立即用于合成（照常记为有效，合成失败时如实报告）；单个文件与总上传大小的上限（参考录音本身不超过库的上限）。
import fs from 'node:fs/promises';
import { ProviderFailure } from '@baocut/models';
import { voiceCloneTimeoutMs, type VoiceCloneAdapter, type VoiceCloneDeleteRequest, type VoiceCloneRequest } from '../adapter.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { ELEVENLABS_LABEL, authOf, classifyElevenLabs, httpOptions } from './elevenlabs-adapter.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export class ElevenLabsVoiceCloneAdapter implements VoiceCloneAdapter {
  readonly version = 'baocut-providers/elevenlabs-ivc@1';

  async createVoiceClone(request: VoiceCloneRequest): Promise<{ voiceId: string }> {
    const { config } = request;
    const bytes = await fs.readFile(request.file);
    const response = await providerFetch(
      // 上传只发一次：5xx 之后重发可能在供应商那边多建一个克隆。
      httpOptions(config, { ...request.http, attempts: 1 }),
      {
        method: 'POST',
        url: `${config.baseUrl}/voices/add`,
        auth: authOf(config),
        body: () => {
          const form = new FormData();
          form.append('name', request.name);
          if (request.description) form.append('description', request.description);
          form.append('files', new Blob([new Uint8Array(bytes)], { type: request.mediaType }), request.fileName);
          return form;
        },
        timeoutMs: voiceCloneTimeoutMs(request.http),
        signal: request.signal,
        classify: classifyElevenLabs,
      },
    );
    let body: { voice_id?: unknown } | null = null;
    try {
      body = response.json<{ voice_id?: unknown }>();
    } catch {
      body = null;
    }
    if (!body || typeof body.voice_id !== 'string' || !body.voice_id) {
      throw new ProviderFailure('protocol', PH.cloneNoVoiceId({ label: ELEVENLABS_LABEL }).text);
    }
    return { voiceId: body.voice_id };
  }

  async deleteVoiceClone(request: VoiceCloneDeleteRequest): Promise<'deleted' | 'not-found'> {
    const { config } = request;
    try {
      await providerFetch(httpOptions(config, request.http), {
        method: 'DELETE',
        url: `${config.baseUrl}/voices/${encodeURIComponent(request.voiceId)}`,
        auth: authOf(config),
        timeoutMs: request.http.timeoutMs ?? 30_000,
        signal: request.signal,
        classify: classifyElevenLabs,
      });
      return 'deleted';
    } catch (error) {
      if (error instanceof ProviderFailure && error.details.status === 404) return 'not-found';
      throw error;
    }
  }
}
