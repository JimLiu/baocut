import { newId, type SkillChangeResult, type SkillDetail, type SkillFileContent, type SkillRemoveResult } from '@baocut/protocol';
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

async function apply<T extends SkillChangeResult | SkillRemoveResult>(pending: Promise<T>): Promise<T> {
  const result = await pending;
  useSkills.getState().succeed(result);
  return result;
}

/** 一个 skill 的摘要、`SKILL.md` 全文与文件清单。 */
export function getSkill(session: Session, id: string): Promise<SkillDetail> {
  return session.client.request('skills.get', { id });
}

/** 读 skill 目录里的一个文本文件（`skills.get` 文件清单里 `text` 为真的）。 */
export function readSkillFile(session: Session, id: string, path: string): Promise<SkillFileContent> {
  return session.client.request('skills.readFile', { id, path });
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
}
