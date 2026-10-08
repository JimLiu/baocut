import type { JobsDubMessages } from './dub.ts';

export const de: JobsDubMessages = {
  label: "Übersetzte Vertonung",
  description:
    "Vertont ein Transkript im Video in einer anderen Sprache: übersetzt es zunächst, falls keine Übersetzung vorhanden ist, synthetisiert Sprache Satz für Satz, richtet sie am Timing der Original-Sätze aus und fügt sie als Vertonungsgruppe (eine Vertonungsspur) ins Video ein. Es wird kein Agent gestartet.",
  stepFreezeSource: "Quelle lesen",
  stepTranslate: "Übersetzen",
  stepAssemble: "Übersetzung zusammenstellen",
  stepWrite: "Übersetzung schreiben",
  stepCheck: "Übersetzung prüfen",
  stepSeparate: "Stimme und Hintergrund trennen",
  stepSynthesize: "Sätze synthetisieren",
  stepAlign: "Timing ausrichten",
  stepApply: "Vertonung anwenden",

  regroupConflict: (p: { params: string }) =>
    `Die erneute Vertonung eines Satzes (Regroup) übernimmt Übersetzung, Sprache, Stimme und Behandlung des Originaltons aus dem Vertonungsplan dieser Gruppe und kann daher nicht kombiniert werden mit ${p.params}`,
  orTranslationId: "oder translationId muss angegeben werden",
  translationIdNoTranslate: "Mit translationId wird nichts übersetzt; style, glossary, glossaries, textProvider und textModel sind daher nicht anwendbar",
  mustBeBooleanValue: "muss ein boolescher Wert sein",
  mustBeObject: "muss ein Objekt sein",
  unitsCount: (p: { max: number }) => `muss mindestens 1 und höchstens enthalten: ${p.max} Übersetzungseinheiten-IDs`,
  mustBeUnique: "darf keine Duplikate enthalten",
  seedInvalid: (p: { max: number }) => `muss 'new' oder eine ganze Zahl sein von 0 bis ${p.max}`,

  videoNotOpen: "Das Video ist nicht geöffnet",
  translationFromOther: (p: { translationId: string; from: string; expected: string }) =>
    `Übersetzung ${p.translationId} wurde übersetzt aus ${p.from}, nicht ${p.expected}`,
  translationLanguage: (p: { translationId: string; language: string; expected: string }) =>
    `Übersetzung ${p.translationId} ist in ${p.language}, nicht ${p.expected}`,
  noDocument: (p: { documentId: string }) => `Das Video hat kein Dokument ${p.documentId}`,
  notTranslation: (p: { documentId: string; kind: string }) => `Dokument ${p.documentId} ist ${p.kind}, keine Übersetzung`,
  translationNotUsable: (p: { translationId: string; schema: string }) =>
    `Übersetzung ${p.translationId} ist nicht ${p.schema} und kann daher nicht zur Vertonung verwendet werden`,
  noPlan: (p: { groupId: string }) => `Das Video hat keinen Vertonungsplan für diese Vertonungsgruppe (${p.groupId})`,
  groupGone: (p: { groupId: string }) => `Diese Vertonungsgruppe (${p.groupId}) hat keine Einträge mehr in der Zeitleiste`,
  planNoTranslation: "Im Vertonungsplan ist keine Übersetzung aufgezeichnet",
  unitsNotInPlan: (p: { count: number; units: string }) =>
    `${p.count} Sätze sind nicht im Plan oder der Übersetzung dieser Vertonungsgruppe: ${p.units}`,
  planNoVoice: "Im Vertonungsplan sind Anbieter, Modell und Stimme der Synthese nicht aufgezeichnet",
  seedNotAccepted: (p: { model: string }) => `Modell ${p.model} unterstützt keinen Seed`,

  videoClosed: "Das Video wurde geschlossen",
  translationGone: "Das Übersetzungsdokument ist nicht mehr im Video vorhanden",
  translationNotSchema: (p: { schema: string }) => `Die Übersetzung ist nicht ${p.schema}`,
  translationNotFromTranscript: "Die Übersetzung wurde nicht aus diesem Transkript erstellt",
  unitMissingIds: "Die Übersetzung enthält Einheiten ohne id oder sourceSentenceId",
  separationNotConfigured:
    "Trennung von Stimme und Hintergrund angefordert, aber keine Trennfunktion (separateAudio) konfiguriert. Dieser Schritt wird übersprungen und der Originalton unverändert behandelt",
  unitsStale: (p: { count: number }) =>
    `${p.count} übersetzte Sätze sind veraltet (Quelle oder Glossar geändert oder als veraltet markiert) und wurden nicht synthetisiert`,
  nothingToDub: "Die Übersetzung hat keine vertonbaren Sätze: alle sind veraltet oder leer",

  separationUnavailable: "Trennung von Stimme und Hintergrund ist nicht mehr verfügbar",
  noSourceAsset: "Das Transkript hat kein Quellmaterial und kann daher nicht getrennt werden",
  sourceAssetMissing: "Das Quellmaterial des Transkripts ist nicht verfügbar",
  separationInvalid: "Das Trennungsergebnis erfüllt den Vertrag nicht",
  inputNoAudio: "Die Eingabe hat kein Audio",
  stemNoAudio: (p: { name: string }) => `${p.name} hat kein Audio`,
  stemSampleRate: (p: { name: string; rate: number; input: number }) =>
    `Die Abtastrate von ${p.name} (${p.rate}) unterscheidet sich von der Eingabe (${p.input})`,
  stemDuration: (p: { name: string; duration: number; input: number }) =>
    `${p.name} ist ${p.duration} Sekunden lang; die Eingabe ist ${p.input} Sekunden`,

  sentenceJob: (p: { n: number }) => `Satz ${p.n}`,
  audioUndecodable: "Das synthetisierte Audio kann nicht decodiert werden",
  outputNoAudio: "Das Syntheseergebnis hat kein Audio",
  synthesisStopped: (p: { cause: string; synthesized: number; remaining: number }) =>
    `${p.cause}. ${p.synthesized} Sätze wurden synthetisiert; verbleibend: ${p.remaining}; bei erneutem Versuch wird nur der Rest synthetisiert`,
  synthesisFailed: (p: { failed: number; synthesized: number }) =>
    `${p.failed} Sätze konnten nicht synthetisiert werden. ${p.synthesized} erfolgreiche Sätze bleiben erhalten; bei erneutem Versuch werden nur die fehlgeschlagenen synthetisiert`,
  voicesUnavailableAll: (p: { speakers: string }) =>
    `Die den Sprechern zugewiesenen Stimmen (${p.speakers}) sind nicht verfügbar; kein Satz konnte synthetisiert werden. Stimmen korrigieren (erneut klonen oder Einwilligungserklärung ergänzen) und erneut versuchen`,
  voicesUnavailable: (p: { count: number; speakers: string }) =>
    `${p.count} Sätze wurden nicht synthetisiert, da die Stimmen ihrer Sprecher (${p.speakers}) nicht verfügbar sind; keine andere Stimme wurde stattdessen verwendet`,

  mutedUnvoiced: (p: { count: number }) =>
    `${p.count} stummgeschaltete Einträge enthalten auch Sätze, die wegen einer nicht verfügbaren Stimme nicht synthetisiert wurden; auch deren Originalton wurde stummgeschaltet`,
  unitsOverlong: (p: { count: number; tempo: number }) =>
    `${p.count} Sätze passen auch nach Beschleunigung auf ${p.tempo}× und Nutzung der folgenden Stille nicht; sie wurden daher nicht in die Zeitleiste eingefügt (das Skript muss umgeschrieben werden)`,
  unitsOffTimeline: (p: { count: number }) =>
    `Die Originalsätze von ${p.count} übersetzten Sätzen sind nicht mehr in der Zeitleiste; sie wurden daher nicht eingefügt`,
  nothingPlaced: "Kein Vertonungssatz passt in die Zeitleiste",
  artifactGone: (p: { artifactId: string }) => `Ergebnis ${p.artifactId} ist nicht mehr vorhanden`,
  stretchNoAudio: "Kein Audio nach Geschwindigkeitsänderung",

  videoClosedKept: "Das Video wurde geschlossen; das synthetisierte Audio bleibt in den Ergebnissen erhalten",
  videoChanged:
    "Das Video wurde nach der Ausrichtung geändert; nichts wurde angewendet. Ein erneuter Versuch richtet an der aktuellen Zeitleiste aus (das synthetisierte Audio wird wiederverwendet)",
  sequenceGone: "Die Sequenz ist nicht mehr vorhanden",
  backgroundMuted:
    "Der Originalton wurde stummgeschaltet. Wenn er Stimmen, Musik und Umgebungsgeräusche mischt, ist auch der Hintergrund verschwunden (er wurde nicht getrennt)",
  noTrackOrPlanId: "Nach dem Anwenden wurde keine ID der Vertonungsspur oder des Vertonungsplans empfangen",
  applyRejected: "Die Vertonungstransaktion wurde abgelehnt; das synthetisierte Audio bleibt in den Ergebnissen erhalten",
  planGone: "Der Plan dieser Vertonungsgruppe ist nicht mehr im Video vorhanden",
  regroupRejected: "Die Transaktion zur erneuten Vertonung wurde abgelehnt; das synthetisierte Audio bleibt in den Ergebnissen erhalten",
  planNotSchema: (p: { schema: string }) => `Der Vertonungsplan ist nicht ${p.schema}`,

  transactionLabel: (p: { language: string }) => `Vertonung (${p.language})`,
  regroupLabel: (p: { language: string }) => `Vertonung erneut erzeugen (${p.language})`,
  trackName: (p: { language: string }) => `Vertonung (${p.language})`,
  assetName: (p: { language: string; n: number }) => `Vertonung (${p.language}) Satz ${p.n}`,
  takeAssetName: (p: { language: string; n: number; k: number }) => `Vertonung (${p.language}) Satz ${p.n} · Aufnahme ${p.k}`,
  itemName: (p: { n: number }) => `Vertonung ${p.n}`,
  backgroundName: (p: { language: string }) => `Hintergrund (${p.language})`,
  vocalsName: (p: { language: string }) => `Stimmen (${p.language})`,
  planName: (p: { language: string }) => `Vertonungsplan (${p.language})`,
  duckingName: (p: { language: string }) => `Vertonung (${p.language}) senkt den Originalton ab`,
};
