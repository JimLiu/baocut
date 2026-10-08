import type { RpcHandlers } from '../handlers.ts';
import type { SkillCatalog } from './skill-catalog.ts';
import type { SkillInstaller } from './skill-installer.ts';

type SkillMethod =
  'skills.list' | 'skills.get' | 'skills.readFile' | 'skills.setEnabled' | 'skills.add' | 'skills.importGithub' | 'skills.remove';

/**
 * `skills.*`（架构设计 §3.8、§12.9），由 `handlers.ts` 并进方法表。看与开关对所有客户端开放；添加、导入与移除不在 Web 服务的
 * 白名单里（`WEB_DEFAULT_METHODS`），浏览器调用时在 Web 网关上以 `WEB_METHOD_NOT_ALLOWED` 拒绝。点选 skill 的发送在 `templateMethods` 里。
 */
export function skillMethods(deps: { skills: SkillCatalog; installer: SkillInstaller }): Pick<RpcHandlers['methods'], SkillMethod> {
  const { skills, installer } = deps;
  return {
    'skills.list': () => skills.list(),
    'skills.get': (p) => skills.get(p.id),
    'skills.readFile': (p) => skills.readFile(p.id, p.path),
    'skills.setEnabled': (p) => skills.setEnabled(p.id, p.enabled),
    'skills.add': (p) => installer.add(p),
    'skills.importGithub': (p) => installer.importGithub(p),
    'skills.remove': (p) => installer.remove(p.id),
  };
}
