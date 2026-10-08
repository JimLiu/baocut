import type { CliMessages } from './cli-copy.ts';

export const zhHant: CliMessages = {
  helpTagline: 'baocut：用 BaoCut 轉錄、翻譯、剪輯、配音與匯出影片。請先執行 `baocut status`，看看這台電腦能做什麼。',
  helpFlows: '流程（傳回作業；預設等到完成）',
  helpObjects: '物件',
  helpAdmin: '本機管理（供人使用；Agent 請先詢問使用者）',
  helpMore: '更多',
  helpMoreHelp: '參數、效果與範例',
  helpMoreSpec: '機器可讀的目錄（JSON）',
  helpMoreStatus: '這台電腦目前能做什麼',
  helpGlobalFlags: '--json --project <dir> --yes --max-bytes <n> --result-file <file> --no-start',
  helpJobFlags: '作業：--no-wait --timeout <s> --progress jsonl',
  helpAdminVerbs: '本機管理',
  helpGroupMore: (noun) => `執行 baocut help ${noun} <command> 查看參數與範例。`,
  helpFlagsPlaceholder: '[flags]',
  effectLabel: (effect) => `效果：${effect}`,
  effectQuery: 'query（唯讀）',
  effectMutation: 'mutation（變更狀態）',
  effectJob: 'job（傳回作業；預設等到完成）',
  effectDestructive: 'destructive（無法還原；需要 --yes）',
  helpParameters: '參數',
  helpNoParameters: '（無）',
  helpRequired: '必填',
  helpRepeatable: '可重複',
  helpPositionalNote: (positional, flag) => `${positional} 可以用位置引數或 ${flag} 指定，兩者擇一。`,
  helpExamples: '範例',
  helpCommonFlags: '通用旗標',

  nextLabel: '下一步',
  errorLabel: '錯誤',
  runtimeStartedNote: '（已在背景啟動 BaoCut Runtime；閒置時會自行結束）',
  spilledNote: (maxBytes) =>
    `結果超過 ${maxBytes} 位元組：完整結果在 path 所指的檔案中（JSON）。coverage 列出它的最上層鍵與各陣列的長度，summary 列出它的簡短欄位。請讀取該檔案、用 continueWith.paging 中的旗標縮小請求，或加上 --max-bytes continueWith.maxBytes 重新執行。`,
  resultFileWritten:
    '已依 --result-file 的要求將完整結果寫入 path 所指的檔案（JSON）。coverage 列出它的最上層鍵與各陣列的長度，summary 列出它的簡短欄位。',

  unknownCommand: (command) => `未知的指令：${command}。執行 baocut --help 查看所有指令。`,
  unknownFlag: (flag, command) => `baocut ${command} 沒有 ${flag} 旗標。請見 baocut help ${command}。`,
  missingValue: (flag) => `${flag} 需要一個值。`,
  noValueExpected: (flag) => `${flag} 是開關，不接受值。`,
  duplicateFlag: (flag) => `${flag} 指定了不只一次。`,
  badNumber: (flag, value) => `${flag} 需要數字，收到的是「${value}」。`,
  badInteger: (flag, value) => `${flag} 需要整數，收到的是「${value}」。`,
  badBoolean: (flag, value) => `${flag} 需要 true 或 false，收到的是「${value}」。`,
  badChoice: (flag, value, choices) => `${flag} 必須是 ${choices.join('、')} 其中之一，收到的是「${value}」。`,
  badValue: (flag, value) => `「${value}」不是 ${flag} 的有效值。`,
  badJson: (flag, reason) => `${flag} 需要 JSON（字面值、@file，或以 - 表示 stdin）：${reason}`,
  expectedObject: (flag) => `${flag} 需要 JSON 物件。`,
  readFileFailed: (flag, file, reason) => `無法讀取 ${flag} 的 ${file}：${reason}`,
  stdinTwice: (flag) => `標準輸入只能讀取一次（${flag} 又要求讀取）。`,
  noPositional: (command, value) => `baocut ${command} 不接受位置引數（收到「${value}」）；請使用旗標。`,
  tooManyPositionals: (command, extra) => `baocut ${command} 只接受一個位置引數；多出的：${extra}`,
  positionalAndFlag: (field, flag) => `${field} 同時以位置引數與 ${flag} 指定；請只指定一個。`,
  missingRequired: (names, command) => `缺少 ${names}。請見 baocut help ${command}。`,
  dryRunUnsupported: (command) => `baocut ${command} 沒有 --dry-run。`,
  projectNotDirectory: (value) => `--project ${value} 不是資料夾。`,
  confirmationRequired: (command, summary) =>
    `baocut ${command} 無法還原，這次未執行。它會：${summary}使用者同意後，請加上 --yes 再執行一次。`,
  confirmationNext: (command) => `baocut ${command} … --yes（使用者同意後）`,
  unknownSpec: (name) => `沒有名為 ${name} 的工具。baocut spec 會列出完整目錄。`,
  unknownEditOp: (op) => `edits apply 沒有名為 ${op} 的操作。baocut edits ops 會列出所有操作。`,
  catalogUnavailable: (command) =>
    `離線目錄快照不存在，也沒有正在執行的 Runtime。請在儲存庫中執行 \`${command}\` 產生快照，或用 baocut runtime ensure 啟動 Runtime。`,
  runtimeUsage: '用法：baocut runtime ensure | status | stop',
  installConfirmationRequired: (bundleId, size, source) =>
    `安裝本機模型 ${bundleId} 需要從 ${source} 下載 ${size}；這次未下載任何內容。請告知使用者大小，使用者同意後加上 --yes 再執行一次。`,
  sizeEstimated: '（估計）',

  metaHelp: {
    help: 'baocut help [<command>]\n\n不指定指令：一頁總覽。指定指令（`help videos`、`help videos inspect`、`help runtime`）：它的參數、效果與範例。有正在執行的 Runtime 時使用它的目錄，否則使用離線快照；絕不會啟動 Runtime。',
    spec: 'baocut spec [<name>]\n\n機器可讀的目錄，以純 JSON 輸出（不含封套），並附上介面版本。<name> 可以是工具名稱（videos_inspect）、以點分隔的名稱（videos.inspect）、指令（videos inspect），或 edits.<operation>（edits apply 的單一操作）。有正在執行的 Runtime 時使用它的目錄，否則使用離線快照；絕不會啟動 Runtime。',
    version:
      'baocut version\n\n這個 CLI 與（正在執行時）Runtime 的版本、兩者的工具介面版本，以及是否相符。純 JSON；絕不會啟動 Runtime。',
    status:
      'baocut status [--full] [--no-start]\n\n這台電腦目前能做什麼：Runtime、每項能力的預設值與可用性、本機模型套件與外部工具，缺少的部分附上補救指令。沒有正在執行的 Runtime 時會啟動一個；加上 --no-start 時改為回答 running: false。能力與模型套件預設顯示摘要；--full 會加上各供應商的模型、參數與限制，以及模型套件詳情。',
    runtime: [
      'baocut runtime ensure | status | stop',
      '',
      '這個 CLI 所連線的 BaoCut Runtime（每個 BAOCUT_HOME 一個）。',
      '  ensure   找到正在執行的 Runtime，或在背景啟動一個；由 CLI 啟動的 Runtime 閒置（沒有連線、作業或開啟的服務）',
      '           達 runtime.idleExitMinutes 後會自行結束',
      '  status   是否正在執行、由誰啟動、連線、進行中的作業、開啟的服務與閒置結束設定；絕不會啟動 Runtime',
      '  stop     停止由 CLI 啟動的 Runtime。由桌面應用程式或其他人啟動時回報 RUNTIME_NOT_OWNED；桌面應用程式、其他 CLI',
      '           或未完成的作業仍在使用時回報 RUNTIME_IN_USE（結束代碼 1）',
      '',
      '旗標：--json  --no-start（ensure：不啟動，改以結束代碼 3 失敗）',
    ].join('\n'),
  },

  runtimeNotRunning: (home) => `${home} 沒有正在執行的 BaoCut Runtime，且指定了 --no-start。`,
  runtimeNoEntry:
    '沒有正在執行的 BaoCut Runtime，也無法啟動：請安裝 BaoCut 應用程式、從儲存庫執行，或將 BAOCUT_RUNTIME_ENTRY 設為 Runtime 的進入點。',
  runtimeStartFailed: (reason, log) => `無法啟動 BaoCut Runtime（${reason}）。請見 ${log}。`,
  runtimeStartTimeout: (seconds, log) => `BaoCut Runtime 未在 ${seconds} 秒內就緒。請見 ${log}。`,
  exitedWith: (code) => `結束代碼 ${code ?? '未知'}`,
  runtimeConnectFailed: (reason) => `無法連線到 BaoCut Runtime：${reason}`,
  runtimeLost: (reason) => `與 BaoCut Runtime 的連線中斷：${reason}`,
  protocolMismatch: (reason) => `這個 CLI 與 BaoCut Runtime 使用的通訊協定版本不同：${reason}。請更新較舊的一方。`,
  interfaceMismatch: (cli, runtime, update) =>
    `這個 CLI 使用的工具介面版本是 ${cli}，Runtime 使用的是 ${runtime}。${update === 'cli' ? '請更新 CLI。' : '請更新 BaoCut 應用程式（或從與 CLI 相同的程式碼重新啟動 Runtime）。'}`,

  jobCancelling: (jobId) => `正在取消 ${jobId}…（再按一次 Ctrl-C 可立即停止等待）`,
  jobCancelFailed: (reason) => `無法取消作業：${reason}`,
  jobEnded: (state) => `作業已結束：${state}。`,
  statusFullNext:
    'baocut status --full 會列出每項能力的所有供應商與模型；查看單一能力請執行 baocut models capabilities --capability <capability>，查看模型套件詳情請執行 baocut models list。',
  waitTimeout: (seconds, jobId) => `等待 ${seconds} 秒後已停止等待；作業 ${jobId} 會繼續執行。`,

  noRuntimeClient: '這個指令不會連線到 Runtime',
};
