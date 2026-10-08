import type { Harness } from '@baocut/harness';
import type { RpcHandlers } from '../handlers.ts';
import type { MediaRegistry } from '../media.ts';
import { resolveSendSkill } from '../skills/skill-brief.ts';
import type { SkillCatalog } from '../skills/skill-catalog.ts';
import { resolveSceneTemplate } from './template-brief.ts';
import type { TemplateCatalog } from './template-catalog.ts';

type TemplateMethod = 'templates.list' | 'templates.get' | 'templates.openHandle' | 'conversations.send';

/**
 * `templates.*` 与带模板的 `conversations.send`（模板包规范 §5.2、§6），由 `handlers.ts` 并进方法表。目录只读；
 * 句柄只发给清单登记的随附文件，媒体通道再按真实路径确认它在模板目录里。
 * 点选的 skill（架构设计 §3.8）也在这一个发送入口里解析：模板与 skill 各自解析好，一起交给 Harness。
 */
export function templateMethods(deps: {
  templates: TemplateCatalog;
  media: MediaRegistry;
  harness: Harness;
  skills: SkillCatalog;
}): Pick<RpcHandlers['methods'], TemplateMethod> {
  const { templates, media, harness, skills } = deps;
  return {
    'templates.list': () => templates.list(),
    'templates.get': (p) => templates.get(p.id),
    'templates.openHandle': async (p) => {
      const { root, file } = await templates.locate(p.id, p.path);
      return media.issue(root, file);
    },
    'conversations.send': async ({ template, skill, ...params }) =>
      harness.send({
        ...params,
        ...(template ? { template: await resolveSceneTemplate(templates, template) } : {}),
        ...(skill ? { skill: await resolveSendSkill(skills, skill) } : {}),
      }),
  };
}
