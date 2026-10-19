import type { SkillsMessages } from './skills-copy.ts';

export const tr: SkillsMessages = {
skillsHelp: `Kullanım:
  baocut skills add <folder>       Yerel Skill klasörünü (kökünde SKILL.md ile) <BAOCUT_HOME>/skills
                                   içine kopyala; varsayılan olarak açık
  baocut skills import <source>    GitHub kaynağından Skill içe aktar: owner/repo, depo URL’si veya
                                   …/tree/<branch>/<folder>; varsayılan kapalı, açmadan önce gözden geçirin
    --id <id>                      add ve import için başka id kullan (varsayılan klasör adından
                                   türetilir; id varsa reddedilir, asla üzerine yazılmaz)
  baocut skills enable|disable <id>
                                   Skill aç / kapat: sonraki yeni ajan oturumundan itibaren geçerli
  baocut skills remove <id>        Eklenen veya içe aktarılan Skill sil (yerleşik olanlar silinemez, yalnızca kapatılır)`,
added: 'Eklendi', imported: 'İçe aktarıldı', turnedOn: 'Açıldı', turnedOff: 'Kapatıldı', reviewFirst: (id) => `Önce gözden geçirin (baocut skills read ${id}), sonra baocut skills enable ${id} ile açın`, takesEffectNextSession: 'Sonraki yeni ajan oturumundan itibaren geçerli; devam eden oturumlar etkilenmez', removed: (id, path) => `${id} silindi (${path})`, localSource: (path, addedAt) => `yerel klasör ${path} (${addedAt})`, remoteSource: (url, ref, commit, importedAt) => `${url} (${ref}@${commit}, ${importedAt})`, changed: (verb, id, name, enabled, path, source) => `${verb} ${id} (${name}, ${enabled ? 'açık' : 'kapalı'}) → ${path}${source ? `\nKaynak: ${source}` : ''}`, idFormat: (flag, value) => `${flag} Skill id kabul eder (küçük harf, kısa çizgiyle ayrılmış; baocut skills komutuna bakın): ${value}`,
skillHelp: `Kullanım:
  baocut skill install [--dir <klasör>]… [--agent agents|claude] [--copy]
                                   Harici ajanlar için BaoCut becerisini (BaoCut nasıl kullanılır) yükler. Varsayılan olarak
                                   ~/.agents/skills/baocut (Codex ve diğer ajanlar) ve ~/.claude/skills/baocut (Claude Code)
                                   konumuna, BaoCut uygulamasındaki beceriye bağlantı olarak; uygulamayla birlikte güncellenir
    --dir <klasör>                 Bunun yerine <klasör>/.agents/skills ve <klasör>/.claude/skills konumuna yükler: herhangi
                                   bir klasör, yalnızca BaoCut projesi değil; birden çok klasör için tekrarlayın
    --agent agents|claude          İkisinden yalnızca biri: .agents/skills veya .claude/skills
    --copy                         Bağlantı yerine kopyalar (kopya uygulama güncellemelerini izlemez: yeniden yükleyin)
  baocut skill status              Uygulamadaki beceri sürümü, nereye yüklendiği ve her konumun güncel olup olmadığı,
                                   ve terminalinizdeki baocut komutu
  baocut skill remove [--dir <klasör>]… [--agent agents|claude] [--yes]
                                   Kaldırır: bağlantıda yalnızca bağlantı silinir; kopyayı silmek --yes ister.
                                   baocut/ içindeki BaoCut becerisi olmayan şey asla değiştirilmez veya silinmez`,
  installedAt: (path, linkTarget) => `Yüklendi: ${path}${linkTarget ? ` → ${linkTarget}` : ' (kopya)'}`,
  takesEffect: 'Yeni bir ajan oturumunda geçerli olur',
  removedAt: (path) => `Kaldırıldı: ${path}`,
  removeCopies: (paths) =>
    `${paths.join(', ')} ${paths.length === 1 ? 'bir kopya' : 'kopyalar'}: kaldırmak, orada yapılan düzenlemeler dahil dosyaları siler. Silmek için --yes ekleyin`,
  unknownAgent: (value) => `--agent, agents (.agents/skills) veya claude (.claude/skills) alır: ${value}`,
  fixHint: 'Bazı yüklemeler eski veya bozuk: baocut skill install (aynı --dir ile) bunları düzeltir',
  statusSkill: (version, source, bundled) => `Beceri    ${version ?? '?'}  ${source}${bundled ? '' : ' (geliştirme sürümü: Runtime oluşturur)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'pakette yok (geliştirme sürümü)'}`,
  statusOnPath: (path, target, fromApp) => `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (bu uygulamanın)' : ' (bu uygulamanın değil)'}`,
  statusNotOnPath: (command) => `Terminal  baocut PATH'te yok${command ? `; her terminalde kullanmak için: ${command}` : ''}`,
  statusAddToPath: (dir) => `Terminal  baocut PATH'te yok; her terminalde kullanmak için ${dir} klasörünü kullanıcı PATH'inize ekleyin`,
  appOutsideApplications: 'BaoCut Uygulamalar klasöründen çalışmıyor: uygulamayı taşır veya silerseniz bağlantılar bozulur',
  globalHeading: 'Genel',
  state: { none: 'Yüklü değil', current: 'Güncel', stale: 'Eski', broken: 'Bozuk bağlantı', foreign: 'Orada başka bir şey var (dokunulmadı)' },
  mode: { link: 'Bağlantı', copy: 'Kopya' },
};
