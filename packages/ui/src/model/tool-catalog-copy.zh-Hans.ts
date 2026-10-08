import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: '音频', image: '图片', doc: '文档', final: '视频文件', subtitle: '字幕' };

export const zhHans: ToolCatalogMessages = {
  inputLabels: {
    file: '本机文件',
    space: 'Space',
    link: '链接',
    text: '文字',
    video: 'Space 里的视频',
    document: '文档',
  },
  outputLabels: { video: '视频', artifact: 'Space 里的条目' },
  artifactLabels,
  tools: {
    transcribe: { name: '转录', desc: '把视频或音频转成一份文稿和一份字幕；选可编辑的视频时写进它，并建立字幕层' },
    'translate-subtitles': { name: '翻译字幕', desc: '把字幕翻译成另一种语言；选转录过的视频时新增译文与字幕层，可以双语显示，原文不动' },
    dub: { name: '翻译配音', desc: '用译文给转录过的视频配一组新的声音，原声可以压低、静音或保留' },
    'synthesize-speech': { name: '生成语音', desc: '把文字或 Space 里的文档、字幕念出来；可选预设音色、克隆一段录音或描述一个声音' },
    'generate-text': { name: '文本生成', desc: '输入要求，直接调用文本模型生成文案、脚本或摘要；可以附上 Space 里的文档或字幕作为材料' },
    'generate-image': { name: '生成图片', desc: '写一句描述，用云端或本机图像模型画一张图；可带参考图、选画幅与张数' },
    'link-import': { name: '下载视频', desc: '粘贴链接，下载视频到本机；可使用浏览器 Cookie，下载后可转录成文稿和字幕' },
    'compress-video': { name: '压缩视频', desc: '按目标体积或画质重新编码，发消息、传网盘前先压一压' },
    'merge-video': { name: '合并视频', desc: '把几段视频按顺序首尾接成一个文件' },
    'extract-audio': { name: '提取音频', desc: '去掉画面，只留音轨；常见的音频编码原样复制，不重新编码' },
  },
  targetNone: '只生成文稿和字幕',
  targetCreate: '新建视频并放进项目',
  subtitleFile: '本机字幕文件',
  groups: {
    speech: {
      label: '语音与字幕',
      desc: '转录、翻译字幕与配音、把文字念出来。结果是文档、字幕与音频条目；选 Space 里可编辑的视频时写进它。',
    },
    'text-image': { label: '文字与图片', desc: '直接调用文本模型与图像模型。结果是文档与图片条目。' },
    'video-file': {
      label: '视频文件',
      desc: '下载、压缩、合并视频与提取音频，用本机的 yt-dlp 与 ffmpeg。结果是视频文件与音频条目。',
    },
  },
  artifactItems: (artifacts) => `${artifacts.map((a) => artifactLabels[a]).join('与') || '产物'}条目`,
  resultWritesVideo: '结果：写进你选的视频',
  resultInSpace: (items) => `结果：Space 里的${items}`,
  resultAlsoCreate: '也可以新建视频',
  resultWritesEditable: '选可编辑的视频时写进它',
  joinResult: (parts) => parts.join('；'),
};
