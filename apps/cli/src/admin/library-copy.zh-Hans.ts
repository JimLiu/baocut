import type { LibraryMessages } from './library-copy.ts';

export const zhHans: LibraryMessages = {
  help: `用法：
  baocut library import <文件>     导入交换文件，按内容识别类型（不看扩展名）：术语表 Markdown、音色包 .bcvoice、
                                   品牌库的颜色与字幕样式 JSON、Lottie 贴纸、图片、视频、字体
  baocut library export <库> <id> <路径>
                                   导出当前版本：术语表为 Markdown，音色为 .bcvoice，品牌素材为原文件；目标已存在时不覆盖
  baocut library remove <库> <id>  删除一个条目（已经拷进视频的内容不受影响）
  baocut library voice-clone <音色 id> --provider <id> [--name <名字>]
                                   把音色的参考录音上传给 Provider 建克隆（目前只有 elevenlabs）：要有授权声明，
                                   以及覆盖「audio」的数据外发授权（baocut grants create）；作为任务跑，Ctrl-C 取消
  baocut library voice-clone-remove <音色 id> --provider <id> [--local-only]
                                   删除克隆：先请求远端删除，成功后清掉记录；--local-only 只清本地记录
  baocut library video-selection <视频 id> [选项]
                                   视频里启用的库条目（记在视频里，能撤销）：不给选项时显示；给了的部分整体替换，没给的照旧。
                                   新视频自动启用库里标了「默认启用」的术语表
    --transcribe-glossaries <id,…> 转写用术语表（转写没指定术语表时用）；空字符串清空
    --translate-glossaries <id,…>  翻译用术语表（translate 与 dub 的翻译都用）；空字符串清空
    --speaker-voice <转写 id>:<说话人>=<音色>[@<Provider>]
                                   说话人的音色（可重复，整体替换）：library:<id> 或 Provider 的音色 ID（这时带 @Provider）
    --clear-speaker-voices         清空说话人的音色`,
  importUsage: '用法：baocut library import <文件>',
  exportUsage: '用法：baocut library export <glossaries|voices|brand> <id> <路径>',
  removeUsage: '用法：baocut library remove <glossaries|voices|brand> <id>',
  voiceCloneUsage: '用法：baocut library voice-clone <音色 id> --provider <id> [--name <名字>]',
  voiceCloneRemoveUsage: '用法：baocut library voice-clone-remove <音色 id> --provider <id> [--local-only]',
  videoSelectionUsage: '用法：baocut library video-selection <视频 id> [--translate-glossaries <id,…>] [--speaker-voice …]…',
  imported: (label, id, name) => `已导入到${label}：${id}  ${name}`,
  exported: (id, version, file, bytes) => `已导出 ${id} 版本 ${version} 到 ${file}（${bytes} 字节）`,
  deleted: (id) => `已删除 ${id}`,
  remoteCloneOutcome: { deleted: '远端已删除', 'not-found': '远端已经没有这个音色', skipped: '没有请求远端' },
  voiceCloneRemoved: (id, provider, remote) => `已删除 ${id} 在 ${provider} 上的克隆（${remote}）`,
  libraryLabels: { glossaries: '术语表', voices: '音色', brand: '品牌库' },
  unknownLibrary: (text) => `没有这个库：${text ?? '（缺少）'}。可用的是 glossaries、voices、brand`,
  speakerVoiceFormat: (text) => `--speaker-voice 的格式是 <转写 id>:<说话人>=<音色>[@<Provider>]，收到 ${text}`,
  listSep: ', ',
  none: '（无）',
  selectionHead: (videoId, documentId, revision) =>
    `视频 ${videoId}${documentId ? `（library-selection 文档 ${documentId} 版本 ${revision}）` : '（还没有启用的条目）'}`,
  transcribeGlossaries: (list) => `转写用术语表：${list}`,
  translateGlossaries: (list) => `翻译用术语表：${list}`,
  speakerVoicesNone: '说话人的音色：（无）',
  speakerVoice: (documentId, speakerId, voice, providerId) =>
    `说话人的音色：${documentId}:${speakerId} = ${voice}${providerId ? `（只在 ${providerId} 上）` : ''}`,
};
