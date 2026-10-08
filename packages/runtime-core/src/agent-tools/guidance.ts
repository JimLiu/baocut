// i18n-ignore-file: 给模型的入口指导（提示词）
import path from 'node:path';
import {
  AGENT_SKILL_ID,
  AgentSkillRenderError,
  renderAgentGuidance,
  type AgentSkillCatalog,
  type AgentSkillPage,
} from '../skills/agent-skill-renderer.ts';

/**
 * 会话内智能体的指导（架构设计 §3.8；Agent 面设计 §8.6「一个来源、两种渲染」）：不在这里手写，由说明书
 * `agent-skills/baocut/` 按工具桥面渲染。
 *
 * - `instructions`：SKILL.md 正文，作为每个原生会话的开发者指导（「工作方式」段），skill 索引附在它后面。
 * - `pages`：`references/catalog/*.md`、`workflows.md` 与 `conventions.md`，登记成内置 skill（`baocut-catalog-*`、
 *   `baocut-workflows`、`baocut-conventions`），出现在 skill 索引里，智能体按需 `skills_read`。
 *
 * `{{tool:…}}` 按 Runtime 真实的工具桥目录核对。找不到说明书或渲染不了时抛 `AgentGuidanceError`：Runtime 启动时就失败，
 * 不带着空的或过期的指导开会话。
 */

export interface AgentGuidanceBundle {
  instructions: string;
  pages: AgentSkillPage[];
  /** 说明书目录（`<root>/baocut`）。 */
  sourceDir: string;
}

export class AgentGuidanceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AgentGuidanceError';
  }
}

/** `root` 是说明书的根目录（里面是 `baocut/`，见 `resolveBuiltinAgentSkillsDir`）；`catalog` 是工具桥面的目录。 */
export function loadAgentGuidance(root: string | null, catalog: AgentSkillCatalog): AgentGuidanceBundle {
  if (!root) {
    throw new AgentGuidanceError(
      '找不到说明书目录 agent-skills/：会话内智能体的指导由它渲染。检查 BAOCUT_AGENT_SKILLS_DIR、打包资源里的 agent-skills/ 或仓库根',
    );
  }
  const sourceDir = path.join(root, AGENT_SKILL_ID);
  try {
    const { guidance, pages } = renderAgentGuidance(sourceDir, catalog);
    if (!guidance.trim()) throw new AgentGuidanceError(`说明书 ${sourceDir}/SKILL.md 渲染出的指导是空的`);
    return { instructions: guidance, pages, sourceDir };
  } catch (error) {
    if (error instanceof AgentGuidanceError) throw error;
    if (error instanceof AgentSkillRenderError) {
      throw new AgentGuidanceError(`会话指导渲染失败（${sourceDir}）：${error.message}`, { cause: error });
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AgentGuidanceError(`说明书目录不存在：${sourceDir}`, { cause: error });
    }
    throw error;
  }
}
