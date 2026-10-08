import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const nl: ToolTargetsMessages = {
  unknownLanguage: "Onbekende taal",
  langCount: (label: string, count: number) => `${label} ×${count}`,
  joinLangs: (labels: readonly string[]) => labels.join(", "),
  tagTranscript: (langs: string) => `Transcript · ${langs}`,
  tagTranslation: (langs: string) => `Vertaling · ${langs}`,
  tagDub: (langs: string) => `Nasynchronisatie · ${langs}`,
  tagPending: "De inhoud wordt nog gelezen; bij het starten wordt een transcript gekozen",
  blockTranscribing: 'Wordt nu getranscribeerd; je kunt opnieuw transcriberen wanneer het klaar is',
  blockQueued: 'Al in de wachtrij voor transcriptie',
  blockTranscribingWait: 'Wordt nu getranscribeerd; je kunt het kiezen wanneer het klaar is',
  blockQueuedWait: 'In de wachtrij voor transcriptie; je kunt het kiezen wanneer het is getranscribeerd',
  blockFailed: 'De laatste transcriptie is mislukt; transcribeer het eerst opnieuw',
  blockNoTranscript: 'Nog geen transcript; transcribeer het eerst',
  duplicateTranscript: (langs: string) =>
    `Deze video heeft al een transcript in ${langs}. Standaard wordt een nieuwe video gemaakt en blijven deze video en zijn vertalingen ongewijzigd. Met ‘Transcript van deze video vervangen’ wordt het huidige transcript gewisseld: vertalingen gaan mee door de brontekst te koppelen, zinnen met een gewijzigde brontekst worden als verouderd gemarkeerd, en het geheel is één wijziging die je ongedaan kunt maken.`,
  duplicateTranslation: (lang: string) =>
    `Deze video heeft al een versie in ${lang} als vertaling. Dit voegt er een toe met behoud van de bestaande; kies in de editor welke je wilt gebruiken.`,
  duplicateDub: (lang: string) => `Deze video heeft al een versie in ${lang} als nasynchronisatie. Dit voegt een extra set toe met behoud van de bestaande.`,
  duplicateTitle: {
    transcribe: 'Deze video heeft al een transcript',
    'translate-subtitles': "Bestaande vertalingen blijven behouden",
    dub: "Bestaande nasynchronisaties blijven behouden",
  },
  translationOption: (lang: string, nth: number | null) => `${lang} vertaling${nth === null ? "" : ` #${nth}`}`,
  translatedFrom: (lang: string) => `Uit het ${lang} transcript`,
  destNewVideo: 'Nieuwe video',
  destNewVideoNote:
    'Een nieuwe video in hetzelfde project die naar hetzelfde materiaal linkt; deze video en zijn vertalingen blijven ongewijzigd',
  destReplace: 'Transcript van deze video vervangen',
  destReplaceNote:
    'Wisselt het huidige transcript; vertalingen, ondertitels en nasynchronisaties gaan mee in dezelfde wijziging, die je ongedaan kunt maken',
  newVideoName: (name: string) => `${name} · Opnieuw getranscribeerd`,
  impactTranslation: (lang: string, units: number) => `${lang} · ${units} ${units === 1 ? 'zin' : 'zinnen'}`,
  impactDub: (lang: string, groups: number) =>
    `${lang} · ${groups} ${groups === 1 ? 'set' : 'sets'} · nasynchronisatie van zinnen met een ongewijzigde vertaling blijft behouden en wordt gemarkeerd als mogelijk niet synchroon`,
  impactRule:
    'Zinnen met een ongewijzigde brontekst behouden hun vertaling en controlestatus, uitgelijnd per zin; gewijzigde of niet te koppelen zinnen worden als verouderd gemarkeerd en daarna opnieuw vertaald met ‘Verouderde vertalingen bijwerken’. De precieze aantallen staan in het resultaat.',
  impactUndo: 'Eén wijziging, die je ongedaan kunt maken',
};
