import type { DoctorMessages } from './doctor-copy.ts';

export const zhHant: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'BaoCut 為什麼啟動不了、為什麼讀不到：終端機找到的是哪個 baocut，CLI 會啟動哪個 Runtime、用哪個主目錄，',
    '憑證儲存區有沒有回應，以及 macOS 上的完整磁碟取用權限。每一項是 ok、warn、fail 或 skip，有補救命令的會附上；',
    'next 是第一個問題的補救。',
    '唯讀：不啟動 Runtime，也不讀任何金鑰（鑰匙圈那一項只問一個編出來的鍵在不在）。補救命令先徵得使用者同意再執行。',
    '',
    '旗標：--json',
  ].join('\n'),
  checkName: {
    entry: '命令列',
    runtime: 'Runtime',
    credentials: '憑證',
    fullDiskAccess: '完整磁碟取用權限',
  },
  remedyLabel: '補救',

  entryApp: (found, version) => `終端機用的是 ${found}，就是 BaoCut 應用程式${version ? ` ${version}` : ''} 內建的命令列`,
  entryOtherApp: (found, target, app) => `終端機用的是 ${found}（${target}），不是 ${app} 那個 BaoCut 應用程式內建的命令列`,
  entryNoApp: (found, target) => `終端機用的是 ${found}（${target}）；找不到 BaoCut 應用程式`,
  entryMissing: '終端機還找不到 baocut。從 BaoCut 應用程式安裝它（不需要管理員權限）。',
  entryMissingNoApp: '終端機找不到 baocut，常見的位置也沒有 BaoCut 應用程式',

  runtimeRunning: (version, pid, by) => `執行中：版本 ${version}，程序 ${pid}，由${by === 'cli' ? '命令列' : ' BaoCut 應用程式'}啟動`,
  runtimeStopped: (entry) => `沒有在執行。下一個命令會在背景用 ${entry} 啟動它`,
  runtimeUnreachable: (pid, reason) => `有一個 Runtime 在執行（程序 ${pid}），但連不上：${reason}`,
  runtimeNoLaunch: '沒有在執行，也沒有能啟動的 Runtime：請安裝 BaoCut 應用程式、從儲存庫執行，或將 BAOCUT_RUNTIME_ENTRY 設為 Runtime 的進入點。',

  credentialsFile: (file) => `這個版本把金鑰存在檔案裡：${file}`,
  credentialsKeychain: (platform) => (platform === 'win32' ? 'Windows 認證管理員可以使用' : 'macOS 鑰匙圈可以使用'),
  credentialsDenied:
    '鑰匙圈拒絕存取。透過 SSH 或沒有登入桌面時，macOS 可能一直鎖著它：在桌面上的終端機裡執行 baocut，或解鎖登入鑰匙圈。',
  credentialsNoHelper: (file) => `找不到憑證輔助程式${file ? `（${file}）` : ''}，讀不了金鑰。請重新安裝 BaoCut 應用程式。`,
  credentialsUnavailable: (reason) => `連不上憑證儲存區：${reason}`,
  credentialsUnknown: '金鑰存在哪裡由 BAOCUT_RUNTIME_ENTRY 指向的進入點決定；沒有檢查',
  credentialsTimedOut: (seconds) => `輔助程式 ${seconds} 秒內沒有回應`,

  fdaGranted: '完整磁碟取用權限已開啟',
  fdaMissingApp:
    'BaoCut.app 沒有完整磁碟取用權限，受保護位置（桌面、文件、下載項目、其他磁碟）裡的檔案可能讀不到。在「系統設定 › 隱私權與安全性 › 完整磁碟取用權限」中打開 BaoCut，再執行 baocut doctor 重新檢查。',
  fdaMissingCli: (app) =>
    `命令列啟動的 Runtime 沒有完整磁碟取用權限；macOS 把它算在${app ?? '執行命令的那個應用程式（終端機，或執行 Agent 的應用程式）'}頭上。在「系統設定 › 隱私權與安全性 › 完整磁碟取用權限」中打開那個應用程式並重新開啟它，或停止這個 Runtime（baocut runtime stop）再開啟 BaoCut 應用程式；之後執行 baocut doctor 重新檢查。`,
  fdaNotRunning: 'Runtime 執行中才會檢查',
};
