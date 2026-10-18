import type { ProjectsMessages } from './projects-copy.ts';

export const tr: ProjectsMessages = {
  help: `Kullanım:
  baocut projects git-status [<proje>]
                                   Projenin git durumu: depo, dal, BaoCut'ın commit yapıp yapamayacağı
                                   ve neden duraklatıldığı (commit için baocut projects git-commit)
  baocut projects git-init [<proje>]
                                   Proje klasöründe git'i başlatır (ana klasörde, standart bir kullanıcı klasöründe,
                                   bir birimin kökünde ya da başka bir deponun içinde değil)
  baocut projects git-allow [<proje>] [--yes]
                                   Deponun yerel yapılandırmasındaki filtreleri ve include'ları gösterir, sonra onlara
                                   izin verir: BaoCut onları çalıştıran git komutlarını ancak bundan sonra çalıştırır
  <proje> bir proje kimliği, adı ya da klasörüdür; verilmezse geçerli klasörü içeren proje`,
  noProject: (cwd) => `${cwd} klasörünü içeren proje yok. Bir proje kimliği, adı ya da klasörü verin (baocut projects list)`,
  unknownProject: (text) => `Proje bulunamadı: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `${text} adında birden fazla proje var; kimliğini verin`,
  states: {
    ready: 'hazır',
    paused: 'duraklatıldı',
    'not-repo': 'git deposunda değil',
    unavailable: 'git kullanılamıyor',
    error: 'hata',
  },
  head: (name, id) => `Proje ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Dal: ${branch}`,
  detached: 'Dal: (ayrık HEAD)',
  version: (version) => `git sürümü: ${version}`,
  repo: (root) => `Depo: ${root}`,
  autoCommit: (on) => `Otomatik commit: ${on ? 'açık' : 'kapalı'}`,
  lastCommit: (commit, auto, at) => `Son commit: ${commit.slice(0, 12)} (${auto ? 'otomatik' : 'elle'}, ${at})`,
  lastError: (message) => `Son hata: ${message}`,
  entriesHead: "Yerel filtreler ve include'lar:",
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Gözden geçirin, sonra izin vermek için baocut projects git-allow komutunu çalıştırın',
  initDone: (root) => `${root} içinde git başlatıldı`,
  nothingToAllow: 'Bu depoda izin bekleyen yerel filtre ya da include yok',
  allowPrompt: 'Bu girdilere izin verilsin mi? BaoCut onları çalıştıran git komutlarını çalıştıracak [y/N] ',
  notTtyAllow: 'Terminalde değil: girdileri baocut projects git-status ile gözden geçirin, sonra --yes ile yeniden çalıştırın',
  notAllowed: "İzin verilmedi: BaoCut'ın bu depodaki commit'leri duraklatılmış kalıyor",
  allowed: 'İzin verildi: BaoCut bu depoya yeniden commit yapıyor',
};
