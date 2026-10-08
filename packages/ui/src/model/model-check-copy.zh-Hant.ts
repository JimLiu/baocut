import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = {
  transcribe: '模型可以執行，但無法辨識範例中的語音',
  synthesize: '模型可以執行，但合成出的聲音不正確',
  image: '模型可以執行，但繪製出的圖片不正確',
  separate: '模型可以執行，但沒有把人聲和背景分開',
};

const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
  APP_FILE_MISSING: () => ({
    text: 'BaoCut 內建的一個檔案遺失了，並不是模型的問題',
    todo: '重新安裝 BaoCut 即可解決，已下載的模型不受影響。',
  }),
  MODEL_FILES_DAMAGED: () => ({ text: '模型檔案已損壞', todo: '修復會重新下載損壞的檔案。' }),
  MODEL_OUTPUT_WRONG: (subject) => ({
    text: outputWrong[subject],
    todo: '請先修復；修復後仍然如此，請複製技術詳細資訊並傳送給我們。',
  }),
  MODEL_OUT_OF_MEMORY: () => ({ text: '記憶體不足，無法載入模型', todo: '請關閉其他大型模型或佔用記憶體的應用程式，再檢查一次。' }),
  MODEL_WORKER_FAILED: () => ({
    text: '執行模型的背景程序發生錯誤',
    todo: '請再檢查一次；如果持續發生，請重新啟動 BaoCut，或複製技術詳細資訊並傳送給我們。',
  }),
};

function trySubject(verb: string, noun: string, noMemoryTodo: string): TrySubject {
  return {
    noMemory: { text: `記憶體不足，無法完成${verb}`, todo: noMemoryTodo },
    modelError: { text: `模型發生錯誤，沒有${verb}出結果`, todo: '請檢查模型，看看是哪裡出了問題。' },
    other: (message) => ({ text: `無法${verb}：${message}`, todo: '你可以重試；如果持續發生，請到背景任務中查看詳細資訊。' }),
    notStarted: (message) => ({ text: `無法開始${verb}：${message}`, todo: '' }),
    noticeTodo: (todo) => `${todo}現在${noun}很可能也會失敗。`,
  };
}

export const zhHant: ModelCheckMessages = {
  label: {
    check: '檢查',
    checkFull: '檢查模型',
    recheck: '重新檢查',
    repair: '修復…',
    repairSub: '只重新下載損壞的檔案',
    details: '技術詳細資訊',
    hideDetails: '隱藏技術詳細資訊',
    copy: '複製技術詳細資訊',
    copied: '已複製技術詳細資訊',
    copyFailed: '無法複製，請選取上方文字自行複製',
    cancel: '取消',
    retry: '重試',
    pickRef: '選擇其他錄音…',
    useSample: '使用範例錄音',
  },
  caption: '檢查會確認模型能正常使用；修復只會重新下載損壞的檔案。刪除模型時，其他模型仍在使用的共用元件會保留。',
  head: {
    running: '正在檢查…',
    repairing: '正在修復…',
    failed: '檢查未通過：',
    notStarted: '無法開始檢查：',
  },
  sentence: (text) => `${text}。`,
  phase: {
    queued: '排隊中',
    loading: '正在載入模型',
    running: '正在試跑一小段範例',
    verifying: '正在核對結果',
    repairing: '正在重新下載損壞的檔案，修復後會自動再檢查一次',
  },
  checkSentences,
  unknown: {
    text: '模型無法正常運作',
    todo: '請再檢查一次；如果持續發生，請複製技術詳細資訊並傳送給我們。',
  },
  notStarted: {
    RUNTIME_UNREACHABLE: { text: 'BaoCut 的背景服務沒有回應', todo: '請稍後再檢查一次；如果持續發生，請重新啟動 BaoCut。' },
    MODEL_IN_USE: { text: '其他任務正在使用這個模型', todo: '請等待該任務結束，或在背景任務中取消它，再檢查一次。' },
    MODEL_UNAVAILABLE: { text: '目前無法使用這個模型', todo: '請先修復，或重新啟用後再檢查。' },
    RESOURCE_ADMISSION_UNSATISFIABLE: { text: '這台電腦的記憶體不足以執行這個模型', todo: '請改用較小的模型。' },
    WEB_METHOD_NOT_ALLOWED: { text: '無法在瀏覽器中檢查本機模型', todo: '請在桌面應用程式中檢查。' },
    OFFLINE_STRICT: { text: '嚴格離線模式已開啟', todo: '請在設定中關閉嚴格離線模式，再檢查一次。' },
  },
  notStartedUnknown: {
    text: 'BaoCut 未接受這次檢查',
    todo: '請稍後再檢查一次；如果持續發生，請複製技術詳細資訊並傳送給我們。',
  },
  detail: {
    code: (code) => `代碼 ${code}`,
    model: (id, when) => `模型 ${id} · ${when}`,
    message: (message) => `訊息 ${message}`,
    passed: (when) => `檢查通過 · ${when}`,
  },
  noticeText: (what) => `這個模型上次檢查未通過：${what}`,
  refUnreadable: (file) => ({
    text: `無法讀取你的錄音「${file}」，檔案可能已損壞，或不是音訊`,
    todo: '請改用其他錄音，或先使用範例錄音聽聽效果。',
  }),
  refUnknown: '錄音',
  trySpeech: trySubject('合成', '試聽', '請關閉其他大型模型或佔用記憶體的應用程式後重試。'),
  tryImage: trySubject('繪製', '試畫', '請關閉其他大型模型後重試，或調低步數。'),
};
