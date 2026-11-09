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
  appOutsideApplications: 'BaoCut Uygulamalar klasöründen çalışmıyor: uygulamayı taşır veya silerseniz bağlantılar bozulur',
  globalHeading: 'Genel',
  state: { none: 'Yüklü değil', current: 'Güncel', stale: 'Eski', broken: 'Bozuk bağlantı', foreign: 'Orada başka bir şey var (dokunulmadı)' },
  mode: { link: 'Bağlantı', copy: 'Kopya' },

  cliHelp: `Kullanım:
  baocut cli install               baocut'ı PATH'e koyar; BaoCut uygulamasındaki komut satırına işaret eder. macOS:
                                   ~/.local/bin/baocut konumunda bir bağlantı. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd,
                                   bu klasör kullanıcı PATH'inize eklenir. Yönetici hakları gerekmez
  baocut cli status                baocut'ın nerede olduğu, bu uygulamaya işaret edip etmediği ve terminalinizin hangi
                                   baocut'ı bulduğu
  baocut cli remove                baocut cli install'ın koyduğunu kaldırır. O konumda BaoCut'ın koymadığı bir şey asla
                                   değiştirilmez veya silinmez`,
  cliStatusEntry: (path, target, state) => `Komut     ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry) => `Uygulama  ${entry ?? 'paketle gelen komut satırı yok (geliştirme sürümü): BaoCut uygulamasından yükleyin'}`,
  cliStatusTerminal: (found) => `Terminal  ${found ?? 'baocut bulunamadı'}`,
  cliStatusUnchecked: "Terminal  terminalinizin PATH'i denetlenemedi: yeni bir terminal açıp baocut version çalıştırın",
  cliShadowed: (found, dir) => `Terminal  önce ${found} bulunuyor. Bunu kullanmak için onu kaldırın ya da ${dir} klasörünü PATH'te daha öne alın`,
  cliPathHint: (dir, line, file) =>
    `${dir} henüz terminalinizin PATH'inde değil. Bu satırı ${file ? `${file} dosyasına` : 'kabuk yapılandırmanıza'} ekleyin, ardından yeni bir terminal açın:\n  ${line}`,
  cliInstalled: (path, target) => `Yüklendi: ${path} → ${target}`,
  cliWindowsPath: (dir) => `${dir} kullanıcı PATH'inizde: baocut'ı kullanmak için yeni bir terminal açın`,
  cliRemoved: (path) => `Kaldırıldı: ${path}`,
  cliNothingToRemove: (path) => `${path} konumunda kaldırılacak bir şey yok`,
  cliInstallHint: "baocut cli install, baocut'ı PATH'e koyar",
  cliFixHint: 'baocut cli install onu bu uygulamaya yönlendirir',
  cliState: { none: 'Yüklü değil', current: 'Bu uygulamaya işaret ediyor', stale: "Başka bir BaoCut'a işaret ediyor", broken: 'Artık var olmayan bir konuma işaret ediyor', foreign: 'Orada başka bir şey var (dokunulmadı)' },
};
