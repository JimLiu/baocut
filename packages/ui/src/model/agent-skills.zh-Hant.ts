import type { AgentSkillsMessages } from './agent-skills.ts';

export const zhHant: AgentSkillsMessages = {
  origin: { builtin: '內建', personal: '我的', 'third-party': '第三方' },
  all: '全部',
  commit: (sha: string) => `（${sha}）`,
  bytes: (n: number) => `${n} 位元組`,
  action: {
    load: '載入 Skills',
    toggle: '切換開關',
    add: '新增',
    import: '匯入',
    remove: '移除',
    read: '開啟檔案',
    send: '傳送',
  },
  exists: (id: string | null) =>
    `${id ? `名為「${id}」` : '同名'}的 Skill 已經存在，不會覆寫它。請先移除舊的，或把資料夾重新命名後再新增。`,
  invalid: (issue: string) => `這不是可用的 Skill：${issue}。根資料夾需要一份 SKILL.md，開頭寫明 name 與 description。`,
  tooLarge: (files: number, total: string, skillFile: string) =>
    `這個 Skill 太大了：一個 Skill 最多 ${files} 個檔案、合計 ${total}，SKILL.md 本身最多 ${skillFile}。`,
  githubNotFound: '在 GitHub 上找不到這個儲存庫、分支或資料夾（也可能是私人儲存庫）。請檢查網址。',
  folderNotFound: '找不到這個資料夾，可能已被移動或刪除。',
  urlInvalid: '無法辨識這個網址。請寫成 owner/repo，或 https://github.com/owner/repo/tree/分支/資料夾。',
  network: '無法連線到 GitHub，請檢查網路後再試。',
  rateLimited: 'GitHub 的匿名存取次數暫時用完了，請稍後再匯入。',
  offline: '目前是嚴格離線模式，無法從 GitHub 匯入。',
  builtinNotRemovable: '內建 Skill 無法移除，但可以把它關閉。',
  notFound: '這個 Skill 已經不存在，可能剛被移除。',
  fileNotFound: '這個檔案已經不存在。',
  fileTooLarge: '這個檔案太大，無法在這裡顯示，可以在它的資料夾中開啟。',
  fileNotText: '這不是文字檔，所以不在這裡顯示。',
  webNotAllowed: '無法在瀏覽器中這樣做，請改用 BaoCut 桌面應用程式。',
  webReadOnly: '這個瀏覽器連線是唯讀的，無法做任何修改。',
  failed: (action: string, raw: string) => `無法${action}：${raw}`,
  sendFailed: (raw: string) => `無法傳送：${raw}`,
};
