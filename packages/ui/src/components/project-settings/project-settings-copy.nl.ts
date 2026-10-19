import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const nl: ProjectSettingsMessages = {
  menuItem: 'Projectinstellingen…',
  title: 'Projectinstellingen',
  close: 'Projectinstellingen sluiten',
  done: 'Klaar',
  loading: 'git controleren',
  loadFailed: (message: string) => `Kan git niet controleren: ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut kan de werkruimtemomentopnamen van je video’s committen naar de git-repository waarin het project staat. De versiegeschiedenis heeft git niet nodig en werkt buiten een repository precies hetzelfde.',
  branch: (name: string) => `Branch ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Opnieuw controleren',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Gereed',
  lightPaused: (label: string) => `Gepauzeerd · ${label}`,
  lightNotRepo: 'Niet in een git-repository',
  lightUnavailable: 'git niet gevonden',
  lightError: 'git mislukt',
  pauseLocked: 'Repository in gebruik',
  pauseMerge: 'Merge bezig',
  pauseRebase: 'Rebase bezig',
  pauseCherryPick: 'Cherry-pick bezig',
  pauseRevert: 'Revert bezig',
  pauseBisect: 'Bisect bezig',
  pauseDetached: 'HEAD losgekoppeld',
  pauseLocalConfig: 'Lokale filters',
  pauseLocalConfigChanged: 'Lokale filters gewijzigd',

  pausedHeading: (label: string) => `Commits gepauzeerd: ${label}`,
  pausedNote:
    'Zolang commits gepauzeerd zijn, wachten automatisch committen en ‘Committen naar git’. Openen, bewerken en de versiegeschiedenis worden niet beïnvloed.',
  errorHeading: 'git mislukt',
  unavailableHeading: 'git niet gevonden',

  lcEntry: 'Item',
  lcValue: 'Commando of opgenomen bestand',
  lcExplain:
    'Nadat je ze toestaat, volgt BaoCut deze items wanneer het git uitvoert (bijvoorbeeld voor versleuteling met git-crypt). De toestemming wordt alleen op deze computer opgeslagen, niet in het project, en BaoCut pauzeert opnieuw als de items of de opgenomen bestanden wijzigen. Dit is geen vertrouwen in de map: openen, bewerken en de agent worden niet beïnvloed.',
  lcWeb:
    'Deze items worden alleen getoond, en kunnen alleen worden toegestaan, in de projectinstellingen van de BaoCut-desktopapp (of met baocut projects git-allow). Zolang commits gepauzeerd zijn, worden openen, bewerken en de versiegeschiedenis niet beïnvloed.',
  allow: 'Toestaan',
  allowedTitle: 'Lokale filters toegestaan',
  allowedText: 'De toestemming is op deze computer opgeslagen, niet in het project. Je kunt nu committen.',
  allowFailed: 'Niet toegestaan',

  commit: 'Committen naar git',
  committing: 'Bezig met committen',
  commitDesc: (maxMiB: number) =>
    `Commit alleen de bestanden van BaoCut: de werkruimtemomentopnamen van gewijzigde video’s en media tot ${maxMiB} MiB. Andere bestanden in het project en wijzigingen die je al hebt gestaged, blijven zoals ze zijn. BaoCut pusht niet.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Laatste commit ${commit} · ${auto ? 'automatisch' : 'handmatig'} · ${ago}`,
  lastFailed: (message: string) => `Laatste poging mislukt: ${message}`,
  committedTitle: 'Gecommit naar git',
  committedText: (commit: string, files: number, videos: string[]) =>
    `${commit} gecommit: ${files === 1 ? '1 bestand' : `${files} bestanden`}${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `‘${name}’` : from === to ? `‘${name}’ versie ${to}` : `‘${name}’ versies ${from}–${to}`,
  unnamedVideo: 'een video',
  nothingTitle: 'Niets te committen',
  nothingText: 'De bestanden van BaoCut zijn hetzelfde als bij de laatste commit.',
  commitFailed: 'Niet gecommit',

  autoCommit: 'Automatisch committen',
  autoCommitDesc:
    'Commit één keer wanneer het project 5 minuten rustig is geweest, wanneer je de laatste open video van het project sluit of wanneer je BaoCut afsluit. Alle projecten op deze computer delen deze instelling.',

  initTitle: 'git initialiseren',
  initDesc: 'Maak een git-repository in de projectmap, zodat je er momentopnamen naar kunt committen.',
  initWebNote: 'Alleen de BaoCut-desktopapp of de CLI (baocut projects git-init) kan een repository maken in een map op de computer van de Runtime.',
  initRefused: (why: string) => `Hier niet beschikbaar: ${why}`,
  initRefusedNote: 'Heb je er een nodig, zet de video’s dan in een eigen projectmap en initialiseer git daar.',
  refusalHome: 'het project is je thuismap. Met een repository hier zou voor andere tools elke map in je thuismap erbij lijken te horen.',
  refusalUserFolder:
    'het project is een standaard gebruikersmap (zoals Bureaublad, Documenten, Downloads, Films, Muziek of Afbeeldingen). Met een repository hier zou voor andere tools elke map daarin erbij lijken te horen.',
  refusalVolumeRoot: 'het project is de hoofdmap van een schijf. Met een repository hier zou de hele schijf erbij lijken te horen.',
  refusalInsideRepo: 'het project staat al in een git-repository.',
  initConfirmTitle: 'git initialiseren in de projectmap?',
  initConfirmBody: (path: string) =>
    `Maakt een git-repository in ${path}. De negeerregels van BaoCut komen in de eigen .git/info/ van de repository, dus er verandert geen bestand in het project. Er wordt niets gecommit of gepusht.`,
  cancel: 'Annuleren',
  initDoneTitle: 'git geïnitialiseerd',
  initDoneText: 'Er is nog niets gecommit. Gebruik ‘Committen naar git’ voor de eerste commit.',
  initFailed: 'Niet geïnitialiseerd',

  recheckSame: 'Er is niets veranderd',
  recheckReadyTitle: 'Klaar om te committen',
  recheckReadyText: 'De repository is niet meer gepauzeerd.',

  outsideHeading: 'Media buiten het project',
  outsideLead:
    'Als een video media buiten de projectmap gebruikt, legt de werkruimtemomentopname het pad van die media vast (beginnend met ~/ onder je thuismap, anders een volledig pad). Nadat je commit of pusht, krijgen anderen alleen het pad, niet het bestand. Gebruik een draagbaar pakket om de media ook over te dragen.',

  stripLabel: 'Project-git',
  projectSettings: 'Projectinstellingen',
};
