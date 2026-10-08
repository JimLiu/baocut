/**
 * 旧版项目的导入询问（架构设计 §2.7）。设置、服务配置、云凭据与远端节点照旧在启动时自动迁入；项目要等用户回答：
 * Runtime 发现了还没导入的旧版（v1 / v2）项目、又没有记下决定时，在 `legacy-import` 主题上给出询问，由桌面界面问一次。
 *
 * - 回答 `import` 带导入目录：这个目录就是导入后的项目，每个旧版项目是其中的一个视频；记下之后不再问。
 * - 回答 `never`（「跳过」并勾选「不再提醒」）：记下，以后不再导入，也不再问。
 * - 「跳过」不发请求：询问留在 Runtime 里，界面这次不再弹，下次启动再问。
 *
 * 只给桌面界面（与 CLI）：`legacyImport.*` 与这个主题不在 Web 服务的白名单里。
 */

/** 一个发现的、还没导入的旧版项目。 */
export interface LegacyProjectSummary {
  /** 旧项目目录（真实路径）。 */
  path: string;
  /** 旧标题；没有时是目录名。 */
  title: string;
  /** 上次编辑：旧项目文件的修改时间（ISO 8601）；读不到时为 null。 */
  editedAt: string | null;
}

export interface LegacyImportPrompt {
  /** 这次询问的标识；回答时带上，已经回答过或过期的以 `not-found` 拒绝。 */
  promptId: string;
  /** 最近编辑的在前。 */
  projects: LegacyProjectSummary[];
  /** 默认导入目录（绝对路径）：系统「文稿 / 文档」文件夹下的 `BaoCut`。 */
  defaultDirectory: string;
}

/** `legacy-import` 主题的快照：等用户回答的询问；没有（没发现、已经决定、还在发现）时为 null。 */
export interface LegacyImportSnapshot {
  prompt: LegacyImportPrompt | null;
}

/** 询问出现或消失（被回答，或 Runtime 不再等）：带完整的新状态，客户端整体替换。 */
export type LegacyImportEvent = { type: 'prompt.updated'; prompt: LegacyImportPrompt | null };

/** `import`：导入到 `directory`（绝对路径，不存在时创建）；`never`：以后不再提醒、不再导入。 */
export type LegacyImportAnswer =
  | { promptId: string; decision: 'import'; directory: string }
  | { promptId: string; decision: 'never' };
