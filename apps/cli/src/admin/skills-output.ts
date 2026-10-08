import { SKILL_ID_PATTERN, SKILL_LIMITS, type SkillSendRef, type SkillSummary } from '@baocut/protocol';
import { M } from './skills-copy.ts';

/**
 * `baocut skills` 管理命令的参数与输出（架构设计 §3.8、§12.9）。列出与查看是派生命令（`skills list|read`）。
 */

function sourceText(skill: SkillSummary): string | null {
  const source = skill.source;
  if (!source) return null;
  if (source.kind === 'local') return M.localSource(source.path, source.addedAt);
  return M.remoteSource(source.url, source.ref, source.commit.slice(0, 12), source.importedAt);
}

/** 添加、导入与开关之后的一行回执；`verb` 是文案目录里的动作（`M.added` 等）。 */
export function formatSkillChanged(verb: string, skill: SkillSummary): string {
  const source = sourceText(skill);
  return M.changed(verb, skill.id, skill.name, skill.enabled, skill.path, source);
}

/** `--skill <id>` 与 `--id <id>`：本地先查 id 的形状，存在与否由 Runtime 判断（`SKILL_NOT_FOUND`）。 */
export function parseSkillId(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const id = value.trim();
  if (id.length > SKILL_LIMITS.id || !SKILL_ID_PATTERN.test(id)) throw new Error(M.idFormat(flag, value));
  return id;
}

/** `baocut chat --skill <id>`：点选一个 skill 发送。 */
export function parseChatSkill(value: string | undefined): SkillSendRef | undefined {
  const id = parseSkillId(value, '--skill');
  return id === undefined ? undefined : { id };
}
