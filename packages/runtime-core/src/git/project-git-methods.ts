import { RpcError } from '@baocut/protocol';
import { RcGit } from '@baocut/protocol/messages/runtime-core';
import type { TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import type { ProjectGitService } from './project-git-service.ts';

type ProjectGitMethod = 'projects.git.status' | 'projects.git.commit' | 'projects.git.init' | 'projects.git.allowLocalConfig';

/**
 * `projects.git.*` 的处理函数（版本记录设计 §5、§6），由 `handlers.ts` 并进方法表。
 *
 * - 状态与「提交到 git」给所有连接；Web 的状态里不给本机路径与本地配置的条目。
 * - 初始化（在本机文件夹里建仓库）与允许本地过滤器（等于允许执行仓库配置里的程序，§5.4）只给桌面界面与 CLI：Web 服务的
 *   白名单里没有它们，这里再挡一次浏览器、对外服务与智能体。
 */
export function projectGitMethods(git: () => ProjectGitService): Pick<RpcHandlers['methods'], ProjectGitMethod> {
  const own = (principal: TrustedPrincipal) => {
    if (principal.kind !== 'desktop' && principal.kind !== 'cli') throw new RpcError('forbidden', RcGit.manageOnlyInAppOrCli());
  };
  const view = (principal: TrustedPrincipal) => ({ web: principal.kind === 'web' });
  return {
    'projects.git.status': async (p, principal) => ({ status: await git().status(p.projectId, view(principal)) }),
    'projects.git.commit': (p, principal) => git().commit(p.projectId, { message: p.message }, view(principal)),
    'projects.git.init': async (p, principal) => {
      own(principal);
      return { status: await git().init(p.projectId) };
    },
    'projects.git.allowLocalConfig': async (p, principal) => {
      own(principal);
      return { status: await git().allowLocalConfig(p.projectId, p.digest) };
    },
  };
}
