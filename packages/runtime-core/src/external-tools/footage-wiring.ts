import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REALESRGAN_TOOL, RIFE_TOOL, footagePipeline, type PipelineDefinition, type ProbeToolResolver } from '@baocut/jobs';
import { findBundledBinary } from '@baocut/process-host';
import { FOOTAGE_OPS } from '@baocut/protocol';
import type { ExternalToolService } from './external-tool-service.ts';

/**
 * 「素材处理」五条流程在 Runtime 里的接线（架构设计 §7.9）：Real-ESRGAN、RIFE 与抠像权重包由外部工具服务给出（受管副本、用户指定的路径
 * 或 PATH，已安装、能运行）；Real-ESRGAN 的权重是可执行文件旁边的 `models/`，RIFE 的模型目录与可执行文件在同一层，权重包解析出的路径
 * 就是它的目录。`matte` Worker 随应用分发（§12.9 之外，同 `face-detect`）。外部工具服务在 Runtime 启动的后面几步才有，调用时再取。
 */
export interface FootageWiring {
  tools: () => ExternalToolService;
  ffmpeg: ProbeToolResolver;
  ffprobe: ProbeToolResolver;
  saveDirectory?: () => string;
}

/** 指定 `matte` 路径的环境变量（开发与测试用）。 */
export const MATTE_ENV = 'BAOCUT_MATTE';

/** `matte` 的位置：`BAOCUT_MATTE`；随应用分发的原生程序目录；或从本模块往上找 cargo 产物目录。 */
export function resolveMatteCommand(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env[MATTE_ENV]) return env[MATTE_ENV];
  return findBundledBinary('matte', path.dirname(fileURLToPath(import.meta.url)), env);
}

export function footageDefinitions(wiring: FootageWiring): PipelineDefinition<any, any>[] {
  return FOOTAGE_OPS.map((op) =>
    footagePipeline(op, {
      tool: async (name) => {
        const resolved = await wiring.tools().resolveForUse(name);
        const dir = path.dirname(resolved.command);
        const modelsDir = name === REALESRGAN_TOOL ? path.join(dir, 'models') : name === RIFE_TOOL ? dir : undefined;
        return { command: resolved.command, version: resolved.version, env: resolved.env, ...(modelsDir ? { modelsDir } : {}) };
      },
      ffmpeg: wiring.ffmpeg,
      ffprobe: wiring.ffprobe,
      matteWorker: () => resolveMatteCommand(),
      ...(wiring.saveDirectory ? { saveDirectory: wiring.saveDirectory } : {}),
    }),
  );
}
