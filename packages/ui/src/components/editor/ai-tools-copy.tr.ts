import type { AiToolsMessages } from './ai-tools-copy.ts';

export const tr: AiToolsMessages = {
  back: 'Geri',
  // 设置态
  who: 'Kullan', whoAgent: 'Ajana ver', whoModel: 'Modeli doğrudan çağır', whoModelSub: 'Runtime içinde henüz iş akışı yok; yalnızca ajan yapabilir', scope: 'Kapsam', scopeAll: 'Tüm video', scopeChapter: (index, label) => `Bölüm ${index} · ${label}`, scopeNoChapters: 'Zaman çizelgesinde henüz bölüm yok; yalnızca tüm video kullanılabilir', byAgent: 'Ajan yapar', cta: 'Ajana ver', queued: 'Ajan meşgul · mesaj sırada, bu tur bitince gönderilir', noConversation: 'Bu video proje veya oturumda değil; ajana verilemez.', createFailed: (message) => `Oturum oluşturulamadı: ${message}`,
  // 勾选项与自定义
  prePolish: 'Önce düzelt (otomatik paragraflar)', prePolishOn: 'Bölümler paragrafa göre gruplanır', prePolishOff: 'Düzeltilmemiş dökümde yalnızca 1 paragraf var; bölümler kaba olur', staleEdited: 'Özgün metinde düzenlenmiş cümleler', staleEditedSub: 'Dökümde sözcükleri değiştirdiniz ancak çeviri hâlâ eski', staleCut: 'Özgün metinden kesilmiş cümleler', staleCutSub: 'Kesim cümlenin bir kısmını kaldırdı; kesilmiş kaynaktan yeniden çevir', staleNone: 'En az birini işaretleyin', staleOnly: (language) => `Yalnızca ${language} çevirisi`, retranscribeModel: 'Ajan bu bilgisayarda yüklü konuşma modellerinden seçer; seçmek için aşağıdaki yönergelerde belirtin.', retranscribeSpeakers: 'Yazıya dökmeden sonra konuşmacıları belirle',
  // 写作与发布
  platform: 'Yayın yeri', platformPlaceholder: 'Yayınlanacak platform (isteğe bağlı); platform kurallarını izler ve denetlemenizi hatırlatır', titleCount: 'Adaylar', titleCountNote: (min, max) => `${min}–${max}, her biri farklı açıdan`, coverCount: 'Sayı', coverIdea: 'Söylenecek tek şey', coverIdeaPlaceholder: 'Bu videoya neden tıklasınlar (isteğe bağlı); boş bırakırsanız ajan dökümden bulur', coverRatio: 'En boy oranı', coverRatioProject: 'Video tuvaliyle aynı', coverText: 'Kapak metni',   // 还做不了的
  soon: 'Yakında', chaptersPolishFirst: 'Önce düzeltip paragraflara böl, sonra bölümleri oluştur',

  session: 'Oturum',
  promptLabel: 'Agent’a söylenecekler',
  promptPlaceholder: 'Ne yapılacağı ve nasıl; bölüm veya konuşmacıya @ ile atıf yapın',
  restoreDefault: 'Varsayılana dön',
  skillNote: 'Bu aracın yöntemi',
  noSkill: 'Skill eklenmedi: Agent yalnızca yukarıdaki metne uyar.',
  addSkillBack: 'Bu aracın skill’ini geri ekle',
  sentNew: 'Agent’a verildi · yeni oturum',
  sentCurrent: 'Agent’a verildi · mevcut oturumda devam',
  agentCardTitle: 'Aşağıda olmayan işler için Agent’a tek cümle yeter',
  agentCardSomeAgent: 'Agent',
  agentCardOutside: 'Bu videonun oturumunu açar, video bağlam olur →',
  noTranscriptTitle: 'Bu videonun henüz dökümü yok',
  noTranscriptBody: 'Buradaki araçların hepsi dökümden başlar: düzeltme, bölümler, özet ve başlık için önce döküm gerekir.',
  goTranscribe: 'Döküme git',
  stateRunning: 'Çalışıyor',
  stateReview: 'İncelenecek',
  agentCardNew: (agent) => `Bu videoyu bağlam alan yeni bir oturum açar; bu bilgisayardaki ${agent} içinde çalışır ve yazmadan önce sorar →`,
  stateChapters: (count) => `${count} bölüm`,
};
