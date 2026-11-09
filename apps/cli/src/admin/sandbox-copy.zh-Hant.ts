import type { SandboxMessages } from './sandbox-copy.ts';

export const zhHant: SandboxMessages = {
  help: `用法：
  baocut sandbox create <資料夾> [--link-accounts-from <home>]
                                   為開發與測試建立一個獨立的 Runtime 主目錄：這個資料夾和裡面的 projects 資料夾，用這份
                                   儲存庫的命令列執行這個主目錄的 bin/baocut，以及把 shell 切過去的 env.sh / env.ps1。再執行
                                   一次會更新這些檔案。只能從儲存庫執行；不能是預設的 ~/.baocut
    --link-accounts-from <home>    同時以唯讀方式連結那個主目錄（通常是 ~/.baocut）的模型帳號，與 baocut models accounts
                                   link --from 相同。呼叫用的是你的真實帳號，照常計費`,
  defaultHome: (dir) => `${dir} 是預設的 Runtime 主目錄，裡面是你的真實資料；沙盒請換一個資料夾`,
  needsSourceCli:
    'baocut sandbox create 只能從儲存庫執行（node apps/cli/src/main.ts sandbox create …）。這個命令列啟動的是 BaoCut 應用程式的 Runtime，金鑰放在所有主目錄共用的系統鑰匙圈裡：在那裡建立沙盒可能覆寫或刪除你的真實金鑰',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY 指向 ${entry}，不知道那個 Runtime 把金鑰放在哪裡。建立沙盒前請先取消這個變數`,
  notEmpty: (dir) => `${dir} 裡已經有檔案，又不是 BaoCut 主目錄；請換一個新的或空的資料夾`,
  notFolder: (dir) => `${dir} 不是資料夾`,
  created: (dir) => `沙盒建立好了：${dir}`,
  refreshed: (dir) => `沙盒已更新：${dir}`,
  projects: (dir) => `  專案      ${dir}`,
  cli: (file) => `  baocut    ${file}（執行這份儲存庫的命令列）`,
  useHeader: '在 shell 裡這樣用：',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   （PowerShell）`,
  useNote:
    '之後那個 shell 裡的 baocut，以及從它啟動的 Agent，都使用這個沙盒；其他 shell 照舊使用 ~/.baocut。它的 Runtime 把金鑰存在沙盒裡的檔案中',
  linkFailed: (dir) => `${dir} 的沙盒已經建立好；連結帳號沒有成功：`,
};
