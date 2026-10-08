import type { RcModelsMessages } from './rc-models.ts';

export const zhHans: RcModelsMessages = {
  offlineStrict: '严格离线模式下不下载模型',
  sizeChanged: '要下载的字节数变了，请按新的计划重新确认',
  bundleInUse: '模型包正在使用：等任务结束或取消之后再删除',
  diarizationNoCheck: '说话人区分模型包没有单独的检查：用识别模型包转写时一起用上',
  bundleUnavailable: '模型包现在不可用',
  installFailed: '安装模型时出错',
  noSuchBundle: (p) => `没有这个模型包：${p.bundleId}`,
  movingDirWait: '正在移动模型目录：等它结束之后再做',
  dirMissing: '模型目录不存在（外置盘没有接上时也会这样）：接好后再试，或在设置里换一个模型目录',
  selfTestSampleLabel: '识别检查的样本',

  workerFailed: (p) => `Worker 失败：${p.reason}`,
  workerCancelledCheck: 'Worker 自己取消了检查',
  noWorkerOutput: 'Worker 没有给出输出',
  outputMissing: '输出文件不存在',
  outputMismatch: '输出文件的长度或 sha256 与 Worker 的响应不符',
  namedOutputMissing: (p) => `输出文件 ${p.file} 不存在`,
  namedOutputMismatch: (p) => `${p.file} 的长度或 sha256 与 Worker 的响应不符`,
  outputNotJson: '输出不是合法的 JSON',
  outputNotAsrResult: '输出不合 asr-result 合同',
  transcriptMissingExpected: (p) => `识别结果不含「${p.expected}」`,
  separationPassed: (p) => `${p.duration} 秒 · ${p.sampleRate} Hz · 人声比背景高 ${p.finite ? `${p.ratio} dB` : '很多'}`,
  speechPassed: (p) => `${p.duration} 秒 · ${p.sampleRate} Hz`,
  imagePassed: (p) => `${p.width}×${p.height} · ${p.steps} 步`,

  envLocked: '模型目录由环境变量 BAOCUT_MODELS_DIR 指定：要改请改环境变量并重启 BaoCut',
  movingDirWaitOrCancel: '正在移动模型目录：等它结束或取消之后再改',
  folderMissing: '这个文件夹不存在（外置盘没有接上时也会这样）',
  folderNotWritable: 'BaoCut 没有这个文件夹的写入权限',
  dirNested: '新位置与当前的模型目录互相包含：换一个不在它里面、也不包含它的文件夹',
  noSpaceForMove: '新位置所在的磁盘放不下要移动的模型',
  noSpaceRemedy: '清理出空间，换一个位置，或选「只切换位置」',
  dirInUse: '有任务在用本地模型：等它们结束或取消之后再改模型目录',
  sourceKept: (p) => `原目录里有 ${p.count} 个仓库没能删掉，可以手动删除`,
  moveNoSpace: '新位置的磁盘写满了，已回滚',
  moveFailed: '移动模型时出错，已回滚',
  moveFailedRemedy: '原来的模型目录没有变化，模型照常可用',

  noAlignableFormat: (p) => `模型 ${p.modelId} 不输出可以对齐的音频格式`,
  synthOutputCount: (p) => `合成的输出有 ${p.count} 个，应为 1 个`,
  synthOutputOutsideStaging: '合成的输出不在 staging 目录里',
  dubGrantHint: (p) =>
    `配音要把文字稿（译文，缺译文时还有原文）交给 ${p.recipient}：服务商启用时的默认授权不含文字稿，` +
    '要用户明确发放一条授权（下面的命令，或在 BaoCut 的设置里），之后重新执行这次配音。',
  voiceRemoved: (p) => `${p.reason}：音色 ${p.voice}`,

  notSpeakersJob: '这个任务不是识别说话人',
  jobNotForVideo: '这次识别不属于这个视频',
  speakersNotDone: '识别说话人还没有完成',
  speakersCleaned: '识别结果已经清理：重新识别说话人',

  recoveryPrincipalName: '任务恢复',
};
