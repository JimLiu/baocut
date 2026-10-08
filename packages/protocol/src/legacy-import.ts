/**
 * 旧版项目的导入询问（架构设计 §2.7）。设置、服务配置、云凭据与远端节点照旧在启动时自动迁入；项目要等用户回答：
 * Runtime 发现了还没导入的旧版（v1 / v2）项目、又没有记下决定时，在 `legacy-import` 主题上给出询问，由桌面界面问一次。
 *
 * - 回答 `import` 带导入目录：这个目录就是导入后的项目，每个旧版项目是其中的一个视频；记下之后不再问。
 * - 回答 `never`（「跳过」并勾选「不再提醒」）：记下，以后不再导入，也不再问。
 * - 「跳过」不发请求：询问留在 Runtime 里，界面这次不再弹，下次启动再问。
 *
 * 回答 `import` 之后的导入是一次运行（`LegacyImportRun`）：同一个主题报每个项目导入到哪一步、导入不成的原因；
 * 没导入的可以重试（`legacyImport.retry`）或跳过（`legacyImport.setSkipped`，记下以后不再自动导入，可以撤销）。
 * 没导入、也没跳过的，下次启动自动再试。
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

/** 一个项目没导入的原因。`missing` 只列前几个缺的文件，`missingCount` 是总数。 */
export type LegacyImportProblem =
  /** 缺的文件在一块现在没接上的外接硬盘或网络卷上（`volume.root` 不存在）：接上后重试。 */
  | { kind: 'offline'; volume: { root: string; name: string }; missing: string[]; missingCount: number }
  /** 缺的文件被移动、改名或删除了：放回原处后重试。 */
  | { kind: 'missing'; missing: string[]; missingCount: number }
  /** 旧项目文件读不出来（损坏、不完整，或这个平台不支持的版本）：重试多半还是不行。 */
  | { kind: 'unreadable' }
  /** 导入时出错（找不到导入引擎、写新项目失败等）。`report` 是导入报告（`import-report.json`）的路径，没有时为 null。 */
  | { kind: 'failed'; report: string | null };

/**
 * 一个项目在这次导入里的状态：`queued` 排队、`importing` 正在导入、`imported` 已导入、
 * `not-imported` 没导入（看 `problem`）、`skipped` 用户跳过（以后不再自动导入）。
 */
export type LegacyImportItemState = 'queued' | 'importing' | 'imported' | 'not-imported' | 'skipped';

export interface LegacyImportItem extends LegacyProjectSummary {
  state: LegacyImportItemState;
  /** `not-imported` 的原因；跳过的留着跳过前的原因（更早的启动里跳过的没有）；其余为 null。 */
  problem: LegacyImportProblem | null;
}

/**
 * 这次启动里的项目导入：回答 `import` 之后（或上次有没导入的、这次启动自动再试时）出现，Runtime 停下前一直在。
 * 只列这次启动开始时还没导入的项目，更早导入完成的不列。
 */
export interface LegacyImportRun {
  /** 这次运行的标识；Runtime 重启后换一个。 */
  runId: string;
  /** 导入目录（导入后的项目，绝对路径）。 */
  directory: string;
  /** `importing` 在导入；`waiting` 其他任务在跑，导入先停一下、等它们结束后自动继续；`finished` 每一项都有了结果。 */
  state: 'importing' | 'waiting' | 'finished';
  /** 最近一次开始（首次或重试）的时刻，ISO 8601。 */
  startedAt: string;
  /** 最近一次跑完的时刻；在跑时为 null。 */
  finishedAt: string | null;
  /** 最近编辑的在前。 */
  items: LegacyImportItem[];
}

/**
 * `legacy-import` 主题的快照：等用户回答的询问；没有（没发现、已经决定、还在发现）时为 null。
 * `run` 是这次启动里的导入；没有要导入的时为 null。
 */
export interface LegacyImportSnapshot {
  prompt: LegacyImportPrompt | null;
  run: LegacyImportRun | null;
}

/** 询问出现或消失（被回答，或 Runtime 不再等）、导入有了进展：都带完整的新状态，客户端整体替换那一项。 */
export type LegacyImportEvent =
  | { type: 'prompt.updated'; prompt: LegacyImportPrompt | null }
  | { type: 'run.updated'; run: LegacyImportRun | null };

/** `import`：导入到 `directory`（绝对路径，不存在时创建）；`never`：以后不再提醒、不再导入。 */
export type LegacyImportAnswer =
  | { promptId: string; decision: 'import'; directory: string }
  | { promptId: string; decision: 'never' };

/** 重试没导入的项目（`paths` 缺省 = 全部没导入的）；点名的跳过项也重新导入，并清掉跳过的记录。`queued` 是重新排队的个数。 */
export interface LegacyImportRetry {
  paths?: string[];
}

/** 跳过没导入的项目（以后不再自动导入），或撤销跳过（`skipped: false`：放回跳过前的原因，没有原因的重新导入）。 */
export interface LegacyImportSetSkipped {
  paths: string[];
  skipped: boolean;
}
