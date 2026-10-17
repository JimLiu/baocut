import type { RpcHandlers } from '../handlers.ts';
import type { MediaRegistry } from '../media.ts';
import type { ProjectBrands } from './project-brand.ts';
import type { SkillCatalog } from './skill-catalog.ts';
import type { SkillInstaller } from './skill-installer.ts';

type SkillMethod = Extract<keyof RpcHandlers['methods'], `skills.${string}` | `brands.${string}`>;

/**
 * `skills.*` 与 `brands.*`（架构设计 §3.8、§12.9），由 `handlers.ts` 并进方法表。看、开关与句柄对所有客户端开放；添加、导入、
 * 上传、新建、编辑、恢复、导出、移除与写 `BRAND.md` 不在 Web 服务的白名单里（`WEB_DEFAULT_METHODS`），浏览器调用时在 Web 网关上以
 * `WEB_METHOD_NOT_ALLOWED` 拒绝。点选 skill 与项目品牌的发送在 `templateMethods` 里。
 */
export function skillMethods(deps: {
  skills: SkillCatalog;
  installer: SkillInstaller;
  brands: ProjectBrands;
  media: MediaRegistry;
}): Pick<RpcHandlers['methods'], SkillMethod> {
  const { skills, installer, brands, media } = deps;
  return {
    'skills.list': () => skills.list(),
    'skills.get': (p) => skills.get(p.id, p.revision),
    'skills.readFile': (p) => skills.readFile(p.id, p.path, p.revision),
    'skills.openHandle': async (p) => {
      const { root, file } = await skills.locate(p.id, p.path, p.revision);
      return media.issue(root, file);
    },
    'skills.versions': (p) => skills.versions(p.id),
    'skills.setEnabled': (p) => skills.setEnabled(p.id, p.enabled),
    'skills.add': (p) => installer.add(p),
    'skills.importGithub': (p) => installer.importGithub(p),
    'skills.inspectPackage': (p) => installer.inspectPackage(p),
    'skills.installPackage': (p) => installer.installPackage(p),
    'skills.create': (p) => installer.create(p),
    'skills.duplicate': (p) => installer.duplicate(p),
    'skills.write': (p) => installer.write(p),
    'skills.restore': (p) => installer.restore(p),
    'skills.export': (p) => installer.export(p),
    'skills.remove': (p) => installer.remove(p.id),
    'brands.list': () => brands.list(),
    'brands.get': (p) => brands.get(p.projectId),
    'brands.readFile': (p) => brands.readFile(p.projectId, p.path),
    'brands.openHandle': async (p) => {
      const { root, file } = await brands.locate(p.projectId, p.path);
      return media.issue(root, file);
    },
    'brands.write': (p) => brands.write(p),
    'brands.createFromSkill': (p) => brands.createFromSkill(p),
  };
}
