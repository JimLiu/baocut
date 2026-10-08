import { defineMessages, live, type ModelCheckCode } from '@baocut/protocol';
import { zhHans } from './model-check-copy.zh-Hans.ts';
import { zhHant } from './model-check-copy.zh-Hant.ts';
import { ja } from './model-check-copy.ja.ts';
import { ko } from './model-check-copy.ko.ts';
import { es } from './model-check-copy.es.ts';
import { fr } from './model-check-copy.fr.ts';
import { de } from './model-check-copy.de.ts';
import { nl } from './model-check-copy.nl.ts';
import { ptBR } from './model-check-copy.pt-BR.ts';
import { it } from './model-check-copy.it.ts';
import { ru } from './model-check-copy.ru.ts';
import { pl } from './model-check-copy.pl.ts';
import { tr } from './model-check-copy.tr.ts';
import { vi } from './model-check-copy.vi.ts';

/**
 * 本地模型的「检查」与试用（试听）失败的说法（设计稿 model-local-check.js）：检查代码 → 一句哪里不对 + 怎么办。
 * 代码与技术细节只进「技术详情」，正文不放代码。修复帮不帮得上不在这里判断，由 `@baocut/protocol` 的 `modelCheckRepair` 决定。
 * 英文是键与类型的来源，译文在 `model-check-copy.<语言>.ts`；读当前语言要在调用时读。
 */

/** 能力的种类：识别与分离（没有试用）、合成（试听）与生图。「不对」长什么样各说各的。 */
export type CheckSubject = 'transcribe' | 'synthesize' | 'image' | 'separate';

export interface CheckSentence {
  text: string;
  todo: string;
}

/**
 * 试用说的是哪一件：语音合成是「试听」，图像生成是「试画」（设计稿 model-local-check.js `TRY`、`tryFailure`）。
 * 各语言把整句写全，不在调用处拼动词与名词。
 */
export interface TrySubject {
  /** 内存不够，没做完。 */
  noMemory: CheckSentence;
  /** 模型出错，没做出来。 */
  modelError: CheckSentence;
  /** 别的失败：Runtime 的原话。 */
  other: (message: string) => CheckSentence;
  /** 没能开始：Runtime 的原话；没有「怎么办」（`todo` 为空）。 */
  notStarted: (message: string) => CheckSentence;
  /** 试用面板开头的提醒的第二句：上次检查的「怎么办」后接「现在试听多半也会失败」。 */
  noticeTodo: (todo: string) => string;
}

const outputWrong: Record<CheckSubject, string> = {
  transcribe: "The model runs, but it can't recognize the speech in the sample",
  synthesize: "The model runs, but the voice it produces isn't right",
  image: "The model runs, but the image it draws isn't right",
  separate: "The model runs, but it didn't separate the voice from the background",
};

const checkSentences = {
  APP_FILE_MISSING: () => ({
    text: "A file that comes with BaoCut is missing; it's not a problem with the model",
    todo: "Reinstalling BaoCut fixes this. Models you've already downloaded aren't affected.",
  }),
  MODEL_FILES_DAMAGED: () => ({ text: 'The model files are damaged', todo: 'Repair downloads the damaged files again.' }),
  MODEL_OUTPUT_WRONG: (subject: CheckSubject) => ({
    text: outputWrong[subject],
    todo: 'Repair it first. If it still happens after repairing, copy the technical details and send them to us.',
  }),
  MODEL_OUT_OF_MEMORY: () => ({
    text: "Not enough memory, so the model couldn't load",
    todo: 'Close other large models or memory-heavy apps, then check again.',
  }),
  MODEL_WORKER_FAILED: () => ({
    text: 'The background process that runs the model ran into an error',
    todo: 'Check again. If it keeps happening, restart BaoCut, or copy the technical details and send them to us.',
  }),
} satisfies Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence>;

const en = {
  /** 按钮与标题。 */
  label: {
    check: 'Check',
    checkFull: 'Check model',
    recheck: 'Check again',
    repair: 'Repair…',
    repairSub: 'Only downloads the damaged files again',
    details: 'Technical details',
    hideDetails: 'Hide technical details',
    copy: 'Copy technical details',
    copied: 'Technical details copied',
    copyFailed: "Couldn't copy. Select the text above and copy it yourself.",
    cancel: 'Cancel',
    retry: 'Try again',
    pickRef: 'Choose another recording…',
    useSample: 'Use sample recording',
  },
  /** 已安装列表上方那句：检查和修复各做什么；第二句是删除的规矩。 */
  caption:
    'Check confirms a model works; Repair only downloads the damaged files again. When you delete a model, shared components that other models still use are kept.',
  head: {
    running: 'Checking…',
    repairing: 'Repairing…',
    failed: 'Check failed:',
    notStarted: "Check couldn't start:",
  },
  /** 「哪里不对」后面接「怎么办」时的句号。 */
  sentence: (text: string) => `${text}.`,
  phase: {
    queued: 'Queued',
    loading: 'Loading the model',
    running: 'Running a short sample',
    verifying: 'Verifying the result',
    repairing: 'Downloading the damaged files again; it checks again automatically once fixed',
  },
  /** 检查没通过：认得的代码各一句。 */
  checkSentences: checkSentences as Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence>,
  /** 认不得的代码（旧记录、新版 Runtime 加的）：通用的一句，Runtime 的原话放进技术详情。 */
  unknown: {
    text: "The model didn't work properly",
    todo: 'Check again. If it keeps happening, copy the technical details and send them to us.',
  } as CheckSentence,
  /** 检查没能开始（提交被拒）：`details.code` → 一句。 */
  notStarted: {
    RUNTIME_UNREACHABLE: {
      text: "BaoCut's background service isn't responding",
      todo: 'Check again later. If it keeps happening, restart BaoCut.',
    },
    MODEL_IN_USE: {
      text: 'Another task is using this model',
      todo: 'Wait for that task to finish, or cancel it in Background tasks, then check again.',
    },
    MODEL_UNAVAILABLE: { text: "This model can't be used right now", todo: 'Repair it first, or turn it back on, then check again.' },
    RESOURCE_ADMISSION_UNSATISFIABLE: {
      text: "This computer doesn't have enough memory to run this model",
      todo: 'Switch to a smaller model.',
    },
    WEB_METHOD_NOT_ALLOWED: { text: "Local models can't be checked in the browser", todo: 'Check it in the desktop app.' },
    OFFLINE_STRICT: { text: 'Strict offline mode is on', todo: 'Turn off strict offline mode in Settings, then check again.' },
  } as Record<string, CheckSentence>,
  notStartedUnknown: {
    text: "BaoCut didn't accept this check",
    todo: 'Check again later. If it keeps happening, copy the technical details and send them to us.',
  } as CheckSentence,
  /** 技术详情的几行。 */
  detail: {
    code: (code: string) => `Code ${code}`,
    model: (id: string, when: string) => `Model ${id} · ${when}`,
    message: (message: string) => `Message ${message}`,
    passed: (when: string) => `Check passed · ${when}`,
  },
  /** 试用面板开头的提醒：上次检查没通过。 */
  noticeText: (what: string) => `This model failed its last check: ${what}`,
  /** 读不出用户给的参考录音。 */
  refUnreadable: (file: string) => ({
    text: `Couldn't read your recording "${file}". The file may be damaged, or it isn't audio`,
    todo: 'Try another recording, or hear how it sounds with the sample recording first.',
  }),
  refUnknown: 'recording',
  /** 语音合成的试听。 */
  trySpeech: {
    noMemory: {
      text: 'Not enough memory to finish synthesizing',
      todo: 'Close other large models or memory-heavy apps, then try again.',
    },
    modelError: { text: 'The model ran into an error and produced no audio', todo: 'Check the model to see what went wrong.' },
    other: (message: string) => ({
      text: `Couldn't synthesize: ${message}`,
      todo: 'You can try again. If it keeps happening, look at the details in Background tasks.',
    }),
    notStarted: (message: string) => ({ text: `Couldn't start synthesizing: ${message}`, todo: '' }),
    noticeTodo: (todo: string) => `${todo} A preview now will most likely fail too.`,
  } as TrySubject,
  /** 图像生成的试画。 */
  tryImage: {
    noMemory: {
      text: 'Not enough memory to finish drawing',
      todo: 'Close other large models and try again, or lower the steps.',
    },
    modelError: { text: 'The model ran into an error and drew nothing', todo: 'Check the model to see what went wrong.' },
    other: (message: string) => ({
      text: `Couldn't draw: ${message}`,
      todo: 'You can try again. If it keeps happening, look at the details in Background tasks.',
    }),
    notStarted: (message: string) => ({ text: `Couldn't start drawing: ${message}`, todo: '' }),
    noticeTodo: (todo: string) => `${todo} A test drawing now will most likely fail too.`,
  } as TrySubject,
};

export type ModelCheckMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 按钮与标题。 */
export const CHECK_LABEL: ModelCheckMessages['label'] = live(() => M.label);

/** 已安装列表上方那句：检查和修复各做什么；第二句是删除的规矩。 */
export const checkCaption = (): string => M.caption;

export const CHECK_HEAD: ModelCheckMessages['head'] = live(() => M.head);

/** 「哪里不对」后面接「怎么办」时的句号。 */
export const sentence = (text: string): string => M.sentence(text);

export const CHECK_PHASE: ModelCheckMessages['phase'] = live(() => M.phase);

/** 检查没通过：认得的代码各一句。 */
export const CHECK_SENTENCES: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = live(() => M.checkSentences);

/** 认不得的代码（旧记录、新版 Runtime 加的）：通用的一句，Runtime 的原话放进技术详情。 */
export const CHECK_UNKNOWN: CheckSentence = live(() => M.unknown);

/** 检查没能开始（提交被拒）：`details.code` → 一句。 */
export const CHECK_NOT_STARTED: Record<string, CheckSentence> = live(() => M.notStarted);

export const CHECK_NOT_STARTED_UNKNOWN: CheckSentence = live(() => M.notStartedUnknown);

/** 技术详情的几行。 */
export const CHECK_DETAIL: ModelCheckMessages['detail'] = live(() => M.detail);

/** 试用面板开头的提醒：上次检查没通过。第二句随试用的种类（`TrySubject.noticeTodo`）。 */
export const TRY_NOTICE = {
  text: (what: string) => M.noticeText(what),
};

/** 试用（试听、试画）共有的失败；随种类变的说法在 `TrySubject` 里。 */
export const TRY_FAILURE = {
  refUnreadable: (file: string): CheckSentence => M.refUnreadable(file),
  get refUnknown(): string {
    return M.refUnknown;
  },
  get appFileMissing(): CheckSentence {
    return M.checkSentences.APP_FILE_MISSING('synthesize');
  },
};

export const TRY_SUBJECT: TrySubject = live(() => M.trySpeech);
export const TRY_SUBJECT_IMAGE: TrySubject = live(() => M.tryImage);
