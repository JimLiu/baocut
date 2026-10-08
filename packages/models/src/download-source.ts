/**
 * 模型下载的来源（架构设计 §6.3）。
 *
 * 基址的取法，先到先用：环境变量 `BAOCUT_MODELS_ENDPOINT` → 设置 `models.downloadEndpoint` → 公共模型仓库
 * `https://huggingface.co`。镜像只要按同样的路径规则提供文件即可。
 *
 * 文件 URL：`<基址>/<owner>/<repo>/resolve/<revision>/<文件路径>`，每一段按 URL 编码，文件路径里的 `/` 保留。
 * 基址可以带路径前缀（`https://mirror.example/hf`），结尾的 `/` 去掉。
 *
 * 不带凭据：基址里不允许用户名、密码、查询参数与片段；下载请求不发 `Authorization`。
 */

import { ModelsDownloadSource as M } from '@baocut/protocol/messages/models/download-source.ts';

export const DEFAULT_MODELS_ENDPOINT = 'https://huggingface.co';
export const MODELS_ENDPOINT_ENV = 'BAOCUT_MODELS_ENDPOINT';

export type EndpointOrigin = 'env' | 'setting' | 'default';

export interface ResolvedEndpoint {
  endpoint: string;
  origin: EndpointOrigin;
}

/** 基址是否可用：`http(s)://`，没有凭据、查询参数与片段。 */
export function validEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.search && !url.hash;
}

/** 按优先级取基址。环境变量的值不合规时抛错（不悄悄退回公共仓库）。 */
export function resolveModelsEndpoint(env: NodeJS.ProcessEnv, setting: string | null | undefined): ResolvedEndpoint {
  const fromEnv = env[MODELS_ENDPOINT_ENV]?.trim();
  if (fromEnv) {
    if (!validEndpoint(fromEnv)) throw new Error(M.invalidEndpoint({ name: MODELS_ENDPOINT_ENV }).text);
    return { endpoint: trimSlash(fromEnv), origin: 'env' };
  }
  if (setting && validEndpoint(setting)) return { endpoint: trimSlash(setting), origin: 'setting' };
  return { endpoint: DEFAULT_MODELS_ENDPOINT, origin: 'default' };
}

/** 一个文件的下载 URL。 */
export function modelFileUrl(endpoint: string, repo: string, revision: string, file: string): string {
  const repoPath = repo.split('/').map(encodeURIComponent).join('/');
  const filePath = file.split('/').map(encodeURIComponent).join('/');
  return `${trimSlash(endpoint)}/${repoPath}/resolve/${encodeURIComponent(revision)}/${filePath}`;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
