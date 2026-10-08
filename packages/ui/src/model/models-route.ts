import { MODEL_CATEGORY_INFO, modelPageFor, type ModelCategory, type ModelPage } from './settings-nav.ts';

/**
 * 设置内模型配置路由（产品设计 §2.1、§7.6）：`settings/models/<类>[/<页>]`。没带页、或带的页不属于这一类时，落到这一类上次停的页，
 * 再没有就是第一页。左栏与窄窗口下拉换类时也带上那一类上次停的页。
 */
export interface ModelsLocation {
  category: ModelCategory;
  page: ModelPage;
}

export function resolveModelsRoute(
  category: ModelCategory,
  page: ModelPage | undefined,
  last: Partial<Record<ModelCategory, ModelPage>>,
): ModelsLocation {
  return { category, page: modelPageFor(category, page, last[category]) };
}

/** 左栏各类的去处：当前这一类用已经解析好的页（免得第一帧与选中项对不上），其余用它上次停的页。 */
export function modelsNavTargets(current: ModelsLocation, last: Partial<Record<ModelCategory, ModelPage>>): ModelsLocation[] {
  return MODEL_CATEGORY_INFO.map((info) =>
    info.key === current.category ? current : { category: info.key, page: modelPageFor(info.key, undefined, last[info.key]) },
  );
}
