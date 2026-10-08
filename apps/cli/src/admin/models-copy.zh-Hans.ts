import { MODEL_SERVICE_CAPABILITIES, USAGE_PERIODS } from '@baocut/protocol';
import type { ModelsMessages } from './models-copy.ts';

export const zhHans: ModelsMessages = {
  help: `用法：
  baocut models cancel <bundleId> [--discard]
                                   停下安装（已经下载的部分保留，再次 install 续传）；--discard 一并删掉
  baocut models repair <bundleId> [--yes]
                                   逐个文件校验 sha256，只重新下载缺失或损坏的文件（确认规则同 install）
  baocut models dir                显示本地模型目录：位置、来源、已用与可用空间、已识别的模型数
  baocut models dir --set <路径> [--move|--switch]
                                   更改模型目录：--move 把现有模型移过去（后台任务，失败时回滚），--switch 只换位置
                                   （原来的文件保留，只有新位置里已有的模型可用）；当前目录里有模型时必须二选一。
                                   有任务在用本地模型时拒绝；环境变量 BAOCUT_MODELS_DIR 指定时只读
  baocut models dir --reset [--move|--switch]
                                   恢复默认位置（<BAOCUT_HOME>/models），规则同 --set
  baocut models configure <providerId> [选项]
                                   配置在线 Provider：目录里的服务商（openai、google、elevenlabs、anthropic、deepseek、
                                   qwen 等，见 baocut models capabilities），或自定义的 OpenAI 兼容端点 custom:<名字>
                                   智能体 Provider agent:codex 只有开关（用本机 Codex 的登录，没有密钥）
    --enable | --disable           启用（持续授权在需要时把素材音频、文本或提示词发给它）或停用
    --key-stdin                    从标准输入读 API key（不接受命令行参数里的密钥）：替换第一个账号的密钥，
                                   没有账号时建一个（多个账号用 baocut models accounts）
    --endpoint <url>               自定义端点的基址（首次配置必填）；目录里的服务商可改写为代理或网关
    --model <id> ...               自定义端点提供的转写模型（可重复，第一个为默认）
    --speech-model <id> ...        自定义端点提供的语音合成模型（/audio/speech；可重复）
    --image-model <id> ...         自定义端点提供的图片生成模型（/images/generations；可重复）
    --text-model <id> ...          自定义端点提供的文本模型（/chat/completions；可重复）
                                   给了任意一种模型时，声明的模型整体替换
    --verify                       保存前用新的密钥与端点向供应商验证一次
  baocut models accounts <providerId>
                                   列出一家服务商的账号：先后、名字、掩码、开关与状态（调用用第一个启用且有密钥的，
                                   出错不换下一个）
  baocut models accounts add <providerId> [--label <名字>] [--region <地区>] [--endpoint <url>] [--verify]
                                   添加账号，密钥从标准输入读；--region 用目录里的地区（如 global、cn）；
                                   --verify 先向服务商验证，不通过不保存。加账号不等于启用
  baocut models accounts remove <providerId> <accountId|名字>
                                   移除一个账号与它的密钥（删掉最后一个账号时服务商还在，只是没有可用的密钥）
  baocut models accounts use <providerId> <accountId|名字>
                                   设为首选：把这个账号排到最前
  baocut models usage [--period <${USAGE_PERIODS.join('|')}>] [--provider <id>]
                                   在线服务商与智能体的调用次数、用量与花费（默认最近 30 天）：按标价估算的、服务商
                                   报告的与费用未知的分开列，币种不换算；按服务商、能力、模型与账号拆分
  baocut models default <能力> <providerId|none> [modelId]
                                   设置或清除一种能力（${MODEL_SERVICE_CAPABILITIES.join('、')}）的默认 Provider 与模型
  baocut models remove <bundleId|providerId>
                                   删除本地模型包（别的模型包在用的共享组件保留；有任务在用时拒绝）；
                                   或移除在线服务商：自定义端点（custom:<名字>）整个删除，目录里的服务商停用并删掉
                                   全部账号与密钥
  baocut models refresh <providerId>
                                   向在线 Provider 取模型（与音色）列表并缓存：列表里没有的内置模型标为不可用；
                                   取不到时照旧用内置列表
  baocut models parameters generateText [--effort <档位|default>] [--concurrency <n|default>]
                                   查看或设置文本生成的默认推理强度与每个 Provider 的并发上限（默认 4）；default 恢复出厂值`,
  byteProgressUnknown: (done) => `已收到 ${done}（总大小未知）`,
  byteProgress: (done, total, percent) => `${done} / ${total}（${percent}%）`,
  bundleStates: {
    'not-installed': '未安装',
    downloading: '下载中',
    installed: '已安装',
    loading: '加载中',
    ready: '就绪',
    busy: '忙',
    unloading: '卸载中',
    error: '不可用',
  },
  installStates: {
    queued: '排队',
    downloading: '下载中',
    verifying: '校验与发布',
    paused: '已暂停',
  },
  bundleState: (label, state, reason) => `${label}（${state}${reason ? ` / ${reason}` : ''}）`,
  componentInstalled: '已装',
  componentMissing: '缺失',
  sharedWith: (bundles) => `  与 ${bundles.join('、')} 共用`,
  installTask: (jobId) => `  任务 ${jobId}`,
  resumeHint: (bundleId) => `；baocut models install ${bundleId} 续传`,
  installLine: (state, progress, task, hint) => `  安装：${state}  ${progress}${task}${hint}`,
  checkPassed: '通过',
  checkFailed: (code) => `没通过${code ? `（${code}）` : ''}`,
  checkLine: (result, at, detail) => `  检查：${result}  ${at}${detail ? `  ${detail}` : ''}`,
  remedyAppFileMissing: '补救：重新安装 BaoCut；修复模型帮不上',
  remedyRepair: (bundleId) => `补救：baocut models repair ${bundleId} 只重新下载坏掉的文件，修好后再检查`,
  remedyMaybeRepair: (bundleId) => `补救：先试 baocut models repair ${bundleId}（只重新下载坏掉的文件），再检查`,
  remedyOutOfMemory: '补救：关掉别的占内存的程序，或换一个小一点的模型，再检查',
  remedy: (text) => `补救：${text}`,
  upToDate: (repair, bundleId) => (repair ? `${bundleId} 的文件都完好，不用修复` : `${bundleId} 已经装好，不用下载`),
  planHeader: (repair, bundleId, source) => `${repair ? '修复' : '安装'} ${bundleId}，来源 ${source}`,
  planKeep: (component, repo) => `  ${component}  ${repo}  已装好，保留`,
  planDownload: (component, repo, files, size) => `  ${component}  ${repo}  下载 ${files} 个文件，${size}`,
  sizeUnknown: '大小未知',
  toDownloadEstimate: (estimate) => `要下载：大小未知，估计约 ${estimate}`,
  toDownload: (size) => `要下载：${size}`,
  resumed: (size) => `续传：暂存区里已有 ${size}，不再下载`,
  freeSpace: (size, short) => `可用空间：${size}${short ? '（不够）' : ''}`,
  sizeAbout: (size) => `约 ${size}`,
  installPrompt: (repair, size) => `确认${repair ? '修复' : '安装'}并下载 ${size}？[y/N] `,
  noSpace: (need, have) => `磁盘空间：这次要 ${need}，只剩 ${have}`,
  removed: (files) => `已删除：${files.join('、')}`,
  nothingRemoved: '没有删除文件',
  keptInUse: (repo, users) => `保留 ${repo}：${users.join('、')} 还在用`,
  keptOtherVersion: (repo) => `保留 ${repo}：目录里是别的版本，不属于这个模型包`,
  dirSources: {
    default: '默认位置',
    setting: '设置里选的文件夹',
    env: '环境变量 BAOCUT_MODELS_DIR（只读：要改请改环境变量并重启 BaoCut）',
  },
  dirSource: (label) => `  来源：${label}`,
  dirMissing: '  这个文件夹不存在（外置盘没有接上时也会这样）',
  dirNotWritable: '  BaoCut 没有这个文件夹的写入权限',
  dirUsage: (used, free, models) => `  已用 ${used}${free ? ` · 所在磁盘可用 ${free}` : ''} · 已识别 ${models} 个模型`,
  dirDefault: (path) => `  默认位置：${path}`,
  dirMoving: (to, jobId) => `  正在移动${to ? `到 ${to}` : ''}（任务 ${jobId}）`,
  dirEnvLocked: '模型目录由环境变量 BAOCUT_MODELS_DIR 指定：要改请改环境变量并重启 BaoCut',
  dirProblemMissing: '这个文件夹不存在：外置盘没有接上时也会这样，接好后再试',
  dirProblemNotWritable: 'BaoCut 没有这个文件夹的写入权限：换一个可写的位置，或先改它的权限',
  dirProblemNested: '新位置与当前的模型目录互相包含：换一个不在它里面、也不包含它的文件夹',
  dirProblemSame: '已经是当前的模型目录',
  dirFound: (count, size) => `发现 ${count} 个已下载的模型（${size}），可以直接使用`,
  dirEmpty: '这个文件夹里还没有模型，之后下载的模型会放在这里',
  dirFree: (size) => `所在磁盘可用 ${size}`,
  moveSameVolume: '同一块盘，移动只改名，不占额外空间',
  moveSize: (size, fits) => `要移动 ${size}${fits ? '' : '，放不下'}`,
  dirCurrentHas: (size, move) => `当前目录里有 ${size} 模型：${move}`,
  moveOrSwitch: '--move 与 --switch 只能选一个',
  accountStates: {
    unknown: '未验证',
    ok: '正常',
    'invalid-key': '密钥无效',
    'rate-limited': '限速',
    'quota-exhausted': '额度用尽',
  },
  rateLimitedUntil: (label, until) => `${label}（${until} 恢复）`,
  noAccounts: '还没有账号：baocut models accounts add <providerId> 从标准输入读密钥',
  accountEnabled: '已启用',
  accountDisabled: '已停用',
  accountKeyUnreadable: '读不到密钥',
  accountRegion: (region) => `地区 ${region}`,
  accountEndpoint: (endpoint) => `端点 ${endpoint}`,
  accountLastUsed: (at) => `最近使用 ${at}`,
  accountCurrent: '当前使用',
  accountChoice: (accountId, label) => `${accountId}（${label}）`,
  noAccountChoices: '没有账号',
  listSep: '、',
  accountAmbiguous: (count, ref, choices) => `有 ${count} 个账号叫「${ref}」，请用 accountId：${choices}`,
  accountNotFound: (ref, choices) => `没有这个账号：${ref}（可选 ${choices}）`,
  usagePeriods: { today: '今天', '7d': '最近 7 天', '30d': '最近 30 天', all: '全部' },
  unitTokens: (input, output) => `输入 ${input} / 输出 ${output} token`,
  unitCached: (cached) => `缓存命中 ${cached}`,
  unitAudio: (minutes) => `音频 ${minutes} 分钟`,
  unitChars: (chars) => `${chars} 字符`,
  unitImages: (images) => `${images} 张图`,
  clauseSep: '，',
  costKinds: {
    reported: '服务商报告',
    estimated: '按标价估算',
    mixed: '报告与估算',
    unknown: '费用未知',
  },
  rowCalls: (calls, failed) => `${calls} 次${failed > 0 ? `（失败 ${failed}）` : ''}`,
  costApprox: (money, kind) => `≈ ${money}（${kind}）`,
  usageHeader: (scope, period, from, to) => `用量（${scope ? `${scope}，` : ''}${period}：${from} 至 ${to}）`,
  noCalls: '  还没有调用',
  totalCalls: (calls, failed) => `  调用 ${calls} 次${failed > 0 ? `（失败 ${failed}）` : ''}`,
  usageUnits: (units) => `  用量：${units}`,
  spentEstimated: (money) => `  花费 ≈ ${money}（按标价估算）`,
  spentReported: (money) => `  花费 ${money}（服务商报告）`,
  unknownCostCalls: (calls) => `  另有 ${calls} 次调用费用未知`,
  noBilledCalls: '  没有计费的调用',
  byProvider: '按服务商',
  byCapability: '按能力',
  byModel: '按模型',
  byAccount: '按账号',
  usageRepair: '用法：baocut models repair <bundleId> [--yes]',
  usageCancel: '用法：baocut models cancel <bundleId> [--discard]',
  usageConfigure: '用法：baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …',
  usageDefault: '用法：baocut models default <能力> <providerId|none> [modelId]',
  usageRemove: '用法：baocut models remove <bundleId|providerId>',
  usageRefresh: '用法：baocut models refresh <providerId>',
  usageParameters: '用法：baocut models parameters generateText [--effort <档位|default>] [--concurrency <n|default>]',
  usageAccounts:
    '用法：baocut models accounts <providerId> | add <providerId> [--label <名字>] [--region <地区>] [--verify] | remove <providerId> <账号> | use <providerId> <账号>',
  usageDir: '用法：baocut models dir [--set <路径> [--move|--switch] | --reset [--move|--switch]]',
  cancelledDiscarded: '已停下并删掉已下载的部分',
  cancelledKept: '已停下（已下载的部分保留，再次 install 续传）',
  unknownCapability: (capability, choices) => `不认识的能力：${capability}（可选 ${choices.join('、')}）`,
  clearDefaultNoModel: '清除默认值时不要给模型',
  defaultSet: (label, provider, model) => `${label}的默认值：${provider} / ${model}`,
  defaultCleared: (label) => `已清除${label}的默认值`,
  customProviderDeleted: (id) => `已删除 ${id}（指向它的默认值保留，显示为不可用）`,
  providerRemoved: (id) => `已移除 ${id}：停用，并删掉它的全部账号与密钥（指向它的默认值保留，显示为不可用）`,
  providerRefreshFailed: (id, error) => `没能刷新 ${id}：${error ?? '原因不明'}；照旧用内置的模型列表`,
  providerRefreshed: (id, models, voices, at) => `已刷新 ${id}：${models} 个模型${voices !== undefined ? `、${voices} 个音色` : ''}（${at}）`,
  periodChoices: (periods) => `--period 只能是 ${periods.join('、')}`,
  enableDisableConflict: '--enable 与 --disable 只能给一个',
  saved: (description) => `已保存：${description}`,
  verifiedAndSaved: '已验证并保存',
  savedPlain: '已保存',
  providerNotEnabled: (id) => `${id} 还没有启用：baocut models configure ${id} --enable`,
  accountRemoved: (name) => `已移除账号 ${name}`,
  accountPreferred: (name) => `已设为首选：${name}`,
  providerHasNoAccounts: (id) => `${id} 没有账号`,
  noSuchProvider: (id) => `没有这个服务商：${id}`,
  alreadyRepairing: (jobId) => `已经在修复（任务 ${jobId}），接着显示进度`,
  nothingToRepair: '没有要修复的文件',
  notTtyConfirmDownload: '没有在终端里运行：用户确认下载之后加 --yes',
  notDownloaded: '没有下载',
  nothingToDownload: '没有要下载的东西',
  repairDone: '修复完成',
  repairPartialKept: (bundleId) => `已下载的部分保留：baocut models repair ${bundleId} 续传`,
  setResetConflict: (usage) => `--set 与 --reset 只能选一个。${usage}`,
  dirHasModels: '当前目录里有模型：加 --move 把它们移过去，或 --switch 只换位置（原来的文件保留）',
  dirChanged: (dir, oldFilesKept) => `模型目录已改为 ${dir}${oldFilesKept ? '（原位置的文件保留）' : ''}`,
  modelsMoved: (dir) => `已把模型移到 ${dir}`,
  dirRolledBack: '已回滚：原来的模型目录没有变化',
  pasteKeyHint: '粘贴 API key 后按回车，再按 Ctrl-D 结束输入：',
  noKeyOnStdin: '标准输入里没有 API key',
  keyHasWhitespace: 'API key 不应含空白或换行：标准输入里只放密钥本身',
  positiveInteger: (option) => `${option} 要是正整数`,
  effortChoices: (efforts) => `--effort 可选 ${efforts.join('、')}`,
  capabilityLabels: {
    transcribe: '转写',
    synthesizeSpeech: '语音合成',
    generateImage: '图片生成',
    generateText: '文本生成',
    separateAudio: '人声分离',
  },
  unavailableLabels: {
    'not-configured': '未启用',
    'missing-credential': '缺少 API key',
    'not-installed': '未安装',
    'signed-out': '未登录',
    outdated: '版本太旧',
    'not-paired': '未配对',
    'not-connected': '连不上',
    unsupported: '不支持',
    resource: '反复出错已停用',
  },
  unavailable: '不可用',
  capabilityState: (label, available, reason) => `${label}${available ? '可用' : `不可用（${reason}）`}`,
  capabilitySep: '，',
  configEnabled: '已启用',
  configDisabled: '已停用',
  keyState: (set) => `密钥${set ? '已设置' : '未设置'}`,
  configEndpoint: (url) => `端点 ${url}`,
  modelListRefreshed: (at) => `模型列表刷新于 ${at}`,
  lastRefreshFailed: (at) => `上次刷新失败（${at}），用内置列表`,
  textParameters: (effort, concurrency) => `默认推理强度：${effort ?? '模型自己的'} · 每个 Provider 并发 ${concurrency}`,
  markDefault: '默认',
  markDeclared: '用户声明',
  wordTimestampsNative: '词级时间',
  wordTimestampsEstimated: '词时间按字长估计',
  maxInputMegabytes: (mb) => `单次 ≤ ${mb} MB`,
  maxDurationMinutes: (minutes) => `单次 ≤ ${minutes} 分钟`,
  voiceCount: (count, defaultVoice) => `音色 ${count} 个（默认 ${defaultVoice ?? '无'}）`,
  noPresetVoices: '没有预置音色，须指定',
  acceptsCustomVoices: '接受自定义音色',
  maxInputChars: (count) => `单次 ≤ ${count} 字符`,
  acceptsInstructions: '接受语气说明',
  sizeCount: (count, defaultSize) => `尺寸 ${count} 种${defaultSize ? `（默认 ${defaultSize}）` : ''}`,
  aspectRatios: (ratios) => `宽高比 ${ratios}`,
  maxImageCount: (count) => `一次 ≤ ${count} 张`,
  sizeAndSeedFixed: '尺寸与 seed 不可指定',
  contextTokens: (count) => `上下文 ${count} token`,
  maxOutputTokens: (count) => `单次输出 ≤ ${count} token`,
  efforts: (efforts, defaultEffort) => `推理强度 ${efforts}${defaultEffort ? `（默认 ${defaultEffort}）` : ''}`,
  structuredOutput: '结构化输出',
  subscription: '订阅内，额度未知',
  modelName: (id, label) => `${id}（${label}）`,
};
