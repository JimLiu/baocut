import { MODEL_SERVICE_CAPABILITIES, USAGE_PERIODS } from '@baocut/protocol';
import type { ModelsMessages } from './models-copy.ts';

export const zhHant: ModelsMessages = {
  help: `用法：
  baocut models cancel <bundleId> [--discard]
                                   停止安裝（已下載的部分會保留，再次 install 即可續傳）；--discard 一併刪除
  baocut models repair <bundleId> [--yes]
                                   逐一核對每個檔案的 sha256，只重新下載缺少或損壞的檔案（確認方式同 install）
  baocut models dir                顯示本機模型資料夾：位置、來源、已用與可用空間、已辨識的模型數
  baocut models dir --set <path> [--move|--switch]
                                   變更模型資料夾：--move 將現有模型移過去（背景任務，失敗時復原）；--switch 只變更位置
                                   （舊檔案保留，只有新位置中已有的模型可用）；目前的資料夾中有模型時，兩者必須擇一。
                                   有任務正在使用本機模型時會拒絕；由 BAOCUT_MODELS_DIR 環境變數指定時為唯讀
  baocut models dir --reset [--move|--switch]
                                   回復預設位置（<BAOCUT_HOME>/models），規則同 --set
  baocut models configure <providerId> [options]
                                   設定線上供應商：目錄中的供應商（openai、google、elevenlabs、anthropic、deepseek、
                                   qwen 等，請見 baocut models capabilities），或自訂的 OpenAI 相容端點 custom:<name>。
                                   Agent 供應商 agent:codex 只有開關（使用這台電腦上 Codex 的登入，不需要金鑰）
    --enable | --disable           啟用（長期授權會在需要時將素材音訊、文字或提示詞傳送給它）或停用
    --key-stdin                    從標準輸入讀取 API 金鑰（不接受命令列引數中的金鑰）：取代第一個帳號的金鑰，
                                   沒有帳號時會建立一個（多個帳號請使用 baocut models accounts）
    --endpoint <url>               自訂端點的基礎 URL（第一次設定時必填）；目錄中的供應商可改指向代理伺服器或閘道
    --model <id> ...               自訂端點提供的轉錄模型（可重複；第一個為預設）
    --speech-model <id> ...        自訂端點提供的語音合成模型（/audio/speech；可重複）
    --image-model <id> ...         自訂端點提供的影像生成模型（/images/generations；可重複）
    --text-model <id> ...          自訂端點提供的文字模型（/chat/completions；可重複）
                                   指定任何一種模型時，會整體取代已宣告的模型
    --verify                       儲存前先向供應商驗證一次新的金鑰與端點
  baocut models accounts <providerId>
                                   列出某個供應商的帳號：順序、名稱、遮罩後的金鑰、開關與狀態（呼叫時使用第一個已啟用且
                                   有金鑰的帳號，發生錯誤時不會改用下一個）
  baocut models accounts add <providerId> [--label <name>] [--region <region>] [--endpoint <url>] [--verify]
                                   新增帳號，金鑰從標準輸入讀取；--region 使用目錄中的地區（例如 global 或 cn）；
                                   --verify 先向供應商驗證，未通過則不儲存。新增帳號不會啟用供應商
  baocut models accounts remove <providerId> <accountId|name>
                                   移除一個帳號及其金鑰（移除最後一個帳號後供應商仍會保留，只是沒有可用的金鑰）
  baocut models accounts use <providerId> <accountId|name>
                                   設為首選：將這個帳號移到最前面
  baocut models usage [--period <${USAGE_PERIODS.join('|')}>] [--provider <id>]
                                   線上供應商與 Agent 的呼叫次數、用量與花費（預設為最近 30 天）：依牌價估算的金額、
                                   供應商回報的金額與費用未知的部分分開列出，不換算幣別；依供應商、能力、模型與帳號細分
  baocut models default <capability> <providerId|none> [modelId]
                                   設定或清除某項能力（${MODEL_SERVICE_CAPABILITIES.join('、')}）的預設供應商與模型
  baocut models remove <bundleId|providerId>
                                   刪除本機模型套件（其他模型套件使用中的共用元件會保留；有任務正在使用時會拒絕）；
                                   或移除線上供應商：自訂端點（custom:<name>）會整個刪除；目錄中的供應商會停用，
                                   並刪除其所有帳號與金鑰
  baocut models refresh <providerId>
                                   向線上供應商取得模型（與音色）清單並快取：清單中沒有的內建模型會標記為無法使用；
                                   無法取得清單時照舊使用內建清單
  baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]
                                   查看或設定文字生成的預設推理強度，以及每個供應商的並行上限（預設 4）；
                                   default 會回復出廠值`,
  byteProgressUnknown: (done) => `已接收 ${done}（總大小未知）`,
  byteProgress: (done, total, percent) => `${done} / ${total}（${percent}%）`,
  bundleStates: {
    'not-installed': '未安裝',
    downloading: '下載中',
    installed: '已安裝',
    loading: '載入中',
    ready: '就緒',
    busy: '忙碌',
    unloading: '卸載中',
    error: '無法使用',
  },
  installStates: {
    queued: '排隊中',
    downloading: '下載中',
    verifying: '驗證與發布中',
    paused: '已暫停',
  },
  bundleState: (label, state, reason) => `${label}（${state}${reason ? ` / ${reason}` : ''}）`,
  componentInstalled: '已安裝',
  componentMissing: '缺少',
  sharedWith: (bundles) => `  與 ${bundles.join('、')} 共用`,
  installTask: (jobId) => `  任務 ${jobId}`,
  resumeHint: (bundleId) => `；執行 baocut models install ${bundleId} 即可續傳`,
  installLine: (state, progress, task, hint) => `  安裝：${state}  ${progress}${task}${hint}`,
  checkPassed: '通過',
  checkFailed: (code) => `未通過${code ? `（${code}）` : ''}`,
  checkLine: (result, at, detail) => `  檢查：${result}  ${at}${detail ? `  ${detail}` : ''}`,
  remedyAppFileMissing: '解決方式：重新安裝 BaoCut；修復模型無濟於事',
  remedyRepair: (bundleId) => `解決方式：baocut models repair ${bundleId} 只會重新下載損壞的檔案；完成後再檢查一次`,
  remedyMaybeRepair: (bundleId) => `解決方式：先試試 baocut models repair ${bundleId}（只會重新下載損壞的檔案），再檢查一次`,
  remedyOutOfMemory: '解決方式：結束其他佔用大量記憶體的應用程式，或改選較小的模型，再檢查一次',
  remedy: (text) => `解決方式：${text}`,
  upToDate: (repair, bundleId) => (repair ? `${bundleId} 的檔案都完好，無需修復` : `${bundleId} 已安裝，無需下載`),
  planHeader: (repair, bundleId, source) => `從 ${source}${repair ? '修復' : '安裝'} ${bundleId}`,
  planKeep: (component, repo) => `  ${component}  ${repo}  已安裝，保留`,
  planDownload: (component, repo, files, size) => `  ${component}  ${repo}  下載 ${files} 個檔案，${size}`,
  sizeUnknown: '大小未知',
  toDownloadEstimate: (estimate) => `要下載：大小未知，約 ${estimate}`,
  toDownload: (size) => `要下載：${size}`,
  resumed: (size) => `續傳：暫存區中已有 ${size}，不會再次下載`,
  freeSpace: (size, short) => `可用空間：${size}${short ? '（不足）' : ''}`,
  sizeAbout: (size) => `約 ${size}`,
  installPrompt: (repair, size) => `要${repair ? '修復' : '安裝'}並下載 ${size} 嗎？[y/N] `,
  noSpace: (need, have) => `磁碟空間：這次需要 ${need}，只剩下 ${have}`,
  removed: (files) => `已刪除：${files.join('、')}`,
  nothingRemoved: '未刪除任何檔案',
  keptInUse: (repo, users) => `保留 ${repo}：${users.join('、')} 仍在使用`,
  keptOtherVersion: (repo) => `保留 ${repo}：資料夾中是不屬於這個模型套件的其他版本`,
  dirSources: {
    default: '預設位置',
    setting: '在設定中選擇的資料夾',
    env: 'BAOCUT_MODELS_DIR 環境變數（唯讀：要變更請修改環境變數並重新啟動 BaoCut）',
  },
  dirSource: (label) => `  來源：${label}`,
  dirMissing: '  這個資料夾不存在（外接磁碟未連接時也會如此）',
  dirNotWritable: '  BaoCut 無法寫入這個資料夾',
  dirUsage: (used, free, models) => `  已用 ${used}${free ? ` · 這個磁碟可用 ${free}` : ''} · 找到 ${models} 個模型`,
  dirDefault: (path) => `  預設位置：${path}`,
  dirMoving: (to, jobId) => `  正在移動${to ? `到 ${to}` : ''}（任務 ${jobId}）`,
  dirEnvLocked: '模型資料夾由 BAOCUT_MODELS_DIR 環境變數指定：要變更請修改環境變數並重新啟動 BaoCut',
  dirProblemMissing: '這個資料夾不存在：外接磁碟未連接時也會如此；請連接後再試一次',
  dirProblemNotWritable: 'BaoCut 無法寫入這個資料夾：請選擇可寫入的位置，或先變更它的權限',
  dirProblemNested: '新位置與目前的模型資料夾互相包含：請選擇一個既不在其中、也不包含它的資料夾',
  dirProblemSame: '這已經是目前的模型資料夾',
  dirFound: (count, size) => `找到 ${count} 個已下載的模型（${size}），可以直接使用`,
  dirEmpty: '這個資料夾中還沒有模型；之後下載的模型會放在這裡',
  dirFree: (size) => `這個磁碟可用 ${size}`,
  moveSameVolume: '同一個磁碟：移動只會重新命名，不佔用額外空間',
  moveSize: (size, fits) => `要移動 ${size}${fits ? '' : '，空間不足'}`,
  dirCurrentHas: (size, move) => `目前的資料夾中有 ${size} 的模型：${move}`,
  moveOrSwitch: '--move 與 --switch 只能擇一',
  accountStates: {
    unknown: '未驗證',
    ok: '正常',
    'invalid-key': '金鑰無效',
    'rate-limited': '已限速',
    'quota-exhausted': '額度用盡',
  },
  rateLimitedUntil: (label, until) => `${label}（直到 ${until}）`,
  noAccounts: '還沒有帳號：baocut models accounts add <providerId> 會從標準輸入讀取金鑰',
  accountEnabled: '已啟用',
  accountDisabled: '已停用',
  accountKeyUnreadable: '無法讀取金鑰',
  accountRegion: (region) => `地區 ${region}`,
  accountEndpoint: (endpoint) => `端點 ${endpoint}`,
  accountLastUsed: (at) => `上次使用 ${at}`,
  accountCurrent: '使用中',
  accountChoice: (accountId, label) => `${accountId}（${label}）`,
  noAccountChoices: '沒有帳號',
  listSep: '、',
  accountAmbiguous: (count, ref, choices) => `有 ${count} 個帳號名為「${ref}」，請使用 accountId：${choices}`,
  accountNotFound: (ref, choices) => `沒有這個帳號：${ref}（可選：${choices}）`,
  usagePeriods: { today: '今天', '7d': '最近 7 天', '30d': '最近 30 天', all: '全部' },
  unitTokens: (input, output) => `輸入 ${input} / 輸出 ${output} token`,
  unitCached: (cached) => `快取命中 ${cached}`,
  unitAudio: (minutes) => `音訊 ${minutes} 分鐘`,
  unitChars: (chars) => `${chars} 字`,
  unitImages: (images) => `${images} 張圖片`,
  clauseSep: '，',
  costKinds: {
    reported: '供應商回報',
    estimated: '依牌價估算',
    mixed: '回報與估算',
    unknown: '費用未知',
  },
  rowCalls: (calls, failed) => `${calls} 次呼叫${failed > 0 ? `（${failed} 次失敗）` : ''}`,
  costApprox: (money, kind) => `≈ ${money}（${kind}）`,
  usageHeader: (scope, period, from, to) => `用量（${scope ? `${scope}，` : ''}${period}：${from} 至 ${to}）`,
  noCalls: '  還沒有呼叫',
  totalCalls: (calls, failed) => `  ${calls} 次呼叫${failed > 0 ? `（${failed} 次失敗）` : ''}`,
  usageUnits: (units) => `  用量：${units}`,
  spentEstimated: (money) => `  花費 ≈ ${money}（依牌價估算）`,
  spentReported: (money) => `  花費 ${money}（供應商回報）`,
  unknownCostCalls: (calls) => `  另有 ${calls} 次呼叫費用未知`,
  noBilledCalls: '  沒有計費的呼叫',
  byProvider: '依供應商',
  byCapability: '依能力',
  byModel: '依模型',
  byAccount: '依帳號',
  usageRepair: '用法：baocut models repair <bundleId> [--yes]',
  usageCancel: '用法：baocut models cancel <bundleId> [--discard]',
  usageConfigure: '用法：baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …',
  usageDefault: '用法：baocut models default <capability> <providerId|none> [modelId]',
  usageRemove: '用法：baocut models remove <bundleId|providerId>',
  usageRefresh: '用法：baocut models refresh <providerId>',
  usageParameters: '用法：baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]',
  usageAccounts:
    '用法：baocut models accounts <providerId> | add <providerId> [--label <name>] [--region <region>] [--verify] | remove <providerId> <account> | use <providerId> <account>',
  usageDir: '用法：baocut models dir [--set <path> [--move|--switch] | --reset [--move|--switch]]',
  cancelledDiscarded: '已停止並刪除已下載的部分',
  cancelledKept: '已停止（已下載的部分會保留，再次執行 install 即可續傳）',
  unknownCapability: (capability, choices) => `未知的能力：${capability}（應為 ${choices.join('、')} 其中之一）`,
  clearDefaultNoModel: '清除預設值時請勿指定模型',
  defaultSet: (label, provider, model) => `${label}的預設值：${provider} / ${model}`,
  defaultCleared: (label) => `已清除${label}的預設值`,
  customProviderDeleted: (id) => `已刪除 ${id}（指向它的預設值會保留，並顯示為無法使用）`,
  providerRemoved: (id) => `已移除 ${id}：已停用，並刪除其所有帳號與金鑰（指向它的預設值會保留，並顯示為無法使用）`,
  providerRefreshFailed: (id, error) => `無法重新整理 ${id}：${error ?? '原因不明'}；仍使用內建的模型清單`,
  providerRefreshed: (id, models, voices, at) => `已重新整理 ${id}：${models} 個模型${voices !== undefined ? `、${voices} 個音色` : ''}（${at}）`,
  periodChoices: (periods) => `--period 必須是 ${periods.join('、')} 其中之一`,
  enableDisableConflict: '--enable 與 --disable 只能擇一',
  saved: (description) => `已儲存：${description}`,
  verifiedAndSaved: '已驗證並儲存',
  savedPlain: '已儲存',
  providerNotEnabled: (id) => `${id} 尚未啟用：baocut models configure ${id} --enable`,
  accountRemoved: (name) => `已移除帳號 ${name}`,
  accountPreferred: (name) => `已設為首選：${name}`,
  providerHasNoAccounts: (id) => `${id} 沒有帳號`,
  noSuchProvider: (id) => `沒有這個供應商：${id}`,
  alreadyRepairing: (jobId) => `已在修復中（任務 ${jobId}），繼續顯示進度`,
  nothingToRepair: '沒有需要修復的檔案',
  notTtyConfirmDownload: '不是在終端機中執行：使用者確認下載後，請加上 --yes',
  notDownloaded: '未下載',
  nothingToDownload: '沒有需要下載的內容',
  repairDone: '修復完成',
  repairPartialKept: (bundleId) => `已下載的部分會保留：執行 baocut models repair ${bundleId} 即可續傳`,
  setResetConflict: (usage) => `--set 與 --reset 只能擇一。${usage}`,
  dirHasModels: '目前的資料夾中有模型：加上 --move 將它們移過去，或用 --switch 只變更位置（舊檔案會保留）',
  dirChanged: (dir, oldFilesKept) => `模型資料夾已變更為 ${dir}${oldFilesKept ? '（舊位置的檔案會保留）' : ''}`,
  modelsMoved: (dir) => `已將模型移到 ${dir}`,
  dirRolledBack: '已復原：原本的模型資料夾沒有變動',
  pasteKeyHint: '貼上 API 金鑰後按 Return，再按 Ctrl-D 完成輸入：',
  noKeyOnStdin: '標準輸入中沒有 API 金鑰',
  keyHasWhitespace: 'API 金鑰不應包含空白或換行：標準輸入中只放金鑰本身',
  positiveInteger: (option) => `${option} 必須是正整數`,
  effortChoices: (efforts) => `--effort 必須是 ${efforts.join('、')} 其中之一`,
  capabilityLabels: {
    transcribe: '轉錄',
    synthesizeSpeech: '語音合成',
    generateImage: '影像生成',
    generateText: '文字生成',
    separateAudio: '人聲分離',
  },
  unavailableLabels: {
    'not-configured': '未啟用',
    'missing-credential': '缺少 API 金鑰',
    'not-installed': '未安裝',
    'signed-out': '未登入',
    outdated: '版本過舊',
    'not-paired': '未配對',
    'not-connected': '無法連線',
    unsupported: '不支援',
    resource: '多次出錯後已停用',
  },
  unavailable: '無法使用',
  capabilityState: (label, available, reason) => `${label}${available ? '可用' : `無法使用（${reason}）`}`,
  capabilitySep: '，',
  configEnabled: '已啟用',
  configDisabled: '已停用',
  keyState: (set) => `金鑰${set ? '已設定' : '未設定'}`,
  configEndpoint: (url) => `端點 ${url}`,
  modelListRefreshed: (at) => `模型清單已於 ${at} 重新整理`,
  lastRefreshFailed: (at) => `上次重新整理失敗（${at}），使用內建清單`,
  textParameters: (effort, concurrency) => `預設推理強度：${effort ?? '模型本身的設定'} · 每個供應商的並行數 ${concurrency}`,
  markDefault: '預設',
  markDeclared: '使用者宣告',
  wordTimestampsNative: '逐字時間戳記',
  wordTimestampsEstimated: '逐字時間依長度估算',
  maxInputMegabytes: (mb) => `每次 ≤ ${mb} MB`,
  maxDurationMinutes: (minutes) => `每次 ≤ ${minutes} 分鐘`,
  voiceCount: (count, defaultVoice) => `${count} 個音色（預設 ${defaultVoice ?? '無'}）`,
  noPresetVoices: '沒有內建音色，必須指定音色',
  acceptsCustomVoices: '接受自訂音色',
  maxInputChars: (count) => `每次 ≤ ${count} 字`,
  acceptsInstructions: '接受風格指示',
  sizeCount: (count, defaultSize) => `${count} 種尺寸${defaultSize ? `（預設 ${defaultSize}）` : ''}`,
  aspectRatios: (ratios) => `長寬比 ${ratios}`,
  maxImageCount: (count) => `每次 ≤ ${count} 張圖片`,
  sizeAndSeedFixed: '無法設定尺寸與 seed',
  contextTokens: (count) => `上下文 ${count} token`,
  maxOutputTokens: (count) => `輸出 ≤ ${count} token`,
  efforts: (efforts, defaultEffort) => `推理強度 ${efforts}${defaultEffort ? `（預設 ${defaultEffort}）` : ''}`,
  structuredOutput: '結構化輸出',
  subscription: '包含在訂閱中，額度未知',
  modelName: (id, label) => `${id}（${label}）`,
};
