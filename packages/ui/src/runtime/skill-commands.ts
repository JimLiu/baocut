import {
  newId,
  type Id,
  type MediaHandle,
  type ProjectBrandDetail,
  type ProjectBrandSummary,
  type SkillChangeResult,
  type SkillDetail,
  type SkillFileChange,
  type SkillFileContent,
  type SkillInstallResult,
  type SkillListResult,
  type SkillPackageInspection,
  type SkillPackagePick,
  type SkillRemoveResult,
  type SkillVersionsResult,
} from '@baocut/protocol';
import { useBrands } from '../state/brands-store.ts';
import { useSkills } from '../state/skills-store.ts';
import type { RuntimeSession } from './session.ts';

/**
 * Agent 的 skill（`skills.*`，产品设计 §6.9）：列表进 state/skills-store，开关、添加、导入与移除返回的整份列表直接写回。
 * 单独成文件，不把会话通道撑大（同 template-commands.ts）。
 */

type Session = Pick<RuntimeSession, 'client'>;

let listing: Promise<void> | null = null;

/** 取一次列表；已经在取时不重复发。旧的列表在取的过程中照常显示。 */
export function loadSkills(session: Session): Promise<void> {
  if (listing) return listing;
  useSkills.getState().begin();
  listing = session.client
    .request('skills.list', {})
    .then(
      (result) => useSkills.getState().succeed(result),
      (error: Error) => useSkills.getState().fail(error.message),
    )
    .finally(() => {
      listing = null;
    });
  return listing;
}

async function apply<T extends SkillListResult>(pending: Promise<T>): Promise<T> {
  const result = await pending;
  useSkills.getState().succeed(result);
  return result;
}

/** 一个 skill 的摘要、`SKILL.md` 全文与文件清单；给 `revision` 时是那个旧版本的。 */
export function getSkill(session: Session, id: string, revision?: number): Promise<SkillDetail> {
  return session.client.request('skills.get', revision === undefined ? { id } : { id, revision });
}

/** 读 skill 目录里的一个文本文件（`skills.get` 文件清单里 `text` 为真的）；给 `revision` 时读那个旧版本里的。 */
export function readSkillFile(session: Session, id: string, path: string, revision?: number): Promise<SkillFileContent> {
  return session.client.request('skills.readFile', revision === undefined ? { id, path } : { id, path, revision });
}

/** 素材预览（图片、音频、视频、字体）用的媒体句柄。 */
export function openSkillFile(session: Session, id: string, path: string, revision?: number): Promise<MediaHandle> {
  return session.client.request('skills.openHandle', revision === undefined ? { id, path } : { id, path, revision });
}

/** 版本记录，新的在前。 */
export function skillVersions(session: Session, id: string): Promise<SkillVersionsResult> {
  return session.client.request('skills.versions', { id });
}

/** 认一个 zip 或文件夹：列出候选、略过的系统文件与同名冲突，不装。 */
export function inspectSkillPackage(session: Session, path: string): Promise<SkillPackageInspection> {
  return session.client.request('skills.inspectPackage', { path });
}

/** 装选中的候选：新的、更新同名的个人 skill（存成新版本）或另存为副本。 */
export function installSkillPackage(session: Session, path: string, picks: SkillPackagePick[]): Promise<SkillInstallResult> {
  return apply(session.client.request('skills.installPackage', { path, picks, commandId: newId('cmd') }));
}

/** 新建空白的个人 skill；`body` 是界面按语言给的正文模板。 */
export function createSkill(
  session: Session,
  params: { name: string; title?: string; description: string; body: string },
): Promise<SkillChangeResult> {
  return apply(session.client.request('skills.create', { ...params, commandId: newId('cmd') }));
}

/** 复制成个人 skill（内置与第三方的改不了，复制一份来改）。 */
export function duplicateSkill(session: Session, id: string): Promise<SkillChangeResult> {
  return apply(session.client.request('skills.duplicate', { id, commandId: newId('cmd') }));
}

/** 存成一个新版本；`baseRevision` 不是当前版本时 Runtime 回 `conflict`。 */
export function writeSkill(
  session: Session,
  params: { id: string; baseRevision: number; changes: SkillFileChange[]; note?: string },
): Promise<SkillChangeResult> {
  return apply(session.client.request('skills.write', { ...params, commandId: newId('cmd') }));
}

/** 把一个旧版本存成新版本，不改写历史。 */
export function restoreSkill(session: Session, id: string, revision: number): Promise<SkillChangeResult> {
  return apply(session.client.request('skills.restore', { id, revision, commandId: newId('cmd') }));
}

/** 打成 zip 存到 `path`（不含版本记录）。 */
export function exportSkill(session: Session, id: string, path: string): Promise<{ path: string }> {
  return session.client.request('skills.export', { id, path });
}

/* ---------- 项目品牌（BRAND.md） ---------- */

let brandListing: Promise<void> | null = null;

/** 有 `BRAND.md` 的项目；同 `loadSkills`，已经在取时不重复发。 */
export function loadBrands(session: Session): Promise<void> {
  if (brandListing) return brandListing;
  useBrands.getState().begin();
  brandListing = session.client
    .request('brands.list', {})
    .then(
      (result) => useBrands.getState().succeed(result.brands),
      (error: Error) => useBrands.getState().fail(error.message),
    )
    .finally(() => {
      brandListing = null;
    });
  return brandListing;
}

export function getBrand(session: Session, projectId: Id): Promise<ProjectBrandDetail> {
  return session.client.request('brands.get', { projectId });
}

export function readBrandFile(session: Session, projectId: Id, path: string): Promise<SkillFileContent> {
  return session.client.request('brands.readFile', { projectId, path });
}

export function openBrandFile(session: Session, projectId: Id, path: string): Promise<MediaHandle> {
  return session.client.request('brands.openHandle', { projectId, path });
}

async function applyBrand(pending: Promise<{ brand: ProjectBrandSummary }>): Promise<{ brand: ProjectBrandSummary }> {
  const result = await pending;
  useBrands.getState().upsert(result.brand);
  return result;
}

/** 改 `BRAND.md` 与 `brand/`；没有 `BRAND.md` 时由这次写入建出来。 */
export function writeBrand(session: Session, projectId: Id, changes: SkillFileChange[]): Promise<{ brand: ProjectBrandSummary }> {
  return applyBrand(session.client.request('brands.write', { projectId, changes, commandId: newId('cmd') }));
}

/** 从一个品牌 skill 生成这个项目的 `BRAND.md` 与 `brand/`。 */
export function createBrandFromSkill(session: Session, projectId: Id, skillId: string): Promise<{ brand: ProjectBrandSummary }> {
  return applyBrand(session.client.request('brands.createFromSkill', { projectId, skillId, commandId: newId('cmd') }));
}

/** 开关：从下一次新开始的 Agent 会话起生效。 */
export function setSkillEnabled(session: Session, id: string, enabled: boolean): Promise<SkillChangeResult> {
  return apply(session.client.request('skills.setEnabled', { id, enabled }));
}

/** 从本地文件夹添加（复制进 Runtime 的 skill 目录，归「我的」，默认开）。 */
export function addSkillFromFolder(session: Session, path: string): Promise<SkillChangeResult> {
  return apply(session.client.request('skills.add', { path, commandId: newId('cmd') }));
}

/** 从 GitHub 导入（只下载那个目录下的文件、不执行，归「第三方」，默认关）。 */
export function importSkillFromGithub(session: Session, url: string): Promise<SkillChangeResult> {
  return apply(session.client.request('skills.importGithub', { url: url.trim(), commandId: newId('cmd') }));
}

/** 移除「我的」或「第三方」skill：删掉它在 Runtime skill 目录里的文件夹，不能撤销。 */
export function removeSkill(session: Session, id: string): Promise<SkillRemoveResult> {
  return apply(session.client.request('skills.remove', { id }));
}

/** 测试用：清掉进行中的请求。 */
export function resetSkillCommands(): void {
  listing = null;
  brandListing = null;
}
