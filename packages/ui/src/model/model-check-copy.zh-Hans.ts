import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = {
  transcribe: '模型能运行，但识别不出样本里的话',
  synthesize: '模型能运行，但合成出来的声音不对',
  image: '模型能运行，但画出来的图不对',
  separate: '模型能运行，但人声和背景没分开',
};

const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
  APP_FILE_MISSING: () => ({
    text: 'BaoCut 自带的一个文件不见了，不是模型的问题',
    todo: '重新安装 BaoCut 可以解决，已下载的模型不受影响。',
  }),
  MODEL_FILES_DAMAGED: () => ({ text: '模型文件损坏了', todo: '修复会重新下载坏掉的文件。' }),
  MODEL_OUTPUT_WRONG: (subject) => ({
    text: outputWrong[subject],
    todo: '先修复；修复后还是这样，复制技术详情发给我们。',
  }),
  MODEL_OUT_OF_MEMORY: () => ({ text: '内存不够，模型没能加载', todo: '关掉别的大模型或占内存的应用，再检查一次。' }),
  MODEL_WORKER_FAILED: () => ({
    text: '运行模型的后台进程出错了',
    todo: '再检查一次；一直这样就重启 BaoCut，或复制技术详情发给我们。',
  }),
};

/** 试用的失败：`verb` 是「合成」或「画」，`noun` 是「试听」或「试画」。 */
function trySubject(verb: string, noun: string, noMemoryTodo: string): TrySubject {
  return {
    noMemory: { text: `内存不够，没${verb}完`, todo: noMemoryTodo },
    modelError: { text: `模型出错了，没${verb}出来`, todo: '检查一下模型，看看是哪里出了问题。' },
    other: (message) => ({ text: `没${verb}出来：${message}`, todo: '可以重试；一直这样就到后台任务里看看详情。' }),
    notStarted: (message) => ({ text: `没能开始${verb}：${message}`, todo: '' }),
    noticeTodo: (todo) => `${todo}现在${noun}多半也会失败。`,
  };
}

export const zhHans: ModelCheckMessages = {
  label: {
    check: '检查',
    checkFull: '检查模型',
    recheck: '重新检查',
    repair: '修复…',
    repairSub: '只重新下载坏掉的文件',
    details: '技术详情',
    hideDetails: '收起技术详情',
    copy: '复制技术详情',
    copied: '已复制技术详情',
    copyFailed: '没能复制，选中上面的文字手动复制',
    cancel: '取消',
    retry: '重试',
    pickRef: '换一段录音…',
    useSample: '用示例录音',
  },
  caption: '检查会确认模型能正常使用；修复只重新下载坏掉的文件。删除时，别的模型还在用的公共组件会保留。',
  head: {
    running: '检查中…',
    repairing: '修复中…',
    failed: '检查没通过：',
    notStarted: '检查没能开始：',
  },
  sentence: (text) => `${text}。`,
  phase: {
    queued: '排队中',
    loading: '加载模型',
    running: '试跑一小段样本',
    verifying: '核对结果',
    repairing: '重新下载坏掉的文件，修好后自动再检查一次',
  },
  checkSentences,
  unknown: {
    text: '模型没能正常工作',
    todo: '再检查一次；一直这样就复制技术详情发给我们。',
  },
  notStarted: {
    RUNTIME_UNREACHABLE: { text: 'BaoCut 的后台服务没有响应', todo: '稍后再检查一次；一直这样就重启 BaoCut。' },
    MODEL_IN_USE: { text: '这只模型正在被别的任务使用', todo: '等那个任务结束，或在后台任务里取消它，再检查。' },
    MODEL_UNAVAILABLE: { text: '这只模型现在用不了', todo: '先修复它，或重新启用后再检查。' },
    RESOURCE_ADMISSION_UNSATISFIABLE: { text: '这台电脑的内存不够跑这只模型', todo: '换一只小一点的模型。' },
    WEB_METHOD_NOT_ALLOWED: { text: '浏览器里不能检查本地模型', todo: '在桌面应用里检查。' },
    OFFLINE_STRICT: { text: '严格离线模式开着', todo: '在设置里关掉严格离线后再检查。' },
  },
  notStartedUnknown: {
    text: 'BaoCut 没有接受这次检查',
    todo: '稍后再检查一次；一直这样就复制技术详情发给我们。',
  },
  detail: {
    code: (code) => `代码 ${code}`,
    model: (id, when) => `模型 ${id} · ${when}`,
    message: (message) => `说明 ${message}`,
    passed: (when) => `${when}检查通过`,
  },
  noticeText: (what) => `这只模型上次检查没通过：${what}`,
  refUnreadable: (file) => ({
    text: `读不出你的录音「${file}」，文件可能损坏，或者不是音频`,
    todo: '换一段录音再试，或先用示例录音听听效果。',
  }),
  refUnknown: '录音',
  trySpeech: trySubject('合成', '试听', '关掉别的大模型或占内存的应用后重试。'),
  tryImage: trySubject('画', '试画', '关掉别的大模型后重试，或把步数调低。'),
};
