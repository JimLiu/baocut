const sentences = (n: number) => pluralForm('nl', n, { one: `${n} zin`, other: `${n} zinnen` });
const these = (n: number) => n === 1 ? 'Deze zin' : pluralForm('nl', n, { other: `Deze ${n} zinnen` });
import { pluralForm } from '@baocut/protocol';
import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

export const nlDub: DubMessages = {

  title: "Vertaalde nasynchronisatie",
  back: "Terug",
  web: "Vertaalde nasynchronisatie vereist de desktop-app",
  webBody: "BaoCut in de browser biedt geen vaste workflows (pipelines.*), dus vertaalde nasynchronisatie kan hier niet starten. Open deze video in de desktop-app.",
  summary: (language: string, count: number | null, translate: boolean) => `${translate ? `Vertaalt eerst naar ${language}` : `Gebruikt de bestaande vertaling in ${language}`} en synthetiseert spraak ${count === null ? 'zin voor zin' : `voor ${sentences(count)} één voor één`}, lijnt elke zin uit met de timing van de oorspronkelijke zin en schrijft ze naar de tijdlijn als één nasynchronisatiegroep`,
  language: "Nasynchronisatietaal",
  languagePicker: "Nasynchronisatietaal",
  languageLine: (translate: boolean, count: number | null) =>
    `${translate ? "Nog geen vertaling in deze taal · eerst vertalen" : "Gebruikt de bestaande vertaling · geen nieuwe vertaling"}${count === null ? "" : ` · ${sentences(count)}`}`,
  allTaken: "Geen talen beschikbaar voor nasynchronisatie.",
  staleNote: (n: number) => `${pluralForm('nl', n, { one: `${n} zin in deze vertaling is`, other: `${n} zinnen in deze vertaling zijn` })} verouderd (het origineel is gewijzigd of gemarkeerd als verouderd). Geen synthese; vermeld in de samenvatting. Vertaal eerst opnieuw in het paneel Ondertitels voor een volledige nasynchronisatie.`,
  source: "Origineel",
  sourcePicker: "Transcript om in te spreken",
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${sentences(count)}`),
  voiceModel: "Stemmodel",
  voiceModelPicker: "Spraakmodel voor synthese",
  voiceModelsLoading: "Spraakmodellen laden…",
  manageVoiceModels: "Spraakmodellen beheren…",
  ttsMissingTitle: "Nog geen spraakmodel beschikbaar",
  goTts: "Modellen › Spraaksynthese openen",
  voice: "Standaardstem",
  voicePicker: "Gebruikt voor sprekers zonder eigen stem",
  voiceDefault: "Modelstandaard",
  voiceCustom: "Stem-ID",
  voiceCustomPlaceholder: "Stem-ID uit je aanbiederaccount",
  voiceHint: "Sprekers met een hieronder toegewezen stem gebruiken die; de rest gebruikt de stem die hier is gekozen.",
  voiceCustomEmpty: "Voer eerst een stem-ID in of kies een andere stem",
  speakers: "Sprekers",
  speakersAside: (n: number) => `${n}`,
  speakersNone: "Dit transcript heeft geen sprekerinformatie, dus elke zin gebruikt de standaardstem hierboven.",
  speakersNote: "Toewijzingen worden opgeslagen in deze video (een bewerking die je ongedaan kunt maken) en de volgende keer hergebruikt. Prioriteit: toegewezen → standaardstem → modelstandaard.",
  speakerLine: (count: number) => sentences(count),
  speakerBinding: (name: string) => `Stem toegewezen aan ${name}`,
  bindingNone: "Geen",
  bindingOther: (label: string) => `${label} (elders toegewezen)`,
  bindingIgnored: (provider: string) => `De toegewezen stem komt van een andere aanbieder en wordt niet gebruikt met ${provider}`,
  bindingReadOnly: "De video is alleen-lezen, dus sprekerstemmen kunnen niet worden gewijzigd.",
  bindingFailed: (message: string) => `Kan de stem van de spreker niet wijzigen: ${message}`,
  bindingLoading: "Sprekerstemmen laden…",
  bindingReadFailed: (message: string) => `Kan de sprekerstemmen die in deze video zijn toegewezen niet lezen: ${message}`,
  bindingSaved: (name: string) => `Stem toegewezen aan ${name}`,
  bindingCleared: (name: string) => `Stemtoewijzing voor ${name} verwijderd`,
  sourceVideo: "Toegewezen",
  sourceParams: "Standaardstem",
  sourceDefault: "Modelstandaard",

  effective: (label: string, source: string | null) => (source ? `Gebruikt: ${label} (${source})` : `Gebruikt: ${label}`),
  speakerWarning: (reason: string) => `De zinnen van deze spreker worden niet gesynthetiseerd: ${reason}`,
  manageVoices: "Mijn stemmen beheren…",
  mix: "Mix",
  separate: "Achtergrondaudio scheiden",
  separateHint: "De nasynchronisatie vervangt alleen de spraak; muziek en omgevingsgeluid blijven",
  separateMissing: "Er is geen scheidingsmodel beschikbaar op deze computer; ook als dit aanstaat wordt de scheiding overgeslagen en de oorspronkelijke audio als geheel verwerkt.",
  installSeparate: "Scheidingsmodel installeren…",
  original: "Oorspronkelijke audio",
  originalPicker: "Wat er gebeurt met de oorspronkelijke audio wanneer de nasynchronisatie speelt",
  originalLabel: { duck: "Verlagen", mute: "Dempen", keep: "Behouden" } satisfies Record<DubOriginalAudio, string>,

  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) => {
  if (o.original === 'keep') return `De oorspronkelijke audio blijft ongewijzigd en speelt onder de nasynchronisatie${o.separated ? '; er wordt niets gescheiden als die wordt behouden' : ''}.`;
  const action = o.original === 'mute' ? 'gedempt' : `verlaagd met −${o.duckDb} dB`;
  return `${o.separated ? 'Achtergrondaudio krijgt een eigen spoor; het origineel bevat alleen de spraak, die wordt' : 'Zonder scheiding wordt de hele oorspronkelijke audio'} ${action}. Je kunt altijd terug naar de oorspronkelijke audio via de kop van het nasynchronisatiespoor.`;
},
  duckDb: "Hoeveel verlagen (dB)",
  duckLabel: "Verlagen",
  duckUnit: "dB",
  translate: "Vertaling",
  textModel: "Tekstmodel",
  textModelPicker: "Tekstmodel voor vertaling",
  textModelsLoading: "Tekstmodellen laden…",
  manageTextModels: "Tekstmodellen beheren…",
  textMissingTitle: "Nog geen tekstmodel beschikbaar",
  goLlm: "Modellen › Tekstgeneratie openen",
  noStructured: "Geen gestructureerde uitvoer · kan niet worden gebruikt voor vertaling",
  style: "Stijlhint",
  stylePlaceholder: "Bijvoorbeeld: spreektaal, bondig; behoud namen in het origineel",
  styleHint: "Optioneel; maximaal 500 tekens.",
  cta: (language: string) => `Inspreken in ${language}`,

  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
 const tracks = [`‘Nasynchronisatie · ${language}’`];
 if (stems.separated && stems.original !== 'keep') tracks.push('‘Achtergrond’');
 if (stems.separated && stems.original === 'duck') tracks.push('‘Stemmen’');
 const list = new Intl.ListFormat('nl', { style: 'long', type: 'conjunction' }).format(tracks);
 return `Wanneer het klaar is wordt het geschreven naar ${pluralForm('nl', tracks.length, { one: 'spoor', other: 'sporen' })} ${list} op de tijdlijn; met één klik ongedaan maken. Online modellen worden gefactureerd per aanroep.`;
},
  noSpeechTitle: "Nog geen transcript om in te spreken",
  noSpeech: "Nasynchronisatie werkt zin voor zin vanuit een transcript. Transcribeer eerst media met ‘Ondertitels genereren’ in het paneel Ondertitels.",
  busy: "Deze video heeft al een lopende nasynchronisatie; wacht tot die klaar is voordat je een nieuwe start.",
  readOnly: "De video is alleen-lezen, dus kan geen nasynchronisatie krijgen.",

  submitting: "Nasynchronisatie indienen",
  queued: "In wachtrij",
  running: (language: string) => `Inspreken · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) => `${step === 'translate' ? 'Vertaald' : 'Gesynthetiseerd'} ${done}${total ? ` / ${total}` : ''} ${pluralForm('nl', total ?? done, { one: 'zin', other: 'zinnen' })}`,
  sentences: (running: number, failed: number) => [running ? pluralForm('nl', running, { one: `${running} zin wordt gesynthetiseerd`, other: `${running} zinnen worden gesynthetiseerd` }) : '', failed ? `${sentences(failed)} mislukt` : ''].filter(Boolean).join(' · '),
  cancel: "Nasynchronisatie annuleren",
  cancelled: "Nasynchronisatie geannuleerd",
  cancelFailed: (message: string) => `Kan de nasynchronisatie niet annuleren: ${message}`,
  liveNote: "Wanneer het klaar is schrijft de Runtime rechtstreeks naar de tijdlijn en kun je het altijd ongedaan maken. Je kunt deze pagina verlaten.",
  foreign: "Deze nasynchronisatie is niet hier gestart. Controleer de tijdlijn wanneer het klaar is; maak het ongedaan met Ongedaan maken in de editor.",

  grantTitle: (recipient: string) => `Nog geen toestemming om het transcript te sturen naar ${recipient}`,
  grantBody:
    "Nasynchronisatie stuurt de vertaling om te synthetiseren (en het origineel waar de vertaling ontbreekt) naar de aanbieder. Geef toestemming beperkt tot deze video om verder te gaan; zonder toestemming wordt niets verzonden.",
  grantAction: "Toestemming geven en starten",
  grantRetryAction: "Toestemming geven en opnieuw proberen",
  grantDialogTitle: "Toestemming voor gegevensdeling geven",
  grantDialogIntro: "Na bevestiging registreert BaoCut deze toestemming en gaat verder met de nasynchronisatie:",
  grantConfirm: "Toestemming geven en doorgaan",
  grantCancel: "Niet nu",
  granting: "Toestemming geven…",
  grantFailed: (message: string) => `Kan geen toestemming geven: ${message}`,
  grantStillRefused: "Nog steeds geweigerd na toestemming",
  grantNext: "Als vertaling en synthese verschillende aanbieders gebruiken, heeft elke aanbieder eigen toestemming nodig.",
  commands: "Opdrachtregel",

  notConfigured: "Nasynchronisatie is nog niet beschikbaar",
  submitFailed: "Kan de nasynchronisatie niet starten",
  failed: "Nasynchronisatie mislukt",
  interrupted: "Nasynchronisatie onderbroken",
  retry: "Opnieuw proberen",
  retryFailed: (message: string) => `Kan niet opnieuw proberen: ${message}`,
  retryCharges:
    "Opnieuw proberen gaat verder vanaf de stap waar het stopte. Als het stopte bij ‘Vertalen’, wordt die hele stap opnieuw uitgevoerd; al vertaalde batches roepen het model opnieuw aan en kunnen opnieuw worden gefactureerd.",
  retryPartial: "Opnieuw proberen gaat verder vanaf ‘Zinnen synthetiseren’: gesynthetiseerde zinnen worden hergebruikt en alleen mislukte of resterende zinnen worden gesynthetiseerd.",
  retryFree: "Opnieuw proberen gaat verder vanaf de stap waar het stopte; eerder voltooide stappen worden hergebruikt zonder het model opnieuw aan te roepen.",
  retryFrozen:
    "Sprekerstemtoewijzingen zijn vastgelegd bij het starten: een stem herstellen (opnieuw klonen, verklaring van de eigenaar toevoegen) helpt bij opnieuw proberen, maar toewijzingen wijzigen vereist een nieuwe nasynchronisatie.",
  failedUnits: (n: number) => pluralForm('nl', n, { one: `${n} zin kan niet worden gesynthetiseerd`, other: `${n} zinnen kunnen niet worden gesynthetiseerd` }),
  stoppedAt: (synthesized: number, remaining: number) => `Gestopt na synthese van ${sentences(synthesized)}; ${remaining} resterend`,
  dismiss: "OK",

  doneTitle: (language: string) => `Ingesproken in ${language}`,
  doneToast: (language: string, placed: number) => `Ingesproken in ${language} · ${sentences(placed)} op de tijdlijn geplaatst`,
  placed: (placed: number, total: number) => `${placed} / ${total} zinnen op de tijdlijn geplaatst`,
  fitHead: "Waar elke zin is geplaatst",
  speakersHead: "Sprekerstemmen",
  speakerUnits: (n: number) => sentences(n),
  speakerNone: "Geen spreker",
  voiceFailedHead: "De zinnen van deze sprekers zijn niet gesynthetiseerd",
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${sentences(n)} · ${reason}`,
  voiceFailedFix:
    "Deze nasynchronisatie is voltooid en kan niet opnieuw worden geprobeerd: maak deze nasynchronisatiegroep ongedaan → herstel de stem (kloon opnieuw, voeg de verklaring van de eigenaar toe) of wijzig de toewijzing → spreek opnieuw in.",
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [
      `${calls} ${pluralForm('nl', calls, { one: "aanroep", other: "aanroepen" })}`,
      retries ? `${retries} opnieuw verzonden` : "",
      failures ? `${failures} mislukt` : "",
      reused ? `${sentences(reused)} hergebruikt` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  translationCreated: "De nieuwe vertaling die deze keer is gemaakt wordt opgeslagen in de video (nasynchronisatie ongedaan maken verwijdert die niet)",
  translationUsed: "Bestaande vertaling gebruikt",
  glossaryUsed: (n: number) => `Gebruikt: ${n} ${pluralForm('nl', n, { one: "woordenlijst", other: "woordenlijsten" })}`,
  warnings: "Waarschuwingen",
  undo: "Deze nasynchronisatie ongedaan maken",
  undoing: "Ongedaan maken…",
  undone: "Nasynchronisatie ongedaan gemaakt",
  undonePartial:
    "De clips, dempingen en verlagingen van deze nasynchronisatie zijn ongedaan gemaakt. Het lege nasynchronisatiespoor en nasynchronisatieplandocument blijven in de video (het protocol heeft geen actie om sporen of documenten te verwijderen).",
  undoLabel: (language: string) => `Nasynchronisatie ongedaan maken (${language})`,
  undoFailed: "Kan de nasynchronisatie niet ongedaan maken",
  undoNotOpen: "Open die video eerst om deze nasynchronisatie ongedaan te maken.",
  close: "Sluiten",
  again: "Opnieuw inspreken",
  providerFallback: "deze aanbieder",
  unknownLanguage: "Onbekende taal",
};

export const nlTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `Nasynchronisatie · ${language}`,

  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? "Stemmen" : "Achtergrond"} · ${language}`,

  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? " · te snel" : ""}`,

  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} s`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? "Gedempt" : "",
      parts.manual ? "Snelheid handmatig gewijzigd" : "",
      parts.editable ? "Sleep de rechterrand om de lengte te wijzigen · klik rechts voor meer" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  menuLabel: (title: string) => `Nasynchronisatiemenu voor ‘${title}’`,
  selection: (n: number) => `${sentences(n)} geselecteerd`,
  count: (n: number) => (n > 1 ? `Deze ${n} zinnen` : "Deze zin"),
  listen: "Deze zin afspelen",
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  mute: (allMuted: boolean, n: number) => allMuted ? pluralForm('nl', n, { one: 'Dempen van deze zin opheffen', other: `Dempen van deze ${n} zinnen opheffen` }) : `${these(n)} dempen`,
  muteHint: (allMuted: boolean): string => (allMuted ? "Nasynchronisatie voor deze zinnen herstellen" : "Deze zinnen worden stil · ook in exports"),
  remove: (n: number) => `${these(n)} verwijderen`,
  removeHint: "Verwijdert van het nasynchronisatiespoor · kan ongedaan worden gemaakt",
  removeGroup: "Deze nasynchronisatiegroep verwijderen",
  removeGroupHint: (bed: boolean) =>
    `${bed ? "Verwijdert die samen met de achtergrondaudio" : "Verwijdert alle nasynchronisatie in deze taal"} · oorspronkelijke audio die hierdoor is gedempt komt terug`,
  labelMute: "Nasynchronisatie dempen",
  labelUnmute: "Dempen van nasynchronisatie opheffen",
  labelRemove: "Nasynchronisatie verwijderen",
  labelRemoveGroup: (language: string) => `Nasynchronisatie verwijderen (${language})`,
  labelStretch: "Nasynchronisatiesnelheid wijzigen",
  muted: (n: number) => `Gedempt: ${sentences(n)} van nasynchronisatie`,
  unmuted: (n: number) => `Dempen opgeheven: ${sentences(n)} van nasynchronisatie`,
  removed: (n: number) => `Verwijderd: ${sentences(n)} van nasynchronisatie`,
  groupRemoved: (language: string) =>
    `Verwijderd: ‘Nasynchronisatie · ${language}’ · het lege nasynchronisatiespoor en nasynchronisatieplandocument blijven in de video`,
  planUnread: "Kan het nasynchronisatieplan niet lezen: oorspronkelijke audio die hierdoor is gedempt is niet hersteld. Je kunt het dempen opheffen op de oorspronkelijke clips.",
};

export const nlDubRegen: DubRegenMessages = {

  headMenu: (label: string) => `‘${label}’-spoor`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      sentences(c.total),
      c.failed ? `${c.failed} niet gesynthetiseerd` : "",
      c.fast ? `${c.fast} te snel` : "",
      c.muted ? `${c.muted} gedempt` : "",
      c.queued ? `${c.queued} opnieuw genereren` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  listenDub: "Nasynchronisatie beluisteren",
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `Nasynchronisatie van deze groep${o.bed ? " + achtergrond" : ""} · ${o.duck ? "origineel verlaagd" : "origineel gedempt"}${o.others ? " · andere talen uit" : ""}`,
  listenDubKeep: "Deze nasynchronisatiegroep heeft de oorspronkelijke audio behouden en niet geregistreerd welke delen dat waren; gebruik ‘Beide beluisteren’",
  listenOriginal: "Origineel beluisteren",
  listenOriginalHint: (others: boolean) => `Herstelt de oorspronkelijke audio van de video · ${others ? "alle nasynchronisatiegroepen" : "deze nasynchronisatiegroep"} gedempt`,
  listenBoth: "Beide beluisteren",
  listenBothHint: (bed: boolean) => `Om te vergelijken${bed ? " · achtergrond van deze groep uit" : ""}`,
  sourceLabel: { dub: "Nasynchronisatie beluisteren", original: "Origineel beluisteren", both: "Beide beluisteren" },
  sourceDone: {
    dub: (language: string) => `Luisteren: ‘Nasynchronisatie · ${language}’`,
    original: "Origineel afspelen · nasynchronisatie gedempt",
    both: "Origineel en nasynchronisatie samen afspelen",
  },
  regenSome: (n: number) => (n ? `Opnieuw genereren: ${sentences(n)}…` : "Opnieuw genereren…"),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast
      ? `${[failed ? `${failed} niet gesynthetiseerd` : "", fast ? `${fast} te snel` : ""].filter(Boolean).join(" · ")} · je kunt eerst de vertaling bewerken`
      : "Geen mislukte of te snelle zinnen",
  redub: "Opnieuw inspreken…",
  redubHint: "Opent Vertaalde nasynchronisatie: wijzig de taal of stem en voer de hele groep opnieuw uit",
  readOnly: "De video is alleen-lezen",

  regenBlocks: (n: number) => `${these(n)} opnieuw genereren`,
  regenBlocksHint: "Dezelfde vertaling en stem opnieuw synthetiseren · nieuwe seed · oude opname blijft behouden",
  retext: "Vertaling bewerken en opnieuw inspreken…",
  retextHint: "Controleer eerst de lengtes en bewerk de vertaling, en spreek daarna alleen deze zinnen opnieuw in",
  inQueue: "Sommige zinnen worden opnieuw gegenereerd",

  queued: "Opnieuw genereren…",
  queuedTip: (text: string) => `${text} · opnieuw genereren`,
  version: (k: number, seed: number | null) => (seed === null ? `Opname ${k}` : `Opname ${k} · seed ${seed}`),

  submitted: (n: number) => `Opnieuw genereren gestart: ${sentences(n)} van nasynchronisatie`,
  submitFailed: (message: string) => `Kan niet beginnen met opnieuw genereren: ${message}`,
  grantRefused: (recipient: string) =>
    `Opnieuw genereren stuurt de vertaling naar ${recipient}; daarvoor is nog geen toestemming. Geef die bij Instellingen of begin opnieuw vanuit Vertaalde nasynchronisatie`,
  busy: "Deze groep wordt ingediend; een ogenblik",
  done: (replaced: number, total: number) =>
    replaced === total ? `Opnieuw gegenereerd: ${sentences(replaced)} van nasynchronisatie` : `Opnieuw gegenereerd: ${replaced}/${total} zinnen van nasynchronisatie`,
  doneNone: "Geen zin heeft een nieuwe opname gekregen",
  notPlaced: (status: string, n: number) => status === 'overlong' ? pluralForm('nl', n, { one: `${n} zin paste niet; de vorige opname is behouden`, other: `${n} zinnen pasten niet; de vorige opname is behouden` }) : status === 'stale' ? pluralForm('nl', n, { one: `${n} zin had een verouderde vertaling en is niet gesynthetiseerd`, other: `${n} zinnen hadden een verouderde vertaling en zijn niet gesynthetiseerd` }) : status === 'voice-unavailable' ? pluralForm('nl', n, { one: `${n} zin had een niet-beschikbare stem en is niet gesynthetiseerd`, other: `${n} zinnen hadden een niet-beschikbare stem en zijn niet gesynthetiseerd` }) : pluralForm('nl', n, { one: `${n} zin staat niet op de tijdlijn`, other: `${n} zinnen staan niet op de tijdlijn` }),
  failed: (message: string) => `Opnieuw genereren niet voltooid: ${message}`,
  cancelled: "Opnieuw genereren geannuleerd",
  undo: "Ongedaan maken",
  undoMissing: "Kan de bewerking van deze nieuwe generatie niet vinden; gebruik Ongedaan maken in de editor",
  labelRetext: "Vertaling bewerken (opnieuw inspreken)",

  fitTitle: (n: number) => `Vertaling bewerken en opnieuw inspreken: ${sentences(n)}`,
  fitIntro:
    "Je bewerkt de vertaalde zin die wordt ingesproken (bewerkte zinnen worden gemarkeerd als nagekeken); ondertitels die ervan zijn gemaakt worden niet opnieuw gesplitst. Elke zin wordt opnieuw gesynthetiseerd met een nieuwe seed en de oude opname blijft behouden.",
  fitDub: (seconds: number, rate: string) => `Nasynchronisatie ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  fitVoice: "Niet gesynthetiseerd: stem niet beschikbaar",
  fitOverlong: (seconds: number | null) => (seconds === null ? "Niet geplaatst: te lang" : `Niet geplaatst: ${seconds.toFixed(1)} s te lang`),
  fitLoading: "Vertaling laden…",
  fitUnreadable: (message: string) => `Kan de vertaling van deze nasynchronisatie niet lezen (${message}); alleen opnieuw inspreken vanuit de oorspronkelijke vertaling`,
  fitMissing: "Deze zin staat niet in de vertaling; opnieuw inspreken vanuit het script in het plan",
  fitText: (index: number) => `Vertaling van zin ${index}`,
  fitCancel: "Annuleren",
  fitSubmit: (n: number, changed: number) => (changed ? `Bewerken: ${changed} en opnieuw inspreken: ${sentences(n)}` : `Opnieuw inspreken: ${sentences(n)}`),
  fitBusy: "Indienen…",

  takesTitle: "Opnamen",
  takesAside: (n: number) => `${n} ${pluralForm('nl', n, { one: "opname", other: "opnamen" })}`,
  takeCurrent: "Huidig",
  takeUse: "Deze opname gebruiken",
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `seed ${seed}` : "",
      seconds !== null ? `${seconds.toFixed(1)} s` : "niet geplaatst",
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  takeUnavailable: "Deze opname staat niet op de tijdlijn of de media kunnen niet worden gevonden",
  takesNote: "Elke nieuwe generatie registreert een opname; terugwisselen naar een oudere opname is een bewerking die je ongedaan kunt maken en synthetiseert niet opnieuw.",
  takeName: (k: number) => `Opname ${k}`,
  labelSwitchTake: (k: number) => `Wisselen naar nasynchronisatie-opname ${k}`,
  switched: (k: number) => `Gewisseld naar opname ${k}`,
  regenThis: "Deze zin opnieuw genereren",
  unreadableFormat: "Niet-herkend formaat",
  unreadableNoTranslation: "Het plan heeft geen vertaling",
};
