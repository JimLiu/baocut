import type { JobsDubMessages } from './dub.ts';

export const nl: JobsDubMessages = {
  label: "Vertaalde nasynchronisatie",
  description:
    "Geeft een transcript in de video een stem in een andere taal: vertaalt het eerst als er geen vertaling is, synthetiseert spraak zin voor zin, lijnt die uit met de timing van de oorspronkelijke zinnen en past het toe op de video als nasynchronisatiegroep (één nasynchronisatiespoor). Er wordt geen agent gestart.",
  stepFreezeSource: "Bron lezen",
  stepTranslate: "Vertalen",
  stepAssemble: "Vertaling samenstellen",
  stepWrite: "Vertaling schrijven",
  stepCheck: "Vertaling controleren",
  stepSeparate: "Stem en achtergrond scheiden",
  stepSynthesize: "Zinnen synthetiseren",
  stepAlign: "Timing uitlijnen",
  stepApply: "Nasynchronisatie toepassen",

  regroupConflict: (p: { params: string }) =>
    `Het opnieuw inspreken van zinnen (regroup) neemt de vertaling, taal, stem en behandeling van oorspronkelijke audio over uit het nasynchronisatieplan van die groep en kan daarom niet worden gecombineerd met ${p.params}`,
  orTranslationId: "of translationId moet worden opgegeven",
  translationIdNoTranslate: "Met translationId wordt niets vertaald, dus style, glossary, glossaries, textProvider en textModel zijn niet van toepassing",
  mustBeBooleanValue: "moet een boolean zijn",
  mustBeObject: "moet een object zijn",
  unitsCount: (p: { max: number }) => `moet minstens 1 en maximaal bevatten: ${p.max} vertaaleenheid-ID’s`,
  mustBeUnique: "mag geen duplicaten bevatten",
  seedInvalid: (p: { max: number }) => `moet 'new' of een geheel getal zijn van 0 tot ${p.max}`,

  videoNotOpen: "De video is niet geopend",
  translationFromOther: (p: { translationId: string; from: string; expected: string }) =>
    `Vertaling ${p.translationId} is vertaald uit ${p.from}, niet ${p.expected}`,
  translationLanguage: (p: { translationId: string; language: string; expected: string }) =>
    `Vertaling ${p.translationId} is in ${p.language}, niet ${p.expected}`,
  noDocument: (p: { documentId: string }) => `De video heeft geen document ${p.documentId}`,
  notTranslation: (p: { documentId: string; kind: string }) => `Document ${p.documentId} is ${p.kind}, geen vertaling`,
  translationNotUsable: (p: { translationId: string; schema: string }) =>
    `Vertaling ${p.translationId} is niet ${p.schema}, dus kan niet worden gebruikt voor nasynchronisatie`,
  noPlan: (p: { groupId: string }) => `De video heeft geen nasynchronisatieplan voor deze nasynchronisatiegroep (${p.groupId})`,
  groupGone: (p: { groupId: string }) => `Deze nasynchronisatiegroep (${p.groupId}) heeft geen items meer op de tijdlijn`,
  planNoTranslation: "Het nasynchronisatieplan registreert geen vertaling",
  unitsNotInPlan: (p: { count: number; units: string }) =>
    `${p.count} zinnen staan niet in het plan of de vertaling van deze nasynchronisatiegroep: ${p.units}`,
  planNoVoice: "Het nasynchronisatieplan registreert niet de aanbieder, het model en de stem die voor synthese zijn gebruikt",
  seedNotAccepted: (p: { model: string }) => `Model ${p.model} accepteert geen seed`,

  videoClosed: "De video is gesloten",
  translationGone: "Het vertaaldocument staat niet meer in de video",
  translationNotSchema: (p: { schema: string }) => `De vertaling is niet ${p.schema}`,
  translationNotFromTranscript: "De vertaling is niet gemaakt vanuit dit transcript",
  unitMissingIds: "De vertaling bevat eenheden zonder id of sourceSentenceId",
  separationNotConfigured:
    "Er is gevraagd om stemmen en achtergrond te scheiden, maar er is geen scheidingsfunctie (separateAudio) ingesteld. Deze stap wordt overgeslagen en de oorspronkelijke audio wordt ongewijzigd verwerkt",
  unitsStale: (p: { count: number }) =>
    `${p.count} vertaalde zinnen zijn verouderd (de bron of woordenlijst is gewijzigd, of ze zijn gemarkeerd als verouderd) en zijn niet gesynthetiseerd`,
  nothingToDub: "De vertaling heeft geen zinnen om na te synchroniseren: ze zijn allemaal verouderd of leeg",

  separationUnavailable: "Stemmen en achtergrond scheiden is niet meer beschikbaar",
  noSourceAsset: "Het transcript heeft geen bronmedia, dus kan niet worden gescheiden",
  sourceAssetMissing: "De bronmedia van het transcript zijn niet beschikbaar",
  separationInvalid: "De scheidingsuitvoer voldoet niet aan het contract",
  inputNoAudio: "De invoer heeft geen audio",
  stemNoAudio: (p: { name: string }) => `${p.name} heeft geen audio`,
  stemSampleRate: (p: { name: string; rate: number; input: number }) =>
    `De samplefrequentie van ${p.name} (${p.rate}) verschilt van die van de invoer (${p.input})`,
  stemDuration: (p: { name: string; duration: number; input: number }) =>
    `${p.name} is ${p.duration} seconden lang; de invoer is ${p.input} seconden`,

  sentenceJob: (p: { n: number }) => `Zin ${p.n}`,
  audioUndecodable: "De gesynthetiseerde audio kan niet worden gedecodeerd",
  outputNoAudio: "De gesynthetiseerde uitvoer heeft geen audio",
  synthesisStopped: (p: { cause: string; synthesized: number; remaining: number }) =>
    `${p.cause}. ${p.synthesized} zinnen zijn gesynthetiseerd; resterend: ${p.remaining}; bij opnieuw proberen wordt alleen de rest gesynthetiseerd`,
  synthesisFailed: (p: { failed: number; synthesized: number }) =>
    `${p.failed} zinnen kunnen niet worden gesynthetiseerd. De ${p.synthesized} geslaagde zinnen blijven behouden; bij opnieuw proberen worden alleen de mislukte zinnen gesynthetiseerd`,
  voicesUnavailableAll: (p: { speakers: string }) =>
    `De stemmen die aan de sprekers zijn gekoppeld (${p.speakers}) zijn niet beschikbaar, dus er kan geen zin worden gesynthetiseerd. Herstel de stemmen (kloon ze opnieuw of voeg de toestemmingsverklaring toe) en probeer het opnieuw`,
  voicesUnavailable: (p: { count: number; speakers: string }) =>
    `${p.count} zinnen zijn niet gesynthetiseerd omdat de stemmen van hun sprekers (${p.speakers}) niet beschikbaar zijn; er is geen andere stem voor gebruikt`,

  mutedUnvoiced: (p: { count: number }) =>
    `${p.count} gedempte items bevatten ook zinnen die niet zijn gesynthetiseerd omdat hun stem niet beschikbaar is; de oorspronkelijke audio van die zinnen is ook gedempt`,
  unitsOverlong: (p: { count: number; tempo: number }) =>
    `${p.count} zinnen passen nog steeds niet na versnellen tot ${p.tempo}× en gebruik van de stilte erna, dus ze zijn niet op de tijdlijn geplaatst (het script moet worden herschreven)`,
  unitsOffTimeline: (p: { count: number }) =>
    `De oorspronkelijke zinnen van ${p.count} vertaalde zinnen staan niet meer op de tijdlijn, dus ze zijn niet geplaatst`,
  nothingPlaced: "Geen nasynchronisatiezin past op de tijdlijn",
  artifactGone: (p: { artifactId: string }) => `Uitvoer ${p.artifactId} bestaat niet meer`,
  stretchNoAudio: "Geen audio na het wijzigen van de snelheid",

  videoClosedKept: "De video is gesloten; de gesynthetiseerde audio blijft behouden in de uitvoer",
  videoChanged:
    "De video is gewijzigd na het uitlijnen, dus er is niets toegepast. Opnieuw proberen lijnt uit met de huidige tijdlijn (de gesynthetiseerde audio wordt hergebruikt)",
  sequenceGone: "De sequentie bestaat niet meer",
  backgroundMuted:
    "De oorspronkelijke audio is gedempt. Als die stemmen, muziek en omgevingsgeluid combineert, is de achtergrond ook weg (de achtergrond is niet gescheiden)",
  noTrackOrPlanId: "Geen ID van het nasynchronisatiespoor of nasynchronisatieplan ontvangen na het toepassen",
  applyRejected: "De nasynchronisatietransactie is geweigerd; de gesynthetiseerde audio blijft behouden in de uitvoer",
  planGone: "Het plan van deze nasynchronisatiegroep staat niet meer in de video",
  regroupRejected: "De transactie om nasynchronisatie opnieuw te genereren is geweigerd; de gesynthetiseerde audio blijft behouden in de uitvoer",
  planNotSchema: (p: { schema: string }) => `Het nasynchronisatieplan is niet ${p.schema}`,

  transactionLabel: (p: { language: string }) => `Nasynchronisatie (${p.language})`,
  regroupLabel: (p: { language: string }) => `Nasynchronisatie opnieuw genereren (${p.language})`,
  trackName: (p: { language: string }) => `Nasynchronisatie (${p.language})`,
  assetName: (p: { language: string; n: number }) => `Nasynchronisatie (${p.language}) zin ${p.n}`,
  takeAssetName: (p: { language: string; n: number; k: number }) => `Nasynchronisatie (${p.language}) zin ${p.n} · opname ${p.k}`,
  itemName: (p: { n: number }) => `Nasynchronisatie ${p.n}`,
  backgroundName: (p: { language: string }) => `Achtergrond (${p.language})`,
  vocalsName: (p: { language: string }) => `Stemmen (${p.language})`,
  planName: (p: { language: string }) => `Nasynchronisatieplan (${p.language})`,
  duckingName: (p: { language: string }) => `Nasynchronisatie (${p.language}) verlaagt de oorspronkelijke audio`,
};
