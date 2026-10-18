import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const zhHans: SettingDescriptionMessages = {
  'agent.defaultDriver': "新会话用的智能体引擎；null 优先使用已检测可用的 Agent（Codex 优先）。会话创建时冻结",
  'agent.defaultModel': '新会话的模型；null 用推荐模型（Claude Code 用 Sonnet，Codex 用 -sol 那一档），__agent-default__ 不传模型，按 Agent 自己命令行的配置',
  'agent.defaultEffort': '新会话的推理强度；null 为引擎自己的默认值',
  'agent.defaultAccessMode':
    '没有切换过访问模式的会话用它：ask、autoAcceptEdits、auto、fullAccess 或 plan（旧值 controlled、authorized 分别按 ask、fullAccess 处理）',
  'ui.language': `界面语言：system 跟随系统（没有对应的语言时英文），或语言代码（${LOCALES.join('、')}）。Runtime 给人看的文字也按它生成`,
  'captions.maxLineLength': '自动断行的目标行长（字符数）：cjk 为中日韩文字，other 为其余文字',
  'transcribe.afterComplete': '转写完成后：open-video 打开视频，notify 只通知，nothing 什么都不做',
  'downloads.directory':
    '默认保存位置：工具没有视频的结果、从链接下载的媒体与 downloads_save 交出的文件都放这里（绝对路径）；null 使用当前主机的 ~/Downloads，与项目归属无关',
  'downloads.cookieBrowsers': '从链接下载时的网站登录（下载视频、从链接转录，以及 Agent 的下载与转录）：all 用这台主机上检测到有 Cookie 库的所有浏览器，最近用过的在前；浏览器 id 列表（chrome、edge、firefox、safari、brave、chromium、opera、vivaldi、whale）按顺序逐个试；空列表匿名下载。每次下载开始时按当时检测到的浏览器展开',
  'models.downloadEndpoint': '本地模型的下载来源（镜像的基址，http(s)://）；null 为公共模型仓库，https://www.modelscope.cn 从 ModelScope 下载。环境变量 BAOCUT_MODELS_ENDPOINT 优先',
  'models.dir':
    '本地模型放在哪个文件夹（绝对路径）；null 为数据目录下的 models。环境变量 BAOCUT_MODELS_DIR 优先。用 models.setDir 更改，不能用 settings set',
  'tools.downloadEndpoint':
    '受管外部工具（yt-dlp）的下载来源（镜像的基址，http(s)://，文件在 <基址>/<工具>/<版本>/<文件名>）；null 为官方发布地址。环境变量 BAOCUT_TOOLS_ENDPOINT 优先',
  'models.downloadMirrors':
    "添加的模型仓库镜像（{ name, base } 的列表；base 是 http(s):// 基址，不重复）。只是备选清单，下载按 models.downloadEndpoint",
  'tools.downloadMirrors':
    "添加的发布页镜像（{ name, base } 的列表；base 是 http(s):// 基址，不重复）。只是备选清单，下载按 tools.downloadEndpoint",
  'fonts.autoDownload': '排字用到、本机没有、字体目录里有的字体自动下载（预览与成片导出）；关掉时照回退字体画并提示',
  'fonts.cssEndpoint': '字体 CSS 接口的基址（镜像，https://）；null 为 https://fonts.googleapis.com',
  'fonts.fileEndpoint': '字体文件的基址（镜像，https://，只从它下面取文件）；null 为 https://fonts.gstatic.com',
  'space.trashRetentionDays': 'Space 回收站的保留天数（1–3650）：超过的、没有引用的条目与删除的视频定期物理删除',
  'versions.keep': "每部视频的版本记录保留的未命名版本数（1–100）；保存的版本总是保留。一部视频的版本文件另有 64 MiB 的上限，超过时从最旧的未命名版本删起",
  'versions.cadence': "版本记录何时开新版本：segment 在安静 5 分钟、连续编辑满 30 分钟以及保存、回到版本前后；turn 另在智能体每个回合开始时",
  'cache.maxSizeMiB': '数据目录里缓存的大小上限，MiB（256–1048576）：超过时从最旧的缓存文件（素材分析、播放用的转码）删起，降到上限的 90%。跨视频检索的索引不删',
  'resources.capacity':
    '高级：资源调度用的机器容量 { memoryMiB, gpuMemoryMiB, cpuThreads }，某项为 null 时自动探测；null 为全部自动（内存与 CPU 取自系统，Apple 芯片的 GPU 内存按统一内存估计）',
  'runtime.idleExitMinutes':
    'CLI 拉起的 Runtime 空闲多少分钟后自己退出（1–1440）：没有连接、没有任务、没有开着的对外服务。桌面端退出时留在后台继续的 Runtime 也在任务做完这么久后退出。其余的不受影响',
  'updates.autoCheck': '自动检查应用更新',
  'updates.autoDownload': '有新版本时在后台下载（不自动安装）',
  'diagnostics.enabled': '发送匿名的使用统计与性能摘要（不含媒体、文本与路径）',
  'offline.strict': '严格离线：不向任何在线服务发送内容',
  'semantic.channels': '要建语义索引的通道：text（讲话内容：文稿、字幕、译文、章节）；画面（visual，每 8 秒一张关键帧，要装多模态模型包，建得较慢）；声音（audio）还不可用',
  'semantic.excludedProjects': '不建语义索引的项目（项目 ID 列表）：所有 BaoCut 项目与不属于项目的视频都建，除了这些；它们的视频仍可按字面找到',
  'semantic.folders': '项目之外的索引文件夹（{id, path} 列表）：里面的视频与图片出现在 Space 里、按意思建索引，只读。用 space.folderAdd 与 space.folderRemove 更改',
  'semantic.excludedVideos': '不建语义索引的单个视频（视频 ID 列表），与排除的项目叠加；已建的索引会撤下',
  'semantic.indexDir': '语义索引所在的文件夹（绝对路径）；null 时放在应用缓存里。用 space.indexSetDir 更改，会移动或重新建索引',
  'semantic.pauseOnBattery': '用电池时暂停建语义索引，接上电源后接着建（系统因过热降频时总会暂停）',
  'semantic.translationMemory': '翻译时提示以前译过的几乎相同的句子（需要文字搜索模型）',
  'semantic.glossaryCandidates': '从各份文稿里几乎相同的写法提示术语候选（需要文字搜索模型）',
};
