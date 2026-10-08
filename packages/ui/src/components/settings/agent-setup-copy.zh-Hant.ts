import type { AgentSetupMessages } from './agent-setup-copy.ts';

export const zhHant: AgentSetupMessages = {
  badge: {
    'not-installed': '未安裝',
    error: '無法執行',
    outdated: '版本過舊',
    'signed-out': '需要登入',
    disabled: '已停用',
  },
  badgeNotChecked: '尚未檢查',
  badgeReady: '可用',
  badgeModelUpgrade: '可用 · 預設模型需要升級',
  badgeModelUnavailable: '可用 · 預設模型無法使用',
  badgeUpdate: '可用 · 有可用的更新',

  errorTitle: (name: string) => `找到了 ${name}，但無法執行`,
  errorBody: (detail: string | null) =>
    `${detail ? `${detail} ` : ''}常見原因是 Node.js 被解除安裝或升級，或檔案權限有變動。執行檢查可以找出是哪一步出錯。`,
  errorCta: '執行檢查',
  outdatedTitle: (name: string, version: string | null) =>
    version ? `${name} ${version} 版本太舊，BaoCut 無法驅動` : `這個版本的 ${name} 太舊，BaoCut 無法驅動`,
  outdatedBody: (detail: string | null, minVersion: string) =>
    `${detail ? `${detail} ` : `需要 ${minVersion} 或更新版本。`}升級只會更新這個命令列工具，你的帳號和它本身的設定都不受影響。`,
  outdatedCta: (version: string) => `升級到 ${version}`,
  signedOutTitle: (name: string) => `${name} 需要重新登入`,
  signedOutBody: (name: string) =>
    `登入是在 ${name} 自己的視窗中完成，BaoCut 不會經手你的帳號或密碼。登入後回到這裡檢查。`,
  signedOutCta: '開啟終端機登入',

  stepSkipped: '上一步通過後才會檢查',
  stepFind: '在這台電腦上找到',
  stepFindFail: (command: string) => `在常見的安裝位置和 PATH 中都找不到 ${command}`,
  stepRun: '能夠啟動',
  stepRunOk: (command: string, version: string) => `${command} --version 回傳 ${version}`,
  stepRunFail: '無法啟動',
  stepVersion: 'BaoCut 支援此版本',
  stepVersionOk: (version: string, min: string) => `${version}，最低需求 ${min}`,
  stepVersionFail: (version: string, min: string) => `目前為 ${version}，最低需求 ${min}`,
  stepLogin: '已登入你的帳號',
  stepLoginOk: '已登入',
  stepLoginFail: '它回報尚未登入，或登入已過期',
  stepModels: '可取得模型清單',
  stepModelsOk: (n: number) => `${n} 個模型`,
  stepModelsNone: '它沒有回報模型清單；對話會使用 Agent 預設模型',
  verdictFail: (label: string, detail: string) => `卡在「${label}」：${detail}`,
  verdictOk: '五項檢查全部通過，可以開始對話。',

  moreSummary: (names: string[], more: boolean) => names.join('、') + (more ? ' 等' : ''),

  readyTitle: '準備就緒',
  readyBody: (name: string, model: string, plan: string) =>
    `新對話會使用 ${name} · ${model}。它使用這台電腦上已安裝的 ${name} 和你自己的 ${plan}，BaoCut 不會另外收費。`,
  readyCta: '開始對話',
  attentionBody: (name: string) =>
    `它已經安裝在這台電腦上，不需要重新安裝。原因和解決方法在下方「${name}」那一列。`,
  attentionCta: '檢視問題',
  offTitle: (name: string) => `${name} 已安裝，但已停用`,
  offBody: '啟用後，只要一句話就能把工作從 BaoCut 交給它。',
  offCta: (name: string) => `啟用 ${name}`,
  missingTitle: '這台電腦上還沒有偵測到 Agent',
  missingBodyMany: '安裝下方任何一個，並用你已有的帳號登入即可，不需要全部安裝。',
  missingBodyOne: '依照下方步驟安裝，並用你已有的帳號登入即可。',

  logDropped: (n: number) => `…（已省略前面 ${n} 行）`,
  doneNotDetected: (name: string) => `指令已執行完畢，但仍未偵測到 ${name}。如果它安裝在其他位置，可以手動指定位置。`,
  doneSignIn: (name: string, version: string) => `已偵測到 ${name} ${version} · 還需要登入一次`,
  doneInstalled: (name: string, version: string) => `已偵測到 ${name} ${version}`,
  doneUpgraded: (name: string, version: string) => `${name} 現在是 ${version} · 正在重新整理它的模型清單`,

  tier: {
    balanced: { label: '推薦', description: '轉錄、翻譯、剪輯都夠用；速度快，也較省訂閱額度' },
    max: { label: '最強', description: '較慢，也較耗訂閱額度；一般用不到' },
    fast: { label: '最快', description: '適合改幾句字幕這類小幅修改' },
  },
  agentDefaultModel: 'Agent 預設模型',
  cliConfigGate: (model: string) => `依照 CLI 設定 · ${model} 需要升級 CLI`,
  cliConfigModel: (model: string) => `依照 CLI 設定 · ${model}`,
  cliConfig: '依照 CLI 設定',
  modelMissing: '不在目前的模型清單中，新對話會改用推薦模型',
  effort: {
    minimal: '最低',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
    max: '最高',
  },
  modelDefaultEffort: '模型預設',
  modelDefaultEffortOf: (label: string) => `模型預設（${label}）`,

  rulesTitle: (n: number) => `總是允許的指令 · ${n} 條`,
  rulesBody: '這些規則來自你在對話中選擇「總是允許」。移除後，該規則不再自動核准操作；存取模式與其他規則仍然有效。',
  rulesEmpty: '還沒有儲存的規則。在對話中的核准卡片上選擇「總是允許」，就會顯示在這裡。',
};
