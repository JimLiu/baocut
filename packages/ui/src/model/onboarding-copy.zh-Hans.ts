import type { OnboardingMessages } from './onboarding-copy.ts';

export const zhHans: OnboardingMessages = {
  dialogLabel: '欢迎使用 BaoCut',
  stepsLabel: '引导步骤',
  step: {
    agent: '连接 Agent',
    asr: '语音识别',
    tts: '语音合成',
    semantic: '语义搜索',
    image: '图像生成',
    music: '音乐生成',
  },
  title: {
    agent: '欢迎使用 BaoCut',
    asr: '下载语音识别模型',
    tts: '下载语音合成模型',
    semantic: '安装语义搜索',
    image: '下载图像生成模型',
    music: '下载音乐生成模型',
  },
  lead: {
    agent: '说出想做的视频，Agent 帮你转录、加字幕、翻译、配音和剪辑。BaoCut 调用这台电脑上的 Agent（比如 Claude Code、Codex），用你自己的账号，不另外收费。',
    asr: '转录、加字幕和剪口播，都要先把说的话转成文字。模型装在这台电脑上，不联网也能用。',
    tts: '语音合成模型能把文字念出来、用一段录音克隆声音，也能给视频翻译配音。挑一两只先下，其余以后在 设置 › 语音合成 里下。',
    semantic: '按意思找讲话内容和画面：Space 搜索、写作按主题选材、配画面、翻译记忆都用它。装好后在后台给已有的视频建索引。',
    image: '在本机按一句话生成图片，做封面、配图都行。模型很大，生成也慢。',
    music: '在本机按风格或歌词生成配乐和歌曲，结果可以直接加到视频的音乐轨。生成很慢，30 秒约要几分钟。',
  },
  where: {
    tts: {
      title: '在 工具 › 生成语音 里用',
      body: '写一段文字，或选 Space 里的文档、字幕，挑模型和音色就能生成。没装的模型在那里也能下载。',
    },
    image: { title: '在 工具 › 生成图片 里用', body: '写一句描述就能出图；Agent 做封面时也会用它。' },
    music: { title: '在 工具 › 生成音乐 里用', body: '选风格、写歌词，生成的音乐存进 Space，可以加到视频里。' },
  },
  diarizes: '转录同时区分说话人',
  needsDiarization: (pack) => `要区分说话人，另装「${pack}」`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 个预设音色 · 可用一句话指定风格',
    'qwen3-tts-0.6b-base': '用 3 秒参考录音克隆声音',
    voxcpm2: '参考录音克隆 · 可写风格 · 30 种语言与粤语',
    'qwen-image-2.1-turbo': '蒸馏版 · 固定 8 步 · 比基础版快 2 倍多',
    'qwen-image-2.1': '基础版 · 步数多，较慢',
    'yue2-3b': '按风格或歌词生成 · 30 秒约要几分钟',
  },
  recommended: '推荐',
  installed: '已安装',
  missingParts: '缺组件',
  planLine: (parts) => `一起下载：${parts}`,
  downloading: (name) => `正在下载 ${name}`,
  inBackground: '在后台下载',
  bgNote: '下载前会先列出来源和存放位置，确认后才开始；下载在后台进行，不用等下完。',
  asrAlt: '不想下载？也可以以后在 设置 › API 提供方 里添加云端识别。',
  unsupported: '这台电脑跑不了这类模型，这一步可以直接跳过。',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: '这台电脑上的 Agent',
  agentChecking: '正在检测这台电脑上的 Agent…',
  agentMissingBody: '勾上想用的，BaoCut 在后台安装；装好后用你已有的账号登录一次就能用。',
  agentNote: '勾上的都会出现在新会话的 Agent 菜单里；安装在后台进行，不用等装完。默认用哪一个、装更多，在 设置 › Agent 提供方 里改。',
  agentInstalled: '本机已安装',
  agentFix: (problem) => `${problem} · 在 设置 › Agent 提供方 里处理`,
  agentManual: '只能在终端里按官方说明安装 · 说明在 设置 › Agent 提供方',
  agentNotInstalled: (plan) => (plan ? `未安装 · 装好后用你已有的${plan}登录` : '未安装'),
  agentWillInstall: (method, command, login) => `用 ${method} 在后台安装（${command}）· 装好后在终端里运行 ${login} 登录`,
  agentInstalling: (method, login) => `正在用 ${method} 在后台安装 · 装好后在终端里运行 ${login} 登录`,
  agentInstallingLabel: (name) => `正在安装 ${name}`,
  agentInstallFailed: '没装成 · 详情在后台任务里',

  next: '下一步',
  finish: '完成',
  skip: '跳过',
  exit: '退出引导',
  install: (n) => `后台安装 ${n} 个并继续`,
  download: (size, last) => `后台下载${size ? ` ${size} ` : ''}并${last ? '完成' : '继续'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return `后台在${kind === 'install' ? '安装' : kind === 'download' ? '下载' : '下载和安装'} ${name}${tail}`;
    },
    many: (kind, n) => `后台在${kind === 'install' ? '安装' : kind === 'download' ? '下载' : '下载和安装'} ${n} 个`,
    idle: (kind) => `后台${kind === 'install' ? '安装' : kind === 'download' ? '下载' : '下载和安装'}`,
    done: (kind, n) => `${n} 个${kind === 'install' ? '已装好' : kind === 'download' ? '已下完' : '已完成'}`,
    failed: (kind, n) => `${n} 个${kind === 'install' ? '没装成' : kind === 'download' ? '没下成' : '没成功'}`,
  },
  closedToast: (models, agents) => {
    const parts = [...(models ? [`${models} 个模型在后台下载`] : []), ...(agents ? [`${agents} 个 Agent 在后台安装`] : [])];
    return `${parts.join('，')}，完成后就能用`;
  },
  viewTasks: '查看后台任务',
};
