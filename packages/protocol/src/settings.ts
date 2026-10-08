import { DEFAULT_AGENT_MODE, type AgentMode } from './access.ts';
import type { Autonomy } from './domain.ts';
import type { LanguagePreference } from './i18n.ts';
import type { ResourceCapacitySetting } from './resources.ts';
import { SETTING_DESCRIPTION_MESSAGES } from './settings-copy.ts';

/**
 * Runtime 持有的偏好设置（架构设计 §5.10）：键、取值类型、默认值与说明是合同的一部分。
 *
 * 规则：
 * - 键用点分的小写名，一旦发布不改名；未知的键被拒绝（`invalid-request`），不静默保存。
 * - 取值按 `@baocut/protocol/schemas` 里的 `settingValueSchemas` 校验；不合的整批拒绝，一个也不落盘。
 * - `settings.set` 里给 `null` 表示恢复默认值；等于默认值的取值不另存，所以「是默认值」与「没有改过」是同一件事。
 * - 凭据不属于偏好设置（§6.8）：注册表里不放密钥、令牌或密码。
 * - 模型能力的默认 Provider 与模型由 `models.setDefault` 管（§6.8），不在这里。
 *
 * 校验用的 zod schema 在 `schemas.ts`：这个文件随主入口进界面，不带 zod。
 */

/** 转写完成后的后续动作。 */
export type TranscribeAfterComplete = 'open-video' | 'notify' | 'nothing';

/** 自动断行的目标行长（字符数），按语言类别：`cjk` 是中日韩文字，`other` 是其余按空格分词的文字。 */
export interface CaptionLineLength {
  cjk: number;
  other: number;
}

export interface SettingValues {
  /** 新会话用的 Driver；null 表示内置默认（`codex`）。 */
  'agent.defaultDriver': string | null;
  /** 新会话的模型；null 表示 Driver 自己的默认模型。 */
  'agent.defaultModel': string | null;
  /** 新会话的推理强度；null 表示 Driver 自己的默认值。 */
  'agent.defaultEffort': string | null;
  /** 还没切换过模式的会话用它（架构设计 §3.12）。旧值（controlled、authorized）读写时换成新值。 */
  'agent.defaultAccessMode': AgentMode;
  /**
   * 界面语言：`system` 跟随这台电脑的系统语言（没有对应的出货语言时英文），否则是一种出货语言。Runtime 给人看的文字
   * （错误原因、任务说明）按它生成；已经存下的文字保留生成时的语言。桌面界面把自己的选择写到这里（架构设计 §5.10）。
   */
  'ui.language': LanguagePreference;
  'captions.maxLineLength': CaptionLineLength;
  'transcribe.afterComplete': TranscribeAfterComplete;
  /**
   * 默认保存位置：工具没有视频的结果、从链接下载的媒体与 downloads_save 交出的文件都放这里。绝对路径；
   * null 表示当前主机的 ~/Downloads，独立于项目归属。
   */
  'downloads.directory': string | null;
  /**
   * 本地模型的下载来源（基址，`http(s)://`，不含凭据）；null 为公共模型仓库（`https://huggingface.co`）。环境变量
   * `BAOCUT_MODELS_ENDPOINT` 优先于它（架构设计 §6.3）。
   */
  'models.downloadEndpoint': string | null;
  /**
   * 模型目录：绝对路径；null 为缺省的 `<runtime-home>/models`。环境变量 `BAOCUT_MODELS_DIR` 优先于它（这时它不生效）。
   * 只经 `models.setDir` 更改（要先确认没有任务在用、卸下 Worker、选择移动还是只换位置），`settings.set` 不接受这个键（架构设计 §6.3）。
   */
  'models.dir': string | null;
  /**
   * 受管外部工具的下载来源（镜像的基址，`http(s)://`，不含凭据）：文件取自 `<基址>/<工具>/<版本>/<文件名>`；null 为工具的
   * 官方发布地址。环境变量 `BAOCUT_TOOLS_ENDPOINT` 优先于它（架构设计 §12.9）。
   */
  'tools.downloadEndpoint': string | null;
  /**
   * 排字用到、随内核与本机都没有、字体目录里有的族自动下载（预览与成片导出，架构设计 §9.1）。关掉时照回退字体画并提示，
   * 可以在选字列表里手动下载。
   */
  'fonts.autoDownload': boolean;
  /** 字体 CSS 接口的基址（镜像，`https://`）；null 为 `https://fonts.googleapis.com`。请求是 `<基址>/css2?family=…`。 */
  'fonts.cssEndpoint': string | null;
  /** 字体文件的基址（镜像，`https://`）：只从它下面取文件；null 为 `https://fonts.gstatic.com`。 */
  'fonts.fileEndpoint': string | null;
  /**
   * Space 回收站的保留天数（架构设计 §5.7）：移入回收站超过这么多天、没有引用的条目在启动时与之后定期物理删除，
   * 删除的视频也一样；有引用的留着。整数 1–3650。
   */
  'space.trashRetentionDays': number;
  /**
   * Runtime Home 里 `cache/` 的总大小上限（MiB，架构设计 §5.1）：超过时按修改时间从旧到新删缓存文件，降到上限的 90%。
   * 跨视频检索的内容索引（`cache/content-index/`）不删，但计入总大小。整数 256–1048576。
   */
  'cache.maxSizeMiB': number;
  /**
   * 资源调度用的机器容量（架构设计 §7.6、§7.7）：null 为自动探测（内存与 CPU 线程取自系统，Apple 芯片的 GPU 内存按统一内存估计，
   * 其余机器的 GPU 内存未知、不按它准入）。某一项为 null 时那一项照旧自动。
   */
  'resources.capacity': ResourceCapacitySetting | null;
  /**
   * CLI 拉起的 Runtime（架构设计 §2.2）空闲多少分钟后自己退出：没有本机网关连接、没有排队或运行中的任务、没有开着的对外服务。
   * 整数 1–1440。桌面端与手动启动的 Runtime 不受它影响。
   */
  'runtime.idleExitMinutes': number;
  'updates.autoCheck': boolean;
  'updates.autoDownload': boolean;
  'diagnostics.enabled': boolean;
  'offline.strict': boolean;
}

export type SettingKey = keyof SettingValues;

/** 注册表的顺序就是列表与 CLI 输出的顺序。 */
export const SETTING_KEYS = [
  'agent.defaultDriver',
  'agent.defaultModel',
  'agent.defaultEffort',
  'agent.defaultAccessMode',
  'ui.language',
  'captions.maxLineLength',
  'transcribe.afterComplete',
  'downloads.directory',
  'models.downloadEndpoint',
  'models.dir',
  'tools.downloadEndpoint',
  'fonts.autoDownload',
  'fonts.cssEndpoint',
  'fonts.fileEndpoint',
  'space.trashRetentionDays',
  'cache.maxSizeMiB',
  'resources.capacity',
  'runtime.idleExitMinutes',
  'updates.autoCheck',
  'updates.autoDownload',
  'diagnostics.enabled',
  'offline.strict',
] as const satisfies readonly SettingKey[];

export const SETTING_DEFAULTS: Readonly<SettingValues> = Object.freeze({
  'agent.defaultDriver': null,
  'agent.defaultModel': null,
  'agent.defaultEffort': null,
  'agent.defaultAccessMode': DEFAULT_AGENT_MODE,
  'ui.language': 'system',
  'captions.maxLineLength': Object.freeze({ cjk: 16, other: 42 }),
  'transcribe.afterComplete': 'open-video',
  'downloads.directory': null,
  'models.downloadEndpoint': null,
  'models.dir': null,
  'tools.downloadEndpoint': null,
  'fonts.autoDownload': true,
  'fonts.cssEndpoint': null,
  'fonts.fileEndpoint': null,
  'space.trashRetentionDays': 30,
  'cache.maxSizeMiB': 2048,
  'resources.capacity': null,
  'runtime.idleExitMinutes': 10,
  'updates.autoCheck': true,
  'updates.autoDownload': true,
  'diagnostics.enabled': false,
  'offline.strict': false,
});

/** 给人看的一句说明（设置页与 `baocut settings` 用）。读属性时取当前语言，文案在 `settings-copy.ts`。 */
export const SETTING_DESCRIPTIONS: Readonly<Record<SettingKey, string>> = SETTING_DESCRIPTION_MESSAGES;

/** 一个键给人看的说明（当前语言）。 */
export function settingDescription(key: SettingKey): string {
  return SETTING_DESCRIPTION_MESSAGES[key];
}

/** 不能经 `settings.set` 改的键：各有专门的方法（`models.dir` 用 `models.setDir`）。 */
export const SETTING_MANAGED_BY: Readonly<Partial<Record<SettingKey, string>>> = { 'models.dir': 'models.setDir' };

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

/** `settings.get` / `settings.set` 的结果，也是 `settings` 主题的快照：当前的有效值与默认值。 */
export interface SettingsView {
  settings: Partial<SettingValues>;
  defaults: Partial<SettingValues>;
}

/** 完整的视图（不按键过滤时）。 */
export interface SettingsSnapshot {
  settings: SettingValues;
  defaults: SettingValues;
}

/** `settings.set` 能写入的取值：访问模式另外接受旧值（§3.12）。 */
export type SettingInputValues = Omit<SettingValues, 'agent.defaultAccessMode'> & {
  'agent.defaultAccessMode': AgentMode | Autonomy;
};

/** 有效值变化时发一条，只带变了的键与它们的新有效值（恢复默认时是默认值）。 */
export type SettingsEvent = { type: 'settings.updated'; changed: Partial<SettingValues> };

/** 一个取值从哪里来：用户设过，或是默认值。 */
export type SettingSource = 'user' | 'default';

/**
 * 任务创建时冻结的一组取值（§5.10「任务在创建时冻结它用到的取值」）：之后改设置不影响它。
 */
export interface FrozenSettings<K extends SettingKey> {
  values: Pick<SettingValues, K>;
  sources: Record<K, SettingSource>;
}

/** 能冻结取值的一方（Runtime 的设置存储）。Harness 只依赖这个形状。 */
export interface SettingsReader {
  snapshot<K extends SettingKey>(keys: readonly K[]): FrozenSettings<K>;
}

/** 没有设置存储时（测试、单独使用 Harness）按默认值冻结。 */
export function defaultSettingsSnapshot<K extends SettingKey>(keys: readonly K[]): FrozenSettings<K> {
  const values = {} as Pick<SettingValues, K>;
  const sources = {} as Record<K, SettingSource>;
  for (const key of keys) {
    values[key] = SETTING_DEFAULTS[key];
    sources[key] = 'default';
  }
  return { values, sources };
}
