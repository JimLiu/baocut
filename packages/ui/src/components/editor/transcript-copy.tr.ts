import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';


function secondsLabel(seconds: number): string { return seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1).replace('.', ',')} sn` : `${Math.round(seconds)} sn`; }

export const trSeconds = secondsLabel;

export const trTranscript: TranscriptMessages = {
  title: "Döküm",
  modes: "Döküm düzenleme modu",
  modeEdit: "Metni düzenle",
  modeCut: "Medyayı kes",

  hintEdit: "Yalnızca döküm metni değişir; görüntü ve ses aynı kalır. Sözcüğü çift tıklayıp düzenleyin; ⌫ yalnızca metni siler.",
  hintCut: "Metin seçip ⌫ basın; video, ses ve altyazılar birlikte kesilir. Kesilen sözcükler üstü çizili kalır, geri yüklenebilir.",

  emptyTitle: "Henüz döküm yok",
  emptyNoMedia: "Önce video veya ses dosyası ekleyin. Yazıya dökülünce sözcükler burada görünür.",
  emptyNotPlaced: "Video veya ses henüz zaman çizelgesinde değil. Yerleştirip yazıya dökün; döküm burada görünür.",
  emptyNotTranscribed: "Zaman çizelgesindeki medya yazıya dökülmedi. Altyazı panelinde yazıya dökün; döküm burada görünür.",
  gotoSubtitle: "Altyazı kısmında yazıya dök",
  addMedia: "Medya ekle",
  loading: "Transkript yükleniyor…",
  noWords: "Bu dökümde gösterilecek sözcük yok.",
  notSpeech: "Bu dökümün biçimi tanınmıyor.",


  stats: (count, cut) => cut ? `${count} sözcük · ${cut} kesildi` : `${count} sözcük`,
  jump: "Buraya git",
  cutWordTitle: "Zaman çizelgesinden kes",
  partialWordTitle: "Kesim bu sözcüğün içinde; yalnızca bir kısmı zaman çizelgesinde kaldı",

  // 选区条
  selected: (count, seconds) => seconds === null ? `${count} sözcük seçildi` : `${count} sözcük seçildi · ${secondsLabel(seconds)}`,
  cut: "Kes",
  restore: "Geri yükle",
  editWord: "Sözcüğü düzenle",
  deleteText: "Metni sil",
  clear: "Seçimi kaldır · Esc",
  aiFind: "Kesim bul",
  aiFindHint: "Veya önce dolgu sözcüklerini ve duraklamaları AI bulsun",

  // 结果
  cutDone: (seconds, ranges) => ranges > 1 ? `${secondsLabel(seconds)} kesildi · ${ranges} aralık` : `${secondsLabel(seconds)} kesildi`,
  cutNothing: "Seçilen sözcükler artık zaman çizelgesinde değil; kesilecek bir şey yok.",
  cutTooShort: "Seçim bir kareden kısa; kesilemez.",
  restoreDone: (seconds) => `${secondsLabel(seconds)} geri yüklendi`,
  restoreNotRelaid: "Bazı kesimlerin zaman çizelgesinde eşleşen birleşimi yok. Kesim listesinden kaldırıldı ancak içerik geri konmadı.",
  restoreRefused: {
    untracked: "Bu aralık kesimle kaldırılmadı (örneğin klip kenarı sürüklenerek kısaltıldı); geri yüklenecek kesim yok. Geri getirmek için zaman çizelgesinde klip kenarını sürükleyin.",
    partial: "Aralığın yalnızca bir kısmı kesimle kaldırıldı; aralık değiştirilemez. Önce kesim bandına tıklayıp o kısmı geri yükleyin.",
  },
  textSaved: "Metin güncellendi · video ve ses değişmedi",
  textDeleted: (count) => `${count} sözcüğün metni silindi · video ve ses değişmedi`,

  stale: (count) => `${count} altyazı izi eski dökümden yapıldı ve güncellenmedi.`,
  gotoCaptions: "Altyazıları aç",
  undo: "Geri al",

  // 时间线剪口
  seamLabel: (seconds) => `${secondsLabel(seconds)} kesildi · geri yüklemek için tıklayın`,
  cutLabel: "Dökümde kes",
  restoreLabel: "Kesilen içeriği geri yükle",
  liveCopy: "Şimdiye kadar dökülen kısmı kopyala",
  liveCopied: "Şimdiye kadar dökülen kısım kopyalandı · yazıya dökme sürüyor",
  liveSpeaker: "Tanınıyor",
  liveWaiting: "Tanınan metin geldikçe burada görünür. Bazı hizmetler hepsini sonunda birlikte döndürür.",
  liveNote: "Tanınan metin paragraf paragraf görünür. Yazıya dökme bitince düzenleyebilirsiniz.",
  liveJump: "En yeniye git",
  liveSaving: "Döküm kaydediliyor",
};

export const trTranscriptTools: TranscriptToolsMessages = {
  // 查找替换
  findTip: "Bul ve değiştir · ⌘F",
  findLabel: "Bul ve değiştir",
  findPlaceholder: "Dökümde bul",

  lockTranslation: "Çeviriler aranabilir ancak burada düzenlenemez; Döküm paneli yalnızca kaynağı düzenler",
  lockLoading: "Dökümün yeni sürümü hâlâ yükleniyor; bitince değiştirin",
  replaceLabel: "Döküm metnini değiştir",
  replaceDone: (count) => `${count} eşleşme değiştirildi · video ve ses değişmedi`,
  replaceNothing: "Değiştirilecek eşleşme yok",

  // 复制
  copyMenu: "Dökümü kopyala",
  copyAllHead: (lang) => `Tümünü kopyala · ${lang}`,
  copyText: "Metni kopyala",
  copySettings: "Kopyalama ayarları",
  copyWithSettings: "Ayarlarla kopyala",
  copyTextOnly: "Yalnızca metni kopyala",
  textOnly: "Yalnızca metin",
  keepCut: "Kesilen kısımlar dahil",
  copyConfirm: "Kopyala",
  copyTranslationOnly: "Yalnızca çeviri gösteriliyor, bu yüzden panelden kopyalanır: ön bilgi yazılmaz, kesilen kısımlar yer almaz.",
  copyScopeHead: (scope) => `Kopyala: ${scope}`,
  copied: (scope, receipt) => `Kopyalandı: ${scope} · ${receipt}`,
  copyFailed: "Kopyalanamadı · tarayıcı pano erişimini reddetti",
  copyEmpty: "Kopyalanacak bir şey yok",
  scopeAll: "tümü",
  scopePara: "bu paragraf",
  scopeChapter: (title: string) => `“${title}”`,
  scopeSelection: "seçilen metin",
  copySelection: "Kopyala",
  copySelectionTip: "Seçilen metni kopyala · ⌘C",

  // 语言视图（设计稿 `langShort` 与「文稿语言」菜单）
  langLabel: "Döküm dili",
  langSource: "Özgün",
  langTranslation: "Çeviri",
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: "Kaynağı yanında göster",
  showBothNeedsTranslation: "Önce çeviri seçin",
  showBothHint: "Yan yana",
  noTranslation: "Henüz çeviri yok",
  noTranslationHint: "Altyazı panelinde “+ … diline çevir” ile çevirin",
  translationNote: "Çeviriler oynatmayı yalnızca paragraf bazında izler. Sözcük zamanları yalnızca kaynakta vardır; sözcük vurgusu uydurma olur.",
  translationOnly: "Yalnızca çeviriye bakarken düzenleme veya kesim yapılamaz; kaynağa veya yan yana görünüme dönün.",
  noParagraphTranslation: "Bu paragrafın çevirisi yok",

  // 段落行（设计稿 `ParaRow`）
  paraMenu: "Bu paragraf…",
  moveUp: "Önceki bölüme taşı",
  moveDown: "Sonraki bölüme taşı",
  play: "Paragrafı oynat",
  moveHead: "Bölüme taşı",
  moveTo: (title) => `Taşı: “${title}”`,
  moveWith: (count) => count > 1 ? `O taraftaki komşularıyla birlikte taşınır, toplam ${count} paragraf` : 'Yalnızca bu paragraf taşınır',

  noPrev: "Bu paragraftan önce bölüm yok",
  noNext: "Bu paragraftan sonra bölüm yok",
  moveBlocked: "Taşımak bu bölümü boş bırakır veya komşu bölümün başlangıcını aşar",
  moveLabel: "Paragrafı komşu bölüme taşı",
  moved: (title, count) => count > 1 ? `${count} paragraf “${title}” bölümüne taşındı` : `“${title}” bölümüne taşındı`,
  cutPara: "Bu paragrafı kes",
  cutParaHint: "Video, ses ve altyazıyı birlikte keser; geri yüklenebilir",

  // 章节头「这一章…」
  chapterMenu: "Bu bölüm…",
  renameChapter: "Yeniden adlandır…",
  cutChapter: "Bu bölümü kes",
  cutChapterHint: "Video, ses ve altyazıyı birlikte keser; sonraki bölümler erkene gelir",
  cutChapterLabel: "Bölümü kes",
  cutChapterRefused: {
    empty: "Bu bölümün süresi yok",
    whole: "Bu bölüm tüm videodur; kesmek hiçbir şey bırakmaz",
    'no-tracks': "Zaman çizelgesindeki izler döküm medyasını kullanmıyor; kesilecek bir şey yok",
  },
  cutChapterDone: (title, seconds) => `“${title}” kesildi · ${secondsLabel(seconds)}`,
  removeMarker: "Bölüm işaretini sil",
  removeMarkerHint: "Yalnızca işareti siler; içerik kalır",
  find: "Bul",
  badRegex: "Geçersiz regex",
  noResults: "Sonuç yok",
  previous: "Önceki",
  next: "Sırada",
  closeFind: "Aramayı kapat",
  replaceWith: "Şununla değiştir:",
  matchCase: "Büyük/küçük harf duyarlı",
  wholeWordShort: "Sözcük",
  wholeWord: "Tam sözcük eşleştir",
  regex: "Düzenli ifade · değiştirme metni olduğu gibi eklenir",
  replace: "Değiştir",
  replaceAll: "Tümünü değiştir",
  regexError: (error) => `Regex hatası: ${error}`,
};
