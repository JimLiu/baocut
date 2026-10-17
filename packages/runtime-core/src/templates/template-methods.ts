import type {
  Harness,
  ResolvedDesignAnnotation,
  ResolvedDesignSystemAnnotation,
  ResolvedDocsAnnotation,
  ResolvedVideoAnnotation,
  ResolvedSlideAnnotation,
} from '@baocut/harness';
import {
  sendSkillRefs,
  type DesignAnnotation,
  type DesignSystemAnnotation,
  type Id,
  type SlideAnnotation,
  type VideoAnnotation,
  type DocsAnnotation,
} from '@baocut/protocol';
import type { RpcHandlers } from '../handlers.ts';
import type { MediaRegistry } from '../media.ts';
import type { ProjectBrands } from '../skills/project-brand.ts';
import { resolveSendSkills } from '../skills/skill-brief.ts';
import type { SkillCatalog } from '../skills/skill-catalog.ts';
import { resolveSceneTemplate } from './template-brief.ts';
import type { TemplateCatalog } from './template-catalog.ts';

type TemplateMethod = 'templates.list' | 'templates.get' | 'templates.openHandle' | 'conversations.send';

/**
 * `templates.*` 与带模板的 `conversations.send`（模板包规范 §5.2、§6），由 `handlers.ts` 并进方法表。目录只读；
 * 句柄只发给清单登记的随附文件，媒体通道再按真实路径确认它在模板目录里。
 * 点选的 skill（架构设计 §3.8，一个或几个）、幻灯片标注（docs/design/slides §9）、设计稿标注（docs/design/canvas §9）、
 * 设计系统标注（§10.6）、视频标注（产品设计 §3.2.3）与文档标注（docs/design/docs §8）
 * 也在这一个发送入口里解析：
 * 会话属于项目时，项目根目录的 `BRAND.md`（§3.8「项目品牌」）每条都读，`skipProjectBrand` 只让这一条不带。
 * 模板、品牌、skill 与标注各自解析好，一起交给 Harness。
 */
export function templateMethods(deps: {
  templates: TemplateCatalog;
  media: MediaRegistry;
  harness: Harness;
  skills: SkillCatalog;
  brands: ProjectBrands;
  slideAnnotationsOf: (conversationId: Id, annotations: readonly SlideAnnotation[] | undefined) => ResolvedSlideAnnotation[] | undefined;
  designAnnotationsOf: (conversationId: Id, annotations: readonly DesignAnnotation[] | undefined) => ResolvedDesignAnnotation[] | undefined;
  designSystemAnnotationsOf: (
    conversationId: Id,
    annotations: readonly DesignSystemAnnotation[] | undefined,
  ) => ResolvedDesignSystemAnnotation[] | undefined;
  videoAnnotationsOf: (conversationId: Id, annotations: readonly VideoAnnotation[] | undefined) => ResolvedVideoAnnotation[] | undefined;
  docsAnnotationsOf: (conversationId: Id, annotations: readonly DocsAnnotation[] | undefined) => ResolvedDocsAnnotation[] | undefined;
}): Pick<RpcHandlers['methods'], TemplateMethod> {
  const {
    templates,
    media,
    harness,
    skills,
    brands,
    slideAnnotationsOf,
    designAnnotationsOf,
    designSystemAnnotationsOf,
    videoAnnotationsOf,
    docsAnnotationsOf,
  } = deps;
  return {
    'templates.list': (p) => templates.list(p.language),
    'templates.get': (p) => templates.get(p.id, p.language),
    'templates.openHandle': async (p) => {
      const { root, file } = await templates.locate(p.id, p.path);
      return media.issue(root, file);
    },
    'conversations.send': async ({
      template,
      skill,
      skills: picked,
      slideAnnotations,
      designAnnotations,
      designSystemAnnotations,
      videoAnnotations,
      docsAnnotations,
      skipProjectBrand,
      ...params
    }) => {
      const annotations = slideAnnotationsOf(params.conversationId, slideAnnotations);
      const design = designAnnotationsOf(params.conversationId, designAnnotations);
      const system = designSystemAnnotationsOf(params.conversationId, designSystemAnnotations);
      const video = videoAnnotationsOf(params.conversationId, videoAnnotations);
      const docs = docsAnnotationsOf(params.conversationId, docsAnnotations);
      const resolved = await resolveSendSkills(skills, sendSkillRefs({ skill, skills: picked }));
      const brand = await brands.sendBrand(harness.conversationOf(params.conversationId)?.projectId, skipProjectBrand === true);
      return harness.send({
        ...params,
        ...(template ? { template: await resolveSceneTemplate(templates, template) } : {}),
        ...(brand ? { brand } : {}),
        ...(resolved ? { skills: resolved } : {}),
        ...(annotations ? { slideAnnotations: annotations } : {}),
        ...(design ? { designAnnotations: design } : {}),
        ...(system ? { designSystemAnnotations: system } : {}),
        ...(video ? { videoAnnotations: video } : {}),
        ...(docs ? { docsAnnotations: docs } : {}),
      });
    },
  };
}
