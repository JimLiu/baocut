import type { BrandContent, LibraryEntry, LibraryEntrySummary, TemplateLayers } from '@baocut/protocol';
import { useBrandEntries } from './use-brand-entries.ts';

export interface BrandTemplate {
  summary: LibraryEntrySummary;
  entry: LibraryEntry;
  /** 目录里的定义：`id` 换成条目 ID，`name` 用条目名（改名只改条目），去掉 `from` 与内置标记。 */
  doc: TemplateLayers;
}

/** 条目里的定义按目录的口径摆：套用时实例的 `from` 就是条目 ID，属性页据此认出「存在品牌库」。 */
export function brandTemplateDoc(entry: LibraryEntry): TemplateLayers | null {
  const content = entry.content as BrandContent;
  if (content.kind !== 'overlayTemplate') return null;
  const doc: TemplateLayers = { ...content.template, id: entry.id, name: content.name };
  delete doc.from;
  delete doc.builtin;
  return doc;
}

const pickTemplate = (summary: LibraryEntrySummary, entry: LibraryEntry): BrandTemplate | null => {
  const doc = brandTemplateDoc(entry);
  return doc ? { summary, entry, doc } : null;
};
const templateId = (template: BrandTemplate) => template.summary.id;

/** 品牌库里的模板（元素页模板目录的「品牌库」组、品牌页的模板一节、属性页的「存到品牌库」）。 */
export function useBrandTemplates(): { ready: boolean; templates: BrandTemplate[] } {
  const { ready, items } = useBrandEntries('overlayTemplate', pickTemplate, templateId);
  return { ready, templates: items };
}
