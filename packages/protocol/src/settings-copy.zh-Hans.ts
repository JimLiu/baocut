import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const zhHans: SettingDescriptionMessages = {
  'agent.defaultDriver': '新会话用的智能体引擎；null 为内置默认（codex）。会话创建时冻结',
  'agent.defaultModel': '新会话的模型；null 用推荐模型（Claude Code 用 Sonnet，Codex 用 -sol 那一档），__agent-default__ 不传模型，按 Agent 自己命令行的配置',
  'agent.defaultEffort': '新会话的推理强度；null 为引擎自己的默认值',
  'agent.defaultAccessMode':
    '没有切换过访问模式的会话用它：ask、autoAcceptEdits、auto、fullAccess 或 plan（旧值 controlled、authorized 分别按 ask、fullAccess 处理）',
  'ui.language': `界面语言：system 跟随系统（没有对应的语言时英文），或语言代码（${LOCALES.join('、')}）。Runtime 给人看的文字也按它生成`,
  'captions.maxLineLength': '自动断行的目标行长（字符数）：cjk 为中日韩文字，other 为其余文字',
  'transcribe.afterComplete': '转写完成后：open-video 打开视频，notify 只通知，nothing 什么都不做',
  'downloads.directory':
    '默认保存位置：工具没有视频的结果、从链接下载的媒体与 downloads_save 交出的文件都放这里（绝对路径）；null 使用当前主机的 ~/Downloads，与项目归属无关',
  'models.downloadEndpoint': '本地模型的下载来源（镜像的基址，http(s)://）；null 为公共模型仓库。环境变量 BAOCUT_MODELS_ENDPOINT 优先',
  'models.dir':
    '本地模型放在哪个文件夹（绝对路径）；null 为数据目录下的 models。环境变量 BAOCUT_MODELS_DIR 优先。用 models.setDir 更改，不能用 settings set',
  'tools.downloadEndpoint':
    '受管外部工具（yt-dlp）的下载来源（镜像的基址，http(s)://，文件在 <基址>/<工具>/<版本>/<文件名>）；null 为官方发布地址。环境变量 BAOCUT_TOOLS_ENDPOINT 优先',
  'fonts.autoDownload': '排字用到、本机没有、字体目录里有的字体自动下载（预览与成片导出）；关掉时照回退字体画并提示',
  'fonts.cssEndpoint': '字体 CSS 接口的基址（镜像，https://）；null 为 https://fonts.googleapis.com',
  'fonts.fileEndpoint': '字体文件的基址（镜像，https://，只从它下面取文件）；null 为 https://fonts.gstatic.com',
  'space.trashRetentionDays': 'Space 回收站的保留天数（1–3650）：超过的、没有引用的条目与删除的视频定期物理删除',
  'resources.capacity':
    '高级：资源调度用的机器容量 { memoryMiB, gpuMemoryMiB, cpuThreads }，某项为 null 时自动探测；null 为全部自动（内存与 CPU 取自系统，Apple 芯片的 GPU 内存按统一内存估计）',
  'runtime.idleExitMinutes':
    'CLI 拉起的 Runtime 空闲多少分钟后自己退出（1–1440）：没有连接、没有任务、没有开着的对外服务。桌面端与手动启动的不受影响',
  'updates.autoCheck': '自动检查应用更新',
  'updates.autoDownload': '有新版本时在后台下载（不自动安装）',
  'diagnostics.enabled': '发送匿名的使用统计与性能摘要（不含媒体、文本与路径）',
  'offline.strict': '严格离线：不向任何在线服务发送内容',
};
