import { createElement, Fragment, type ReactNode } from 'react';
import type { AgentCardMessages } from './agent-card-copy.ts';

export const zhHant: AgentCardMessages = {
  runFailed: (message: string) => `無法執行：${message}`,
  stopFailed: (message: string) => `無法停止：${message}`,
  loginCommand: '登入指令',
  installCommand: '安裝指令',
  upgradeCommand: '升級指令',
  linkLabel: '連結',
  terminalLogin: (command: string) => `正在終端機中執行 ${command} · 登入後回到這裡`,
  terminalRun: (command: string) => `正在終端機中執行 ${command} · 執行完畢後回到這裡`,
  terminalCopied: (label: string) => `無法開啟終端機。已複製${label}，請貼到終端機中執行。`,
  terminalManual: (command: string) => `無法開啟終端機。請在終端機中執行 ${command}。`,
  terminalFailed: (message: string) => `無法開啟終端機：${message}`,
  enableFailed: (message: string) => `無法啟用：${message}`,
  disableFailed: (message: string) => `無法停用：${message}`,
  recheckFailed: (message: string) => `無法重新檢查：${message}`,
  saveModelFailed: (message: string) => `無法儲存預設模型：${message}`,
  saveEffortFailed: (message: string) => `無法儲存預設推理強度：${message}`,
  refreshFailed: (message: string) => `無法重新整理模型：${message}`,
  setDefaultFailed: (message: string) => `無法設為預設：${message}`,
  openFailed: (message: string) => `無法開啟：${message}`,
  enabled: (name: string) => `已啟用 ${name}`,
  disabled: (name: string) => `已停用 ${name} · 新對話不再列出它`,

  defaultBadge: '預設',
  subInstalled: (version: string | null, account: string | null) =>
    ['已安裝在這台電腦上', version ? `v${version}` : null, account].filter(Boolean).join(' · '),
  subMissing: (command: string, plan: string) => `在這台電腦上找不到 ${command} · 用你已有的 ${plan} 就夠了`,
  enable: (name: string) => `啟用 ${name}`,
  details: '詳細資訊',
  install: '安裝',
  checking: '正在檢查…',
  gateTitle: (name: string, model: string) => `${name} 設定的預設模型 ${model} 需要更新的版本`,
  gateBody: (version: string, model: string) =>
    `這台電腦上是 ${version}，這個版本的模型清單中沒有 ${model}。設為「Agent 預設模型」的對話會照設定使用它，送出時會被拒絕；指定了模型的對話不受影響。`,
  gateUpgrade: '升級只會更新這個命令列工具，你的帳號和它本身的設定都不受影響。',
  gateNoUpgrade: '目前還沒有可升級的新版本。請先在對話中從清單改選模型。',
  upgradeTo: (version: string) => `升級到 ${version}`,
  updateStrip: (latest: string, current: string) => `有新版本 ${latest}（目前為 ${current}）。不升級也能繼續使用。`,
  viewUpgrade: '查看升級方式',
  cancel: '取消',

  defaultModel: '預設模型',
  defaultModelDesc:
    '新對話一開始會使用它；每個對話仍可在輸入框下方切換。轉錄、翻譯和剪輯用「推薦」等級就夠了，不需要最強的模型。',
  defaultModelOf: (name: string) => `${name} 的預設模型`,
  defaultEffortOf: (name: string) => `${name} 的預設推理強度`,
  modelsOf: (name: string, count: number) => `${name} 的模型 · ${count} 個`,
  modelsList: (list: string) => `${list}。每次檢查時會一併重新整理。`,
  modelsNone: '它沒有回報模型清單，所以對話會使用 Agent 預設模型。下次檢查時會再詢問一次。',
  refreshing: '正在重新整理…',
  refreshModels: '重新整理模型',
  refreshed: (name: string) => `已重新整理 ${name} 的模型清單`,
  nowDefault: (name: string) => `新對話現在會使用 ${name}`,
  version: (version: string | null) => (version ? `版本 · v${version}` : '版本'),
  versionDesc: (latest: string | null, min: string | null, source: string) =>
    `${latest ? `可以升級到 ${latest}。` : ''}${min ? `BaoCut 至少需要 ${min}。` : ''}升級只會更新這個命令列工具，你的帳號和它本身的設定都不受影響。${source}`,
  account: '帳號',
  accountDesc: (signedOut: boolean, account: string | null, plan: string) =>
    `${signedOut ? '尚未登入，或登入已過期' : (account ?? '已登入')}。使用的是你自己的 ${plan}，BaoCut 不會另外收費。登入在終端機中完成。`,
  loginInTerminal: '開啟終端機登入',
  switchAccount: '切換帳號…',
  location: '安裝位置',
  locationDesc: 'BaoCut 直接呼叫你電腦上的這個程式，不會另外安裝一份。',
  realLocation: '實際位置',
  setLocation: '手動指定位置',
  troubleshoot: '疑難排解',
  troubleshootDesc: '逐項檢查安裝、版本、登入和模型清單，告訴你卡在哪一步。',
  setDefault: '設為預設',
  runChecks: '執行檢查',

  sourceKnown: (label: string) =>
    `這一份是用「${label}」安裝的，所以也要用同樣的方式升級。其他方式無法升級這一份，只會再安裝一份。`,
  sourceUnknown: '請用當初安裝它的方式升級。',
  scriptInstall:
    '這個指令會從官方網站下載並執行指令碼。BaoCut 不會替你執行來自網路的指令碼：請複製後自行在終端機中執行。',
  scriptUpgrade: '這個指令會從官方網站下載並執行指令碼。請複製後自行在終端機中執行。',
  copyUpgrade: '複製這個指令並在終端機中執行，完成後回到這裡重新檢查。',
  runnableHint: '按一下指令左邊的 ▶ 就能在這裡執行，輸出會顯示在下方；也可以複製後自行在終端機中執行。',
  copyHint: '複製下面的指令，在終端機中執行。',
  installMethod: '安裝方式',
  upgradeMethod: '升級方式',
  needs: (needs: string) => `這台電腦上需要有 ${needs}。`,

  installIntro: (name: string, plan: string) =>
    `${name} 是安裝在你自己電腦上的命令列 AI 助理，用你已有的 ${plan} 登入。BaoCut 只是呼叫它：不另外收費，也不必在 BaoCut 中輸入 API 金鑰。`,
  stepInstall: '安裝到這台電腦',
  stepInstallOfficial: '依照官方說明安裝到這台電腦',
  installOfficialBody: (command: ReactNode): ReactNode =>
    createElement(Fragment, null, '依照官方說明安裝。安裝完成後，應該能在終端機中執行 ', command, '。'),
  stepLogin: '登入你的帳號',
  stepLoginBody:
    '安裝完成後，在終端機中執行下面的指令，並依照提示在瀏覽器中登入。登入在它自己的視窗中完成，BaoCut 不會經手你的帳號或密碼。',
  stepBack: '回到這裡',
  stepBackBody: '偵測到已安裝並登入後就能使用。',
  detecting: '正在檢查…',
  recheck: '我已安裝，重新檢查',
  notDetected: '已安裝但偵測不到？',
  notDetectedBody:
    'BaoCut 會在 PATH 和常見的安裝位置（Homebrew、npm 全域資料夾、~/.local/bin）中尋找。用版本管理工具（nvm、asdf、mise）安裝的有時在其他位置；你可以手動為 BaoCut 指定位置。',
  diagnosisOf: (name: string) => `${name} 的檢查結果`,
};
