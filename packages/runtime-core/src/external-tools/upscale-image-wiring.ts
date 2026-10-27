import path from 'node:path';
import { upscaleImagePipeline, type PipelineDefinition, type ProbeToolResolver } from '@baocut/jobs';
import type { ExternalToolService } from './external-tool-service.ts';
import { REALESRGAN } from './tool-manifests.ts';

/**
 * 「图片超分」流程在 Runtime 里的接线（架构设计 §7.9）：Real-ESRGAN 由外部工具服务给出（受管副本、用户指定的路径或 PATH，
 * 已安装、能运行），权重是可执行文件旁边的 `models/`；ffmpeg 与文件转码同一个。外部工具服务在 Runtime 启动的后面几步才有，
 * 调用时再取。
 */
export interface UpscaleImageWiring {
  tools: () => ExternalToolService;
  ffmpeg: ProbeToolResolver;
  saveDirectory?: () => string;
}

export function upscaleImageDefinition(wiring: UpscaleImageWiring): PipelineDefinition<any, any> {
  return upscaleImagePipeline({
    tool: async () => {
      const resolved = await wiring.tools().resolveForUse(REALESRGAN);
      return { command: resolved.command, version: resolved.version, env: resolved.env, modelsDir: path.join(path.dirname(resolved.command), 'models') };
    },
    ffmpeg: wiring.ffmpeg,
    ...(wiring.saveDirectory ? { saveDirectory: wiring.saveDirectory } : {}),
  });
}
