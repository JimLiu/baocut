import type { RcGitMessages } from './rc-git.ts';

export const nl: RcGitMessages = {
  gitPurpose: 'Commit de BaoCut-bestanden van een project in git (optioneel)',
  gitMissingRemedyMac: 'Installeer git: voer xcode-select --install uit in Terminal voor de Command Line Tools, of installeer het met Homebrew (brew install git)',
  gitMissingRemedyWin: 'Installeer Git for Windows via https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Installeer git met je pakketbeheerder',
  xcodeStub: '/usr/bin/git biedt alleen aan de Command Line Tools te installeren zolang die niet geïnstalleerd zijn',

  notRepo: 'Dit project staat niet in een git-repository',
  initRemedy: 'Voer baocut projects git-init uit in de projectmap, of voer zelf git init uit waar je de repository wilt hebben',
  initHome: 'BaoCut maakt geen git-repository in je thuismap: voor andere tools zou elke map daarin bij één repository lijken te horen',
  initUserFolder: (p) =>
    `BaoCut maakt geen git-repository in een standaard gebruikersmap (${p.path}): voor andere tools zou elke map daarin bij één repository lijken te horen`,
  initVolumeRoot: 'BaoCut maakt geen git-repository in de hoofdmap van een volume of station',
  initInsideRepo: 'Dit project staat al in een git-repository',
  initElsewhere: 'Zet het project eerst in een eigen map, of voer zelf git init uit waar je de repository wilt',
  pausedLocked: 'De repository wordt gebruikt door een ander git-commando (index.lock bestaat)',
  lockedRemedy:
    'Laat het andere git-commando eerst klaar zijn. BaoCut probeert het opnieuw bij de volgende commit en verwijdert het lockbestand nooit; draait er geen git-commando, verwijder de lock dan zelf',
  pausedMerge: 'De repository zit midden in een merge',
  pausedRebase: 'De repository zit midden in een rebase',
  pausedCherryPick: 'De repository zit midden in een cherry-pick',
  pausedRevert: 'De repository zit midden in een revert',
  pausedBisect: 'De repository zit midden in een bisect',
  pausedDetached: 'HEAD is losgekoppeld (de repository staat niet op een branch)',
  repoStateRemedy: 'Rond het af of breek het af in git; daarna commit BaoCut weer',
  detachedRemedy: 'Schakel in git over naar een branch; daarna commit BaoCut weer',
  pausedLocalConfig:
    'De lokale configuratie van de repository voert programma’s uit of neemt andere bestanden op (filters of include), dus BaoCut voert geen git-commando’s uit die je bestanden lezen',
  pausedLocalConfigChanged: 'De lokale filters of includes van de repository zijn gewijzigd nadat je ze toestond, dus BaoCut heeft zijn commits weer gepauzeerd',
  localConfigRemedy: 'Bekijk de items en de commando’s die ze uitvoeren, en sta ze daarna toe met baocut projects git-allow',
  gitFailed: (p) => `git is mislukt in deze repository: ${p.detail}`,

  manageOnlyInAppOrCli: 'Alleen de desktop-app of de CLI kan git initialiseren of lokale filters toestaan',
  digestChanged: 'De lokale configuratie is gewijzigd nadat die is bekeken; bekijk de items opnieuw',
  commitFailed: (p) => `Committen naar git is mislukt: ${p.detail}`,
  initFailed: (p) => `git initialiseren is mislukt: ${p.detail}`,

  commitSummary: (p) => `BaoCut-bestanden in project "${p.name}" naar git committen`,
  commitTitle: (p) => `BaoCut: ${p.names} bijwerken`,
};
