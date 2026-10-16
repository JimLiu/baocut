import { useMemo } from 'react';
import { getLocale, type TemplateLayers } from '@baocut/protocol';
import { templateGroups, type TemplateEntry, type TemplateGroup } from '../../model/template-layers.ts';
import { useBrandTemplates, type BrandTemplate } from './use-brand-templates.ts';

export interface TemplateCatalog {
  /** 内置十七款加品牌库的定义，按组分节，品牌库那一组在最后。 */
  groups: TemplateGroup[];
  /** 内置的有几款（目录页分节头的说明）。 */
  builtinCount: number;
  /** 品牌库里的定义（`id` 是条目 ID）。 */
  brand: TemplateLayers[];
  /** 品牌库里的条目，与 `brand` 一一对应。 */
  brandEntries: BrandTemplate[];
  /** 品牌库的条目都读回来了。 */
  brandReady: boolean;
  /** 按定义 ID 找（实例的 `from`）。 */
  find(id: string): TemplateEntry | null;
}

/** 模板目录（元素面板、模板属性页与品牌库共用）：内置的跟界面语言，品牌库的按库里的条目。 */
export function useTemplateCatalog(): TemplateCatalog {
  const lang = getLocale();
  const { ready, templates } = useBrandTemplates();
  return useMemo(() => {
    const brand = templates.map((template) => template.doc);
    const groups = templateGroups(lang, brand);
    const all = groups.flatMap((g) => g.items);
    return {
      groups,
      builtinCount: all.filter((entry) => !entry.brand).length,
      brand,
      brandEntries: templates,
      brandReady: ready,
      find: (id) => all.find((entry) => entry.doc.id === id) ?? null,
    };
  }, [lang, templates, ready]);
}
