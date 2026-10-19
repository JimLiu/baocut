import type { VideoVersionsMessages } from './video-versions-copy.ts';

export const nl: VideoVersionsMessages = {
  title: 'Geschiedenis',
  close: 'Geschiedenis sluiten',
  tipRevision: (revision: string) => `Revisie ${revision}`,
  viewChanges: 'Wijzigingen',
  tipLatest: (version: number) => `Nieuwste versie: ${version}`,
  tipNone: 'Nog geen versies',
  tipOutside: 'Deze video staat niet in een project',
  loading: 'Versiegeschiedenis laden',
  loadFailed: (message: string) => `Kan de versiegeschiedenis niet laden: ${message}`,
  stateSynced: 'Momentopname bijgewerkt',
  stateSyncedDesc: 'De werkruimtemomentopname in de videomap komt overeen met de huidige inhoud.',
  statePending: 'Momentopname wordt geschreven',
  statePendingDesc: 'Recente wijzigingen komen binnen enkele seconden in de momentopname en de versiegeschiedenis.',
  stateConflict: 'Momentopname en BaoCut allebei gewijzigd',
  stateConflictDesc:
    'De bestanden van de momentopname zijn buiten BaoCut gewijzigd, en BaoCut heeft ook wijzigingen die nog niet in de momentopname staan. BaoCut overschrijft de momentopname pas als je hebt gekozen wat je wilt houden.',
  stateInvalid: 'Momentopname onleesbaar',
  stateInvalidDesc:
    'De bestanden van de momentopname kunnen niet worden verwerkt, dus BaoCut heeft ze niet geïmporteerd. BaoCut controleert opnieuw zodra je ze hebt hersteld, of je overschrijft ze met de inhoud uit BaoCut.',
  stateExternal: 'Externe wijzigingen worden geïmporteerd',
  stateExternalDesc:
    'De bestanden van de momentopname zijn buiten BaoCut gewijzigd (git pull, een synchronisatieschijf of handmatige bewerking) en BaoCut heeft geen andere wijzigingen, dus worden ze geïmporteerd als een versie ‘Externe wijziging’.',
  stateMissing: 'Nog geen momentopname',
  stateMissingDesc: 'De werkruimtemomentopname is nog niet geschreven, of video.json ontbreekt.',
  stateRebuild: 'Moet opnieuw worden opgebouwd',
  stateRebuildDesc: 'Er is alleen de werkruimtemomentopname, zonder videobibliotheek. BaoCut bouwt de video daaruit opnieuw op bij het openen.',
  footer: (keep: number) =>
    `Versies staan in .bcut-snapshot/history/ in de videomap en zijn niet afhankelijk van git. BaoCut bewaart de laatste ${keep} naamloze versies plus alle opgeslagen versies.`,
  save: 'Versie opslaan',
  saveIntro: 'Sla de huidige inhoud op als een versie met een naam. Opgeslagen versies worden nooit automatisch opgeruimd; alleen jij kunt ze verwijderen.',
  nameLabel: 'Naam',
  namePlaceholder: 'Bijvoorbeeld: Montage voor review',
  nameRequired: 'Geef deze versie een naam',
  noteLabel: 'Notitie (optioneel)',
  cancel: 'Annuleren',
  saveSubmit: 'Opslaan',
  conflictIntro:
    'Deze bestanden van de momentopname zijn buiten BaoCut gewijzigd, mogelijk door git pull, een synchronisatieschijf of handmatige bewerking, en BaoCut heeft ook wijzigingen die nog niet in de momentopname staan:',
  conflictOutro:
    'Tot je hebt gekozen wat je wilt houden, overschrijft BaoCut de momentopname niet. Je kunt de video gewoon verder bewerken, maar geen versies opslaan en niet teruggaan naar een versie.',
  invalidIntro:
    'Deze bestanden van de momentopname kunnen niet worden verwerkt. Ze bevatten mogelijk markeringen van een mergeconflict, zijn afgekapt of zijn met de hand beschadigd:',
  invalidOutro:
    'BaoCut heeft ze niet geïmporteerd. Je kunt de video gewoon verder bewerken, maar geen versies opslaan en niet teruggaan naar een versie. BaoCut controleert opnieuw zodra je deze bestanden hebt hersteld, of je houdt de inhoud uit BaoCut en overschrijft ze.',
  externalIntro: 'Deze bestanden van de momentopname zijn buiten BaoCut gewijzigd, mogelijk door git pull, een synchronisatieschijf of handmatige bewerking:',
  externalOutro:
    'BaoCut heeft geen wijzigingen die nog niet in de momentopname staan, dus worden ze direct geïmporteerd als een versie ‘Externe wijziging’. Je kunt de import daarna ongedaan maken.',
  stripConflict: 'De momentopname is buiten BaoCut gewijzigd, en BaoCut heeft ook nieuwe wijzigingen. Kies wat je wilt houden.',
  stripInvalid: 'De bestanden van de momentopname zijn onleesbaar. BaoCut heeft ze niet geïmporteerd.',
  view: 'Bekijken',
  keepVideo: 'Inhoud uit BaoCut houden',
  useSnapshot: 'Momentopname op schijf gebruiken',
  keepTitle: 'Inhoud uit BaoCut houden?',
  keepConfirm: 'Momentopname op schijf overschrijven',
  keepBody: (count: number, files: string, invalid: boolean) =>
    `De inhoud uit BaoCut wordt meteen naar de momentopname geschreven en overschrijft ${count === 1 ? `het ${invalid ? 'onleesbare' : 'gewijzigde'} bestand` : `de ${count} ${invalid ? 'onleesbare' : 'gewijzigde'} bestanden`} op schijf${files ? ` (${files})` : ''}. Die wijzigingen op schijf komen niet in de versiegeschiedenis en zijn in BaoCut niet terug te halen; kwamen ze uit git of een synchronisatieschijf, dan kun je ze daar terughalen.`,
  diskTitle: 'Momentopname op schijf gebruiken?',
  diskConfirm: 'Momentopname op schijf gebruiken',
  diskBody: (files: string) =>
    `De inhoud van de video wordt vervangen door de momentopname op schijf${files ? ` (${files})` : ''} en vastgelegd als een versie ‘Externe wijziging’. Wijzigingen in BaoCut die nog niet in de momentopname staan, komen eerst in de versiegeschiedenis: ga terug naar vóór de versie ‘Externe wijziging’ om ze terug te halen. Je kunt dit ook ongedaan maken.`,
  keptTitle: 'Inhoud uit BaoCut behouden',
  keptText: (version: number | null) =>
    `De momentopname op schijf komt nu overeen met BaoCut${version ? `, en je recente wijzigingen staan in versie ${version}` : ''}. De wijzigingen die op schijf stonden, zijn niet in de versiegeschiedenis gekomen.`,
  usedDiskTitle: (version: number) => `Momentopname op schijf gebruikt, vastgelegd als versie ${version} ‘Externe wijziging’`,
  usedDiskText: (version: number) => `Ga terug naar vóór versie ${version} om terug te halen wat er in BaoCut stond. Je kunt dit ook ongedaan maken.`,
  importedTitle: (version: number | null) => (version ? `Externe wijzigingen geïmporteerd als versie ${version} ‘Externe wijziging’` : 'Externe wijzigingen geïmporteerd'),
  importedText:
    'De bestanden van de momentopname zijn buiten BaoCut gewijzigd en BaoCut had geen andere wijzigingen, dus zijn ze direct geïmporteerd. Ga terug naar vóór deze versie om de inhoud van vóór de import te zien, of maak de import ongedaan.',
  importUndoneTitle: 'Import ongedaan gemaakt',
  importUndoneText:
    'De video heeft weer de inhoud van vóór de import en wordt binnen enkele seconden teruggeschreven naar de momentopname, waarmee deze externe wijziging wordt verworpen. Het ongedaan maken is zelf ook een wijziging en komt in een nieuwe versie.',
  refusedBroken: 'Kan niet terug naar deze versie',
  refusedOther: 'Niet uitgevoerd',
  refusedText: (message: string) => `${message}. De video is niet gewijzigd.`,
  savedTitle: (version: number, name: string) => `Opgeslagen als versie ${version} ‘${name}’`,
  savedText: 'Opgeslagen versies blijven bewaard; de bewaarregel verwijdert ze nooit.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before
      ? `Teruggegaan naar vóór versie ${version}, vastgelegd als versie ${recorded}`
      : `Teruggegaan naar versie ${version}, vastgelegd als versie ${recorded}`,
  restoredText: 'Dit is een gewone wijziging: je kunt die hier ongedaan maken, of in de editor nadat je dit venster hebt gesloten.',
  undo: 'Ongedaan maken',
  undoneTitle: (version: number, before: boolean) =>
    before ? `Ongedaan gemaakt: terug naar vóór versie ${version}` : `Ongedaan gemaakt: terug naar versie ${version}`,
  undoneText: 'De video heeft weer de vorige inhoud. Het ongedaan maken is zelf ook een wijziging en komt in de nieuwste versie.',
  noopTitle: 'Geen wijzigingen',
  noopText: (version: number, before: boolean) =>
    before
      ? `De video is al in de staat van vóór het begin van versie ${version}. Er is niets vastgelegd en er is geen nieuwe versie gemaakt.`
      : `De video is al in de staat van het einde van versie ${version}. Er is niets vastgelegd en er is geen nieuwe versie gemaakt.`,
  deletedTitle: (name: string) => `Opgeslagen versie ‘${name}’ verwijderd`,
  deletedText: 'De inhoud van de video is niet gewijzigd.',
  emptyTitle: 'Nog geen versies',
  emptyText: (missing: boolean): string =>
    missing
      ? 'De werkruimtemomentopname is nog niet geschreven. Je volgende wijziging wordt versie 1, of je kunt nu een versie opslaan.'
      : 'Je volgende wijziging wordt versie 1, of je kunt nu een versie opslaan.',
  outsideTitle: 'Deze video staat niet in een project',
  outsideText: 'Alleen video’s in een project hebben een versiegeschiedenis. Verplaats de video eerst naar een project.',
  listLabel: 'Versies',
  versionN: (version: number) => `Versie ${version}`,
  openBadge: 'Nog open',
  blockedFlag: 'Kan niet terug',
  unreadableTitle: 'Kan dit versiebestand niet lezen',
  kindSegment: 'Bewerkingen',
  kindSave: 'Opgeslagen versie',
  kindRestore: 'Terug naar een versie',
  kindExternal: 'Externe wijziging',
  kindRebuild: 'Opnieuw opgebouwd',
  revisions: (from: string, to: string) => (from === to ? `Revisie ${to}` : `Revisies ${from}–${to}`),
  openHint: 'De nieuwste versie is nog open: tot er 5 rustige minuten zijn geweest of de versie 30 minuten beslaat, komen je volgende wijzigingen erin.',
  openHintPending: 'De nieuwste versie is nog open. Recente wijzigingen worden geschreven en komen er binnen enkele seconden in.',
  openHintConflict: 'De nieuwste versie is nog open, maar nieuwe wijzigingen komen pas in de versiegeschiedenis als het conflict met de momentopname is opgelost.',
  openHintExternal:
    'De nieuwste versie is nog open. De momentopname op schijf wordt geïmporteerd: deze versie wordt eerst afgesloten, en de externe wijzigingen worden een eigen versie.',
  externalHint:
    'Deze versie komt van buiten BaoCut: de bestanden van de momentopname zijn gewijzigd door git pull, een synchronisatieschijf of handmatige bewerking, en BaoCut heeft ze als deze versie geïmporteerd. Ga terug naar vóór deze versie om terug te halen wat er vóór de import in BaoCut stond.',
  restoreEnd: 'Terug naar deze versie',
  restoreBefore: 'Terug naar vóór deze versie',
  deleteSaved: 'Deze opgeslagen versie verwijderen',
  whyNotFound: 'Deze versie bestaat niet meer',
  whyUnreadable: (version: number) =>
    `Het bestand van versie ${version} kan niet worden gelezen, dus je kunt niet terug naar deze versie of eerdere staten`,
  whyBroken: (version: number) => `De versiegeschiedenis klopt niet bij versie ${version}, dus je kunt niet terug naar eerdere staten`,
  noopBoth: (version: number) =>
    `De video is al in de staat van versie ${version} (de inhoud is ervoor en erna hetzelfde), dus teruggaan verandert niets`,
  noopEnd: (version: number) => `De video is al in de staat van het einde van versie ${version}, dus teruggaan verandert niets`,
  noopBefore: (version: number) => `De video is al in de staat van vóór het begin van versie ${version}, dus teruggaan verandert niets`,
  factActors: 'Gewijzigd door',
  factConversations: 'Sessies',
  factFiles: 'Wat er is gewijzigd',
  factCheckpoint: 'Controlepunt',
  actorYou: 'Jij',
  actorAgent: 'Agent',
  actorExternal: (name: string) => `Externe dienst ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'Er zijn geen wijzigingen vastgelegd',
  noActionsRebuild: 'BaoCut heeft de video opnieuw opgebouwd uit de momentopname; geen inhoudelijke wijzigingen',
  omitted: (count: number) => (count === 1 ? 'Nog 1 wijziging is alleen geteld' : `Nog ${count} wijzigingen zijn alleen geteld`),
  notHere: '(niet op deze computer)',
  openConversation: (title: string) => `Sessie ‘${title}’ openen`,
  fileTimeline: 'Tijdlijn',
  fileDocument: 'Document',
  changeAdd: 'Toegevoegd',
  changeDelete: 'Verwijderd',
  changeModify: 'Gewijzigd',
  noFiles: 'Geen inhoudelijke wijzigingen',
  diffTitle: 'Wijzigingen',
  copyDiff: 'Diff kopiëren',
  copied: 'Gekopieerd',
  copyFailed: 'Kan niet kopiëren. Selecteer de tekst en kopieer handmatig.',
  diffEmpty: 'De diff van deze versie is leeg: de inhoud is hetzelfde als aan het einde van de vorige versie.',
  diffLabel: (version: number) => `Diff van versie ${version}`,
  diffLoading: 'Diff laden',
  diffFailed: (message: string) => `Kan deze versie niet lezen: ${message}`,
  diffMore: (count: number) =>
    count === 1
      ? 'Nog 1 regel wordt niet getoond. Kopieer de diff om alles te zien.'
      : `Nog ${count} regels worden niet getoond. Kopieer de diff om alles te zien.`,
  unreadableHeading: (file: string) => `Kan ${file} niet lezen`,
  unreadableText: (why: string) =>
    `De header of diff van het versiebestand is beschadigd; het bestand is mogelijk afgekapt of met de hand bewerkt. ${why}. Nieuwere versies zijn niet getroffen.`,
  confirmRestoreTitle: (version: number, before: boolean) => (before ? `Terug naar vóór versie ${version}?` : `Terug naar versie ${version}?`),
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `De inhoud van de video wordt vervangen door de staat ${before ? `van vóór het begin van versie ${version}` : `van het einde van versie ${version}`} (${when}). Dit is een wijziging die je ongedaan kunt maken en die als nieuwe versie wordt vastgelegd. Bestaande versies blijven, en controlepunten en beschermingen veranderen niet.`,
  confirmDeleteTitle: (name: string) => `Opgeslagen versie ‘${name}’ verwijderen?`,
  confirmDeleteMiddle: (next: number) =>
    `Alleen deze versie en het controlepunt ervan worden verwijderd: de wijzigingen gaan op in versie ${next}, direct erna. De inhoud van de video verandert niet.`,
  confirmDeleteTop:
    'Alleen de naam, de notitie en het controlepunt worden verwijderd: deze versie wordt een gewone reeks bewerkingen en latere wijzigingen gaan erin op. De inhoud van de video verandert niet.',
  delete: 'Verwijderen',
};
