import type { OnboardingMessages } from './onboarding-copy.ts';

export const de: OnboardingMessages = {
  dialogLabel: 'Willkommen bei BaoCut',
  stepsLabel: 'Einrichtungsschritte',
  step: {
    agent: 'Agent verbinden',
    asr: 'Spracherkennung',
    tts: 'Sprachsynthese',
    semantic: 'Semantische Suche',
    image: 'Bilderzeugung',
    music: 'Musikerzeugung',
  },
  title: {
    agent: 'Willkommen bei BaoCut',
    asr: 'Modelle für Spracherkennung herunterladen',
    tts: 'Modelle für Sprachsynthese herunterladen',
    semantic: 'Semantische Suche installieren',
    image: 'Modelle für Bilderzeugung herunterladen',
    music: 'Modelle für Musikerzeugung herunterladen',
  },
  lead: {
    agent:
      'Beschreiben Sie das gewünschte Video, und ein Agent transkribiert, untertitelt, übersetzt, vertont und schneidet es für Sie. BaoCut nutzt die Agenten auf diesem Computer (etwa Claude Code oder Codex) mit Ihrem eigenen Konto, ohne Zusatzkosten.',
    asr: 'Transkribieren, Untertiteln und das Schneiden von Sprechvideos beginnen damit, Sprache in Text umzuwandeln. Die Modelle laufen auf diesem Computer und funktionieren offline.',
    tts: 'Sprachsynthesemodelle lesen Text vor, klonen eine Stimme aus einer Aufnahme und vertonen übersetzte Videos. Wählen Sie für den Anfang ein oder zwei aus; weitere laden Sie später unter Einstellungen › Sprachsynthese herunter.',
    semantic:
      'Findet Gesagtes und Gezeigtes nach Bedeutung: Space-Suche, Materialauswahl nach Thema, passende Bilder und das Übersetzungsgedächtnis nutzen es. Nach der Installation werden Ihre vorhandenen Videos im Hintergrund indexiert.',
    image: 'Erzeugt auf diesem Computer Bilder aus einem Satz, für Titelbilder und Illustrationen. Die Modelle sind groß und das Erzeugen dauert.',
    music:
      'Erzeugt auf diesem Computer Hintergrundmusik und Songs aus einem Stil oder Liedtext, bereit für die Musikspur eines Videos. Das Erzeugen dauert: etwa einige Minuten für 30 Sekunden.',
  },
  where: {
    tts: {
      title: 'Nutzbar unter Werkzeuge › Sprache erzeugen',
      body: 'Schreiben Sie einen Text oder wählen Sie ein Dokument oder Untertitel in Space, dann ein Modell und eine Stimme. Noch nicht heruntergeladene Modelle lassen sich dort ebenfalls herunterladen.',
    },
    image: { title: 'Nutzbar unter Werkzeuge › Bild erzeugen', body: 'Beschreiben Sie das Bild in einem Satz. Auch Agenten nutzen es für Titelbilder.' },
    music: {
      title: 'Nutzbar unter Werkzeuge › Musik erzeugen',
      body: 'Wählen Sie einen Stil und schreiben Sie einen Liedtext. Die Musik wird in Space gespeichert und kann Ihren Videos hinzugefügt werden.',
    },
  },
  diarizes: 'Unterscheidet Sprecher beim Transkribieren',
  needsDiarization: (pack) => `Um Sprecher zu unterscheiden, auch „${pack}“ herunterladen`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 voreingestellte Stimmen · Sprechstil in einem Satz beschreiben',
    'qwen3-tts-0.6b-base': 'Klont eine Stimme aus einer 3-Sekunden-Aufnahme',
    voxcpm2: 'Klont eine Stimme aus einer Aufnahme · Stil beschreibbar · 30 Sprachen und Kantonesisch',
    'qwen-image-2.1-turbo': 'Destilliert · fest 8 Schritte · mehr als doppelt so schnell wie das Basismodell',
    'qwen-image-2.1': 'Basismodell · langsamer, mehr Schritte',
    'yue2-3b': 'Erzeugt aus Stil oder Liedtext · etwa einige Minuten für 30 Sekunden',
  },
  recommended: 'Empfohlen',
  installed: 'Installiert',
  missingParts: 'Fehlende Komponenten',
  planLine: (parts) => `Wird zusammen heruntergeladen: ${parts}`,
  downloading: (name) => `${name} wird heruntergeladen`,
  inBackground: 'Download im Hintergrund',
  bgNote: 'Vor dem Download sehen Sie, woher er kommt und wo er gespeichert wird. Er startet erst nach Ihrer Bestätigung und läuft im Hintergrund, Sie müssen also nicht warten.',
  asrAlt: 'Lieber nichts herunterladen? Cloud-Spracherkennung können Sie auch später unter Einstellungen › API-Anbieter hinzufügen.',
  unsupported: 'Dieser Computer kann diese Modelle nicht ausführen. Sie können diesen Schritt überspringen.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'Agenten auf diesem Computer',
  agentChecking: 'Agenten auf diesem Computer werden gesucht…',
  agentMissingBody: 'Wählen Sie die gewünschten aus, und BaoCut installiert sie im Hintergrund. Danach melden Sie sich einmal mit Ihrem vorhandenen Konto an.',
  agentNote:
    'Ausgewählte Agenten erscheinen im Agent-Menü neuer Sitzungen. Die Installation läuft im Hintergrund, Sie müssen nicht warten. Den Standard wählen oder weitere hinzufügen können Sie unter Einstellungen › Agentenanbieter.',
  agentInstalled: 'Auf diesem Computer installiert',
  agentFix: (problem) => `${problem} · Beheben unter Einstellungen › Agentenanbieter`,
  agentManual: 'Nach offizieller Anleitung im Terminal installieren · Siehe Einstellungen › Agentenanbieter',
  agentNotInstalled: (plan) => (plan ? `Nicht installiert · Anmeldung nach der Installation: ${plan}` : 'Nicht installiert'),
  agentWillInstall: (method, command, login) =>
    `Wird im Hintergrund mit ${method} installiert (${command}) · Danach zum Anmelden ${login} im Terminal ausführen`,
  agentInstalling: (method, login) => `Installation mit ${method} läuft im Hintergrund · Danach zum Anmelden ${login} im Terminal ausführen`,
  agentInstallingLabel: (name) => `${name} wird installiert`,
  agentInstallFailed: 'Installation fehlgeschlagen · Details unter Hintergrundaufgaben',

  next: 'Weiter',
  finish: 'Fertig',
  skip: 'Überspringen',
  exit: 'Einrichtung beenden',
  install: (n) => `Im Hintergrund ${n} installieren und fortfahren`,
  download: (size, last) => `Im Hintergrund${size ? ` ${size}` : ''} herunterladen und ${last ? 'abschließen' : 'fortfahren'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return kind === 'install' ? `${name} wird installiert${tail}` : kind === 'download' ? `${name} wird heruntergeladen${tail}` : `${name} wird eingerichtet${tail}`;
    },
    many: (kind, n) =>
      kind === 'install' ? `${n} Installationen im Hintergrund` : kind === 'download' ? `${n} Downloads im Hintergrund` : `${n} Aufgaben im Hintergrund`,
    idle: (kind) =>
      kind === 'install' ? 'Installationen im Hintergrund' : kind === 'download' ? 'Downloads im Hintergrund' : 'Downloads und Installationen im Hintergrund',
    done: (kind, n) => (kind === 'install' ? `${n} installiert` : kind === 'download' ? `${n} heruntergeladen` : `${n} fertig`),
    failed: (kind, n) =>
      kind === 'install' ? `${n} nicht installiert` : kind === 'download' ? `${n} nicht heruntergeladen` : `${n} nicht abgeschlossen`,
  },
  closedToast: (models, agents) => {
    const m = models === 1 ? '1 Modell wird' : `${models} Modelle werden`;
    const a = agents === 1 ? '1 Agent wird' : `${agents} Agenten werden`;
    const text = models && agents ? `${m} im Hintergrund heruntergeladen und ${a} installiert` : models ? `${m} im Hintergrund heruntergeladen` : `${a} im Hintergrund installiert`;
    return `${text}. Danach ${models + agents === 1 ? `ist ${models ? 'es' : 'er'}` : 'sind sie'} sofort einsatzbereit.`;
  },
  viewTasks: 'Hintergrundaufgaben anzeigen',
};
