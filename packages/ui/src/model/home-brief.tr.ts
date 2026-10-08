import type { HomeBriefMessages } from './home-brief.ts';

export const tr: HomeBriefMessages = {
about: (minutes, seconds) => `Yaklaşık ${[minutes ? `${minutes} dk` : '', seconds ? `${seconds} sn` : ''].filter(Boolean).join(' ')}`, fromMaterials: 'Eklediğim malzemelerden video oluştur.', materials: (paths) => `Malzemeler: ${paths.join(', ')}`, connectFirst: 'Önce AI bağlayın', sayFirst: 'Ne oluşturmak istediğinizi söyleyin veya malzeme ekleyin', agentOffTitle: 'Yüklü tüm kodlama ajanları kapalı', agentOffBody: 'Bu bilgisayarda kodlama ajanı yüklü ancak Ayarlar kısmında kapalı. Buradan başlamak için birini açın.', enableNamed: (name) => `Etkinleştir: ${name}`, enableAgent: 'Ajanı aç', agentMissingTitle: 'Kodlama ajanı gerekiyor', agentMissingBody: 'Claude Code veya Codex CLI yükleyip kendi aboneliğinizle giriş yapın, sonra başlamak için buraya dönün.', connectAgent: 'Ajan bağla', nameEmpty: 'Proje adı girin', nameInvalid: 'Proje adı eğik çizgi veya denetim karakteri içeremez',
};
