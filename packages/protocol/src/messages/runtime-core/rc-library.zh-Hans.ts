import type { RcLibraryMessages } from './rc-library.ts';

export const zhHans: RcLibraryMessages = {
  problemSeparator: '；',
  referenceUndecodable: (p) => `参考录音解码不出来：${p.problems}`,
  clonesNotReady: '音色克隆还没有准备好',
  entryHasNoFile: '这个条目没有文件',
  notCopyable: (p) =>
    `${p.library === 'glossaries' ? '术语表' : p.library === 'voices' ? '音色' : '颜色'}不能直接拷进视频：术语表在转写与翻译时选用，音色在合成时选用，颜色在编辑样式时取用`,
  captionItemIdsStyleOnly: 'captionItemIds 只用于字幕样式',
  addFromLibraryLabel: (p) => `从库里加入「${p.name}」`,
  duplicateGlossaries: (p) => `glossaries.${p.step} 里有重复的术语表`,
  tooManyGlossaries: (p) => `每一步最多启用 ${p.max} 张术语表`,
  glossaryWrongStep: (p) =>
    `「${p.name}」是${p.transcription ? '转写' : '翻译'}用术语表，不能用在${p.transcribeStep ? '转写' : '翻译'}`,
  selectionDocumentName: '启用的库条目',
  changeSelectionLabel: '改启用的库条目',
  adoptDefaultsLabel: '采用用户库里默认启用的条目',
  noDocumentIdAfterWrite: '写入之后没有拿到文档 ID',
  speakerBoundTwice: (p) => `说话人 ${p.speakerId} 绑定了两次`,
  noSuchDocument: (p) => `视频里没有文档 ${p.documentId}`,
  documentNotSpeech: (p) => `文档 ${p.documentId} 是 ${p.kind}，说话人只在转写（speech）里`,
  speakerNotInTranscript: (p) => `转写 ${p.documentId} 里没有说话人 ${p.speakerId}`,
  libraryVoiceNoProvider: '库里的音色按配音选的 Provider 换成克隆：不给 providerId',
  outputNotFound: '产物不存在',
  pathNotAbsolute: '文件路径要是绝对路径',

  serviceClientNoLibraryVoice: '对外服务的客户端不能使用用户库里的音色',
  clonerNotConfigured: (p) => `${p.label} 没有启用或没有密钥，不能克隆音色`,
  cloneExists: (p) => `音色「${p.name}」在 ${p.label} 上已经有有效的克隆`,
  clonePurpose: (p) => `克隆音色「${p.name}」`,
  noClone: '这个音色在这个 Provider 上没有克隆',
  remoteCloneNotDeleted: (p) => `${p.label} 上的克隆没有删掉，记录保留：${p.reason}`,
  cloneUnsupported: (p) => `${p.providerId} 没有音色克隆接口（目前只有 ElevenLabs 提供）`,
  cloneVersionGone: '要克隆的音色版本已经不在了',
  oldCloneNotDeleted: (p) => `替换下来的旧克隆（${p.voiceId}）没有从 ${p.label} 删掉：${p.reason}`,
};
