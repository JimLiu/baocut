import { RpcError } from '@baocut/protocol';
import { detectCookieBrowsers } from '@baocut/jobs';
import type { TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import type { ExternalToolService } from './external-tool-service.ts';
import { RcExternalTools } from '@baocut/protocol/messages/runtime-core';

type ExternalToolMethod =
  | 'externalTools.list'
  | 'externalTools.detect'
  | 'externalTools.install'
  | 'externalTools.update'
  | 'externalTools.setPath'
  | 'externalTools.remove'
  | 'externalTools.consent'
  | 'externalTools.cookieBrowsers';

/**
 * `externalTools.*` 的处理函数（架构设计 §12.9），由 `handlers.ts` 并进方法表。它们管的是这台机器（下载并执行第三方程序、
 * 代用户执行更新命令），只给界面与 CLI：Web 服务的白名单里没有 `externalTools.*`，对外服务不走网关、工具目录里也没有安装与更新。
 */
export function externalToolMethods(tools: () => ExternalToolService): Pick<RpcHandlers['methods'], ExternalToolMethod> {
  const own = (principal: TrustedPrincipal) => {
    // 白名单之外再挡一次：浏览器与对外服务都不能下载、更新或指定可执行文件。
    if (principal.kind === 'service' || principal.kind === 'web') throw new RpcError('forbidden', RcExternalTools.manageOnlyInAppOrCli());
  };
  return {
    'externalTools.list': async () => ({ tools: await tools().list() }),
    'externalTools.detect': async (p) => ({ tools: await tools().detect(p.name) }),
    'externalTools.install': (p, principal) => {
      own(principal);
      return tools().install(p, { kind: 'connection', id: principal.connectionId });
    },
    'externalTools.update': (p, principal) => {
      own(principal);
      return tools().update(p, { kind: 'connection', id: principal.connectionId });
    },
    'externalTools.setPath': (p, principal) => {
      own(principal);
      return tools().setPath(p);
    },
    'externalTools.remove': (p, principal) => {
      own(principal);
      return tools().remove(p);
    },
    'externalTools.consent': (p, principal) => {
      own(principal);
      return tools().consent(p);
    },
    // 只看各浏览器的 Cookie 库在不在、什么时候改过，不读内容；与从链接导入一样只给界面与 CLI（白名单里没有）。
    'externalTools.cookieBrowsers': async () => ({ platform: process.platform, browsers: await detectCookieBrowsers() }),
  };
}
