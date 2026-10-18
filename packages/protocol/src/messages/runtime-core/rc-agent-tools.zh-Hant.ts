import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

function exportKindLabel(kind: string): string {
  switch (kind) {
    case 'subtitles':
      return '字幕';
    case 'transcript':
      return '逐字稿';
    case 'audio':
      return '音訊';
    case 'video':
      return '影片檔';
    case 'portable':
      return '可攜式套件';
    case 'project':
      return '專案檔';
    default:
      return kind;
  }
}

function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean; dir?: string | null }): string {
  // 文件放进指定目录：导入视频的照常说完，再说文件放在哪。
  if (p.dir && (p.target === 'create' || p.target === 'video')) return `${linkImportAfter({ ...p, dir: null })}，下載的檔案儲存在 ${p.dir}`;
  const recognition = `${p.language ? `，語言 ${p.language}` : ''}${p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : ''}`;
  if (p.target === 'create') {
    return `，建立影片${p.name ? `「${p.name}」` : '（以頁面標題命名）'}並加入時間軸${p.transcribe ? `，然後轉錄${recognition}${p.captions ? '並建立字幕圖層' : ''}` : ''}`;
  }
  if (p.target === 'video') return `，匯入影片${p.transcribe ? '並轉錄' : ''}`;
  if (p.target === 'project') return `，儲存到專案的 downloads/${p.transcribe ? ' 並轉錄成 TXT 和 SRT' : ''}`;
  if (p.target === 'download') return `，儲存到下載資料夾${p.transcribe ? '並轉錄成 TXT 和 SRT' : ''}`;
  if (p.target === 'folder') return `，儲存到 ${p.dir}${p.transcribe ? '並轉錄成 TXT 和 SRT' : ''}`;
  return '';
}

function linkImportCookies(p: { cookies: string | null }): string {
  return p.cookies ? `；讀取 ${p.cookies} 的網站登入資訊（Cookie）` : '';
}

export const zhHant: RcAgentToolsMessages = {

  instructionsNotSet: '尚未設定對話指示：Runtime 組裝順序錯誤',
  listSeparator: '、',
  clauseSeparator: '；',

  createVideoSummary: (p) => `建立影片「${p.name}」`,
  slidesImportAssetSummary: (p) => `將「${p.file}」匯入投影片「${p.deck}」`,
  designImportAssetSummary: (p) => `將「${p.file}」匯入設計稿「${p.canvas}」`,
  designSystemImportAssetSummary: (p) => `將「${p.file}」匯入設計系統「${p.system}」`,
  docsEditSummary: (p: { doc: string }) => `編輯文件「${p.doc}」`,
  docsCreateSummary: (p: { doc: string }) => `建立文件「${p.doc}」`,
  docsCommentSummary: (p: { doc: string }) => `在文件「${p.doc}」中留言`,
  docsDeleteSummary: (p: { doc: string }) => `從文件「${p.doc}」中刪除`,
  docsUploadSummary: (p: { file: string; doc: string }) => `將「${p.file}」匯入文件「${p.doc}」`,
  docsExportSummary: (p: { file: string; doc: string }) => `將文件「${p.doc}」匯出為 Markdown：「${p.file}」`,
  editsSummary: (p) => `${p.label}（${p.count} 個操作：${p.types}）`,
  captionsSummary: (p) => `為文件 ${p.documentId} 新增${p.bilingual ? '雙語' : ''}字幕層`,
  captionsLabel: '新增字幕層',
  undoSummary: (p) => `還原修改 ${p.transactionId}`,
  undoLatestSummary: '還原最近一次修改',
  saveVersionSummary: (p) => `把目前狀態儲存為版本「${p.name}」`,
  restoreVersionSummary: (p) => `回到版本 ${p.version}`,
  restoreBeforeVersionSummary: (p) => `回到版本 ${p.version} 之前`,
  deleteVideoSummary: (p) =>
    `刪除影片「${p.name}」（${p.path}）：移到垃圾桶，${p.days} 天內可在 Space 中回復。連結素材的原始檔案保留在原處`,
  importPackageSummary: (p) => `開啟可攜式套件 ${p.file}`,
  renameVideoLabel: '重新命名影片',
  putDocumentSummary: (p) => `寫入文件 ${p.documentId} 的新版本`,
  newDocumentSummary: (p) => `建立文件（${p.kind}）`,
  updateDocumentLabel: (p) => `更新文件「${p.name}」`,
  newDocumentLabel: (p) => `建立文件「${p.name}」`,
  translationDocumentName: (p) => `${p.language} 譯文`,
  importAssetSummary: (p) => `匯入素材 ${p.name}${p.place ? ' 並加入時間軸' : ''}`,
  importAssetLabel: (p) => `匯入 ${p.name}${p.place ? ' 並加入時間軸' : ''}`,
  openMediaSaveSummary: (p) => `從 ${p.source} 下載「${p.title}」（${p.license}）到 ${p.target}（名稱重複時加上編號，不會覆寫）`,
  openMediaDownloadSummary: (p) => `從 ${p.source} 下載「${p.title}」（${p.license}）並匯入${p.place ? '，加入時間軸' : ''}`,
  sfxSummary: (p) => `產生音效「${p.recipe}」並匯入${p.place ? '，放到時間軸上' : ''}`,
 
  replaceCompositionSummary: (p) => `匯入 ${p.name}，取代時間軸上的片段 ${p.clip}`,
  replaceCompositionLabel: (p) => `將程式碼畫面取代為 ${p.name}`,
  pruneAssetsSummary: (p) => `從影片裡刪掉沒有用到的素材（${p.count} 個）：${p.names}`,
  pruneAssetsLabel: (p) => `清理沒有用到的素材（${p.count} 個）`,
  adoptChaptersSummary: (p) => `採用 ${p.asset} 來源附帶的章節（${p.count} 個）${p.existing ? `，取代現有的 ${p.existing} 個章節` : ''}`,
  adoptChaptersLabel: '採用來源章節',

  transcribePurpose: (p) => `轉錄素材 ${p.assetId}`,
  transcribeSummary: (p) => `轉錄素材 ${p.assetId}${p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : ''}`,
  speechPurpose: (p) => `合成語音（${p.chars} 字）`,
  speechSummary: (p) => `合成語音（${p.chars} 字${p.provider ? `，${p.provider}` : ''}${p.voice ? `，音色 ${p.voice}` : ''}）`,
  imageInputsSpaceUnavailable: 'Space 目錄還沒有準備好，不能按項目給輸入圖',
  imageInputsPurpose: (p) => `依 ${p.inputs} 張輸入圖生成圖片：${p.prompt}`,
  imagePurpose: (p) => `生成圖片：${p.prompt}`,
  musicPurpose: (p: { style: string }) => `生成音樂：${p.style}`,
  musicSummary: (p: { mode: string; seconds: number | null; provider: string | null; style: string }) => `生成${p.mode === 'song' ? '歌曲' : '純音樂'}${p.seconds ? `，最長 ${p.seconds} 秒` : ''}${p.provider ? `，${p.provider}` : ''}：${p.style}`,
  imageSummary: (p) => `生成 ${p.count} 張圖片${p.size ? `，${p.size}` : ''}${p.provider ? `，${p.provider}` : ''}：${p.prompt}`,
  cancelJobSummary: (p) => `取消任務 ${p.jobId}`,
  retryPipelineSummary: (p) => `從失敗的步驟重新執行流程 ${p.jobId}（${p.pipeline}，第 ${p.attempt} 次嘗試）`,
  saveArtifactSummary: (p) => `將產出 ${p.artifactId} 儲存為 ${p.path}`,
  overwriteArtifactSummary: (p) => `用產出 ${p.artifactId} 覆寫現有檔案 ${p.path}`,

  exportSummary: (p) => {
    const range = p.rangeStart !== null ? `，${p.rangeStart}–${p.rangeEnd} 秒` : p.rangeCount !== null ? `，${p.rangeCount} 段` : '';
    const size =
      p.width !== null && p.height !== null
        ? `，${p.width}×${p.height}`
        : p.width !== null
          ? `，寬 ${p.width}`
          : p.height !== null
            ? `，高 ${p.height}`
            : '';
    const source = p.originalOnly ? '，僅原聲' : p.dubGroupId ? `，僅配音 ${p.dubGroupId}` : '';
    return `匯出${exportKindLabel(p.kind)}（${p.format}${range}${size}${source}）${p.fileName ? `為 ${p.fileName}` : ''}${p.overwrite ? '，覆寫現有檔案' : ''}`;
  },

  installToolSummary: (p) =>
    `從 ${p.url} 安裝 ${p.tool} ${p.version}（${p.estimated ? `約 ${p.size}` : p.size}，${p.license}），用於從連結下載影片；從 ${p.host} 下載需要它`,
  linkImportSummary: (p) => `使用 ${p.tool}${p.version ? ` ${p.version}` : ''} 從 ${p.host} 下載：${p.url}${linkImportAfter(p)}${linkImportCookies(p)}`,
  linkImportConsentSummary: (p) =>
    `允許 BaoCut 使用這台電腦上的 ${p.tool}${p.version ? ` ${p.version}` : ''}${p.path ? `（${p.path}）` : ' '}從網站下載影片，並從 ${p.host} 下載：${p.url}${linkImportAfter(p)}${linkImportCookies(p)}`,

  downloadSaveSummary: (p) =>
    `將工作資料夾中的 ${p.source}（${p.size}）複製到下載資料夾：${p.target}（名稱重複時加上編號，不會覆寫）`,

  grantSummary: (p) => `將資料提供給 ${p.recipients}：${p.items}`,
  grantSummaryItem: (p) => `${p.purpose}（${p.maxCalls === null ? '不限次數' : `最多 ${p.maxCalls} 次`}）`,

  testModelSummary: (p) => `檢查本機模型套件 ${p.bundleId}：用固定範例完整執行一次`,
  installModelSummary: (p) =>
    `下載本機模型 ${p.bundleId}：${p.estimated ? `約 ${p.size}（大小不明，為估計值）` : p.size}${p.resumed ? `，從已下載的 ${p.resumed} 處續傳` : ''}，來源為 ${p.source}（${p.parts}）`,

  registerProjectSummary: (p) => `將現有資料夾 ${p.path} 登記為專案${p.name ? `（${p.name}）` : ''}`,
  createProjectSummary: (p) => `建立專案資料夾 ${p.path}${p.name ? `（${p.name}）` : ''}`,
  adoptSessionSummary: (p) => `建立專案${p.name ? `「${p.name}」` : '（以第一部影片命名）'}，把這個對話的影片與檔案移進去`,
  deriveVideoSummary: (p) => `從這部影片的 ${p.from}–${p.to} 衍生子影片「${p.name}」`,
  deriveVideoLabel: (p) => `從「${p.name}」衍生`,
  derivationDocumentName: '衍生來源',
  deriveRangeEmpty: '對齊到影格之後區間是空的',
  deriveUnsupportedItem: (p) => `區間裡有無法複製到子影片的片段（${p.kind}）`,
  deriveParentUnplaced: '這部影片不在專案或工作階段的資料夾裡，無法在它旁邊建立子影片',
  shotsRangeEmpty: '對齊到影格之後區間是空的',
  shotsRangeTooLong: (p) => `區間超過 ${p.minutes} 分鐘，請分段偵測鏡頭`,
};
