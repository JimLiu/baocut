import type { SystemAccessMessages } from './system-access-copy.ts';

export const zhHant: SystemAccessMessages = {
  cardTitle: (names) => `允許 BaoCut 讀取 ${names} 的 Cookie`,
  cardBody: "macOS 要求先給 BaoCut「完整磁碟取用權限」。點「開啟系統設定」，BaoCut 會直接帶你到這一頁，不用自己去找。BaoCut 只讀取你勾選的瀏覽器，不讀別的檔案。",
  openedTitle: "在系統設定裡啟用 BaoCut，再回到這裡",
  openedBody: "啟用 BaoCut 旁邊的開關；系統詢問是否結束並重新打開時選「結束並重新打開」。清單裡沒有 BaoCut 時，點清單下方的「+」把它加進去。系統沒有提示重新打開時，點下面的「重新啟動 BaoCut」。",
  open: "開啟系統設定",
  openAgain: "再次開啟系統設定",
  restart: "重新啟動 BaoCut",
  askTitle: (names) => `先允許讀取 ${names} 的 Cookie？`,
  askBody: (names) => `這次下載會用到 ${names} 的登入狀態，macOS 要先給 BaoCut「完整磁碟取用權限」。開啟系統設定啟用後，回來再下載；也可以這次先跳過，用其他瀏覽器的登入狀態繼續。`,
  skip: "這次跳過",
  settingLabel: "完整磁碟取用權限",
  settingAllowed: "已允許。BaoCut 可以讀取外接硬碟、桌面、文件、下載裡的檔案與 Safari 的 Cookie，但只讀你選的素材、儲存位置與勾選的瀏覽器。",
  settingMissing: "未允許。macOS 預設不讓 App 讀取外接硬碟、桌面、文件、下載裡的檔案與 Safari 的 Cookie。允許後，BaoCut 讀這些位置時不會再因權限失敗；只讀你選的素材、儲存位置與勾選的瀏覽器。",
  openFailed: "無法開啟系統設定。請自己打開「系統設定 › 隱私權與安全性 › 完整磁碟取用權限」。",
};
