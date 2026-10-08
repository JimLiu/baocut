import { pluralForm } from '@baocut/protocol';
import type { ToolRunsMessages } from './tool-runs-copy.ts';

export const nl: ToolRunsMessages = {
  diarizeStep: "Sprekers identificeren",

  phaseDone: "Klaar",
  phaseQueued: "In wachtrij",
  phaseCancelled: "Geannuleerd",
  phaseUnfinished: "Niet voltooid",
  phasePreparing: "Voorbereiden",
  stepAt: (cur: number, total: number) => `Stap ${cur} van ${total}`,
  cancelledAt: (step: string, at: string) => `Geannuleerd bij ‘${step}’ · ${at}`,
  stoppedAt: (step: string, at: string) => `Gestopt bij ‘${step}’ · ${at}`,
  runningAt: (step: string, at: string) => `${step} · ${at}`,
  stepDone: "Klaar",
  stepStopped: "Hier gestopt",
  stepRunning: "Bezig",
  stepWaiting: "Wachten",

  costEstimate: (amount: number | string, currency: string) => `Ongeveer ${amount} ${currency}`,
  costSubscription: (recipient: string) => `Inbegrepen bij je abonnement: ${recipient}`,
  costFree: "Gratis",
  costMetered: (recipient: string) => `Gefactureerd volgens de tarieven van ${recipient}; hier is geen schatting beschikbaar`,
  grantWhat: (kinds: readonly string[], purpose: string) => `${kinds.join(", ")} (${purpose})`,
  grantLoop: "Je hebt dit al goedgekeurd, maar de Runtime weigert nog steeds. Controleer deze toestemmingen bij Instellingen › Privacy en toestemmingen of kies een ander model.",

  noStructuredOutput: "Dit model ondersteunt geen gestructureerde uitvoer en kan daarom niet vertalen",

  captionsCreated: (p: { language: string | null; bilingual: boolean; disabled: boolean }) =>
    `Gemaakt: ${p.language ? `een ${p.language} ondertitellaag` : "een bewerkbare ondertitellaag"}${p.bilingual ? ", tweetalig weergegeven" : ""}${
      p.disabled ? " (dit mediabestand toont al ondertitels, dus de nieuwe laag staat eerst uit)" : ""
    }`,
  captionsExistingTranslation: "Deze vertaling heeft al een ondertitellaag, dus er is geen nieuwe gemaakt",
  captionsExistingTranscript: "Dit transcript heeft al een ondertitellaag, dus er is geen nieuwe gemaakt",
  captionsNotOnTimeline: "Geen clip op de tijdlijn gebruikt dit mediabestand, dus er is geen ondertitellaag gemaakt",
  captionsEmpty: "Er zijn geen ondertitels om te tonen, dus er is geen ondertitellaag gemaakt",
  originalAudio: { duck: "Oorspronkelijke audio verlaagd", mute: "Oorspronkelijke audio gedempt", keep: "Oorspronkelijke audio behouden" },

  thisVideo: "deze video",
  newVideo: "Nieuwe video",
  fallbackVideo: "Video",
  media: "media",
  savedFiles: (names: readonly string[]) => `Transcript en ondertitels opgeslagen: ${names.join(", ")}`,
  transcriptLanguage: (language: string, model: string | null) => `Transcripttaal: ${language}${model ? ` (${model})` : ""}`,
  createdVideoLinked: (video: string, project: string | null) =>
    `Video gemaakt: ‘${video}’${project ? ` in ‘${project}’` : ""}; het mediabestand blijft staan en wordt alleen gekoppeld`,
  wroteTranscript: (video: string) => `Transcript toegevoegd aan ‘${video}’`,
  speakersFound: (n: number) => `Gevonden: ${n} ${pluralForm('nl', n, { one: "spreker", other: "sprekers" })}; ondertitels en transcript zijn gelabeld met namen`,
  wroteTranslation: (video: string, language: string, source: string | null) => `Vertaling in ${language} toegevoegd aan ‘${video}’${source ? ` (uit het transcript in ${source})` : ""}; het origineel blijft ongewijzigd`,
  unitCount: (n: number) => `${n} ${pluralForm('nl', n, { one: "zin", other: "zinnen" })}`,
  subtitleFileWritten: (file: string, dir: string) => `Vertaald ondertitelbestand ${file} opgeslagen in ${dir}; aantal cues en tijdcodes ongewijzigd`,
  bilingualLayout: "Tweetalig: origineel boven, vertaling onder",
  markupStripped: (n: number) => `Inline-opmaak verwijderd uit ${n} oorspronkelijke ${pluralForm('nl', n, { one: "cue", other: "cues" })}`,
  dubTranslated: (language: string) => `Vertaald naar ${language}: eerst een nieuwe vertaling toegevoegd`,
  dubReusedTranslation: (language: string) => `Bestaande vertaling in ${language} gebruikt`,
  dubWritten: (video: string, language: string, engine: string) => `Nieuwe nasynchronisatie in ${language} toegevoegd aan ‘${video}’${engine ? ` (${engine})` : ""}; eerdere nasynchronisaties blijven behouden`,
  dubPlaced: (placed: number, total: number) => `${placed} van ${total} zinnen op de tijdlijn geplaatst`,
  linkCreatedVideo: (video: string, project: string | null) =>
    `Video gemaakt: ‘${video}’${project ? ` in ‘${project}’` : ""}; de gedownloade media staan op de tijdlijn`,
  linkAddedTo: (file: string, video: string) => `Toegevoegd: ${file} aan ‘${video}’; het bestand blijft in je downloadmap`,
  linkDownloaded: (file: string, dir: string | null) => `Gedownload: ${file}${dir ? ` naar ${dir}` : ""}`,
  linkTranscribedFiles: "Transcriptie klaar; TXT-transcript en SRT-ondertitels opgeslagen",
  linkTranscribed: "Transcriptie klaar; transcript toegevoegd. Dit pad maakt geen ondertitellaag; je kunt er een genereren in het paneel Ondertitels van de editor",
  replacedTranscript: (video: string) => `Transcript van ‘${video}’ vervangen: één wijziging, die je ongedaan kunt maken`,
  newVideoFrom: (video: string, project: string | null, original: string | null) =>
    `Video ‘${video}’ gemaakt${project ? ` in ‘${project}’` : ''}, gekoppeld aan hetzelfde materiaal; ${original ? `‘${original}’` : 'de oorspronkelijke video'} en zijn vertalingen blijven ongewijzigd`,
  carryTranslation: (language: string, kept: number, reviewed: number, stale: number) =>
    `Vertaling in ${language} · behouden: ${kept} (gecontroleerd: ${reviewed}) · verouderd: ${stale}`,
  carryPins: (reanchored: number, orphaned: number) => `Ondertitel-pins · opnieuw verankerd: ${reanchored} · orphaned: ${orphaned}`,
  carryDub: (language: string, kept: number, stale: number) => `Nasynchronisatie in ${language} · behouden: ${kept} · verouderd: ${stale}`,
  nothingToCarry: 'Deze video had geen vertalingen, ondertitel-pins of nasynchronisaties om mee te nemen',
  refreshHint: 'Vertaal verouderde zinnen opnieuw met ‘Verouderde vertalingen bijwerken’',
};
