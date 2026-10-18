import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const de: ProjectSettingsMessages = {
  menuItem: 'Projekteinstellungen…',
  title: 'Projekteinstellungen',
  close: 'Projekteinstellungen schließen',
  done: 'Fertig',
  loading: 'git wird geprüft',
  loadFailed: (message: string) => `git konnte nicht geprüft werden: ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut kann die Arbeitsbereich-Snapshots Ihrer Videos in das git-Repository committen, in dem das Projekt liegt. Der Versionsverlauf braucht kein git und funktioniert außerhalb eines Repositorys genauso.',
  branch: (name: string) => `Branch ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Erneut prüfen',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Bereit',
  lightPaused: (label: string) => `Pausiert · ${label}`,
  lightNotRepo: 'Nicht in einem git-Repository',
  lightUnavailable: 'git nicht gefunden',
  lightError: 'git fehlgeschlagen',
  pauseLocked: 'Repository wird verwendet',
  pauseMerge: 'Merge läuft',
  pauseRebase: 'Rebase läuft',
  pauseCherryPick: 'Cherry-Pick läuft',
  pauseRevert: 'Revert läuft',
  pauseBisect: 'Bisect läuft',
  pauseDetached: 'HEAD losgelöst',
  pauseLocalConfig: 'Lokale Filter',
  pauseLocalConfigChanged: 'Lokale Filter geändert',

  pausedHeading: (label: string) => `Commits pausiert: ${label}`,
  pausedNote:
    'Solange Commits pausiert sind, warten das automatische Committen und „In git committen“. Öffnen, Bearbeiten und der Versionsverlauf sind nicht betroffen.',
  errorHeading: 'git fehlgeschlagen',
  unavailableHeading: 'git nicht gefunden',

  lcEntry: 'Eintrag',
  lcValue: 'Befehl oder eingebundene Datei',
  lcExplain:
    'Nachdem Sie sie erlaubt haben, folgt BaoCut diesen Einträgen, wenn es git ausführt (zum Beispiel für die Verschlüsselung mit git-crypt). Die Freigabe wird nur auf diesem Computer gespeichert, nicht im Projekt, und BaoCut pausiert erneut, wenn sich die Einträge oder die eingebundenen Dateien ändern. Damit vertrauen Sie nicht dem Ordner: Öffnen, Bearbeiten und Agenten sind nicht betroffen.',
  lcWeb:
    'Diese Einträge werden nur in den Projekteinstellungen der BaoCut-Desktop-App angezeigt und können nur dort erlaubt werden (oder mit baocut projects git-allow). Solange Commits pausiert sind, sind Öffnen, Bearbeiten und der Versionsverlauf nicht betroffen.',
  allow: 'Erlauben',
  allowedTitle: 'Lokale Filter erlaubt',
  allowedText: 'Die Freigabe ist auf diesem Computer gespeichert, nicht im Projekt. Sie können jetzt committen.',
  allowFailed: 'Nicht erlaubt',

  commit: 'In git committen',
  committing: 'Wird committet',
  commitDesc: (maxMiB: number) =>
    `Committet nur die Dateien von BaoCut: die Arbeitsbereich-Snapshots geänderter Videos und Material bis ${maxMiB} MiB. Andere Dateien im Projekt und Änderungen, die Sie bereits gestagt haben, bleiben unverändert. BaoCut pusht nicht.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Letzter Commit ${commit} · ${auto ? 'automatisch' : 'manuell'} · ${ago}`,
  lastFailed: (message: string) => `Letzter Versuch fehlgeschlagen: ${message}`,
  committedTitle: 'In git committet',
  committedText: (commit: string, files: number, videos: string[]) =>
    `${commit} committet: ${files === 1 ? '1 Datei' : `${files} Dateien`}${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `„${name}“` : from === to ? `„${name}“ Version ${to}` : `„${name}“ Versionen ${from}–${to}`,
  unnamedVideo: 'ein Video',
  nothingTitle: 'Nichts zu committen',
  nothingText: 'Die Dateien von BaoCut sind dieselben wie beim letzten Commit.',
  commitFailed: 'Nicht committet',

  autoCommit: 'Automatisch committen',
  autoCommitDesc:
    'Committet einmal, wenn das Projekt 5 Minuten lang ruhig war, wenn Sie das letzte geöffnete Video des Projekts schließen oder wenn Sie BaoCut beenden. Alle Projekte auf diesem Computer teilen sich diese Einstellung.',

  initTitle: 'git initialisieren',
  initDesc: 'Legt ein git-Repository im Projektordner an, damit Sie Snapshots dorthin committen können.',
  initWebNote: 'Nur die BaoCut-Desktop-App oder die CLI (baocut projects git-init) kann ein Repository in einem Ordner auf dem Computer der Runtime anlegen.',
  initRefused: (why: string) => `Hier nicht verfügbar: ${why}`,
  initRefusedNote: 'Wenn Sie eines brauchen, verschieben Sie die Videos in einen eigenen Projektordner und initialisieren Sie git dort.',
  refusalHome:
    'Das Projekt ist Ihr Benutzerordner. Mit einem Repository hier sähe für andere Werkzeuge jeder Ordner in Ihrem Benutzerordner wie ein Teil davon aus.',
  refusalUserFolder:
    'Das Projekt ist ein Standard-Benutzerordner (etwa Schreibtisch, Dokumente, Downloads, Filme, Musik oder Bilder). Mit einem Repository hier sähe für andere Werkzeuge jeder Ordner darin wie ein Teil davon aus.',
  refusalVolumeRoot: 'Das Projekt ist das Stammverzeichnis eines Laufwerks. Mit einem Repository hier sähe das ganze Laufwerk wie ein Teil davon aus.',
  refusalInsideRepo: 'Das Projekt liegt bereits in einem git-Repository.',
  initConfirmTitle: 'git im Projektordner initialisieren?',
  initConfirmBody: (path: string) =>
    `Legt ein git-Repository in ${path} an. Die Ignorierregeln von BaoCut kommen in das eigene .git/info/ des Repositorys, daher ändert sich keine Datei im Projekt. Es wird nichts committet oder gepusht.`,
  cancel: 'Abbrechen',
  initDoneTitle: 'git initialisiert',
  initDoneText: 'Noch ist nichts committet. Verwenden Sie „In git committen“ für den ersten Commit.',
  initFailed: 'Nicht initialisiert',

  recheckSame: 'Nichts hat sich geändert',
  recheckReadyTitle: 'Bereit zum Committen',
  recheckReadyText: 'Das Repository ist nicht mehr pausiert.',

  outsideHeading: 'Material außerhalb des Projekts',
  outsideLead:
    'Wenn ein Video Material außerhalb des Projektordners verwendet, hält sein Arbeitsbereich-Snapshot den Pfad des Materials fest (mit ~/ beginnend unter Ihrem Benutzerordner, sonst als vollständiger Pfad). Nachdem Sie committet oder gepusht haben, erhalten andere nur den Pfad, nicht die Datei. Um auch das Material weiterzugeben, verwenden Sie ein portables Paket.',

  stripLabel: 'Projekt-git',
  projectSettings: 'Projekteinstellungen',
};
