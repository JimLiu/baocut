import type { OnboardingMessages } from './onboarding-copy.ts';

export const nl: OnboardingMessages = {
  dialogLabel: 'Welkom bij BaoCut',
  stepsLabel: 'Configuratiestappen',
  step: {
    agent: 'Een agent koppelen',
    asr: 'Spraakherkenning',
    tts: 'Spraaksynthese',
    semantic: 'Semantisch zoeken',
    image: 'Afbeeldingsgeneratie',
    music: 'Muziekgeneratie',
  },
  title: {
    agent: 'Welkom bij BaoCut',
    asr: 'Modellen voor spraakherkenning downloaden',
    tts: 'Modellen voor spraaksynthese downloaden',
    semantic: 'Semantisch zoeken installeren',
    image: 'Modellen voor afbeeldingsgeneratie downloaden',
    music: 'Modellen voor muziekgeneratie downloaden',
  },
  lead: {
    agent:
      'Beschrijf de video die je wilt, en een agent transcribeert, ondertitelt, vertaalt, synchroniseert na en monteert voor je. BaoCut gebruikt de agents op deze computer (zoals Claude Code of Codex) met je eigen account, zonder extra kosten.',
    asr: 'Transcriberen, ondertitelen en praatvideo’s monteren beginnen allemaal met het omzetten van spraak in tekst. De modellen draaien op deze computer en werken offline.',
    tts: 'Modellen voor spraaksynthese lezen tekst voor, klonen een stem uit een opname en synchroniseren vertaalde video’s na. Kies er eerst een of twee; download andere later via Instellingen › Spraaksynthese.',
    semantic:
      'Vindt wat er gezegd en getoond is op betekenis: zoeken in Space, materiaal kiezen op onderwerp, beelden koppelen en het vertaalgeheugen gebruiken het. Na de installatie worden je bestaande video’s op de achtergrond geïndexeerd.',
    image: 'Genereer op deze computer afbeeldingen uit één zin, voor omslagen en illustraties. De modellen zijn groot en genereren gaat langzaam.',
    music:
      'Genereer op deze computer achtergrondmuziek en liedjes op basis van een stijl of songtekst, klaar om aan het muziekspoor van een video toe te voegen. Genereren gaat langzaam: reken op een paar minuten voor 30 seconden.',
  },
  where: {
    tts: {
      title: 'Te gebruiken via Tools › Spraak genereren',
      body: 'Schrijf een tekst, of kies een document of ondertitels in Space, en kies dan een model en een stem. Modellen die je nog niet hebt gedownload, kun je daar ook downloaden.',
    },
    image: { title: 'Te gebruiken via Tools › Afbeelding genereren', body: 'Beschrijf de afbeelding in één zin. Agents gebruiken het ook om omslagen te maken.' },
    music: {
      title: 'Te gebruiken via Tools › Muziek genereren',
      body: 'Kies een stijl en schrijf een songtekst. De muziek wordt in Space opgeslagen en kan aan je video’s worden toegevoegd.',
    },
  },
  diarizes: 'Onderscheidt sprekers tijdens het transcriberen',
  needsDiarization: (pack) => `Download ook ‘${pack}’ om sprekers te onderscheiden`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 vooraf ingestelde stemmen · beschrijf een spreekstijl in één zin',
    'qwen3-tts-0.6b-base': 'Kloont een stem uit een opname van 3 seconden',
    voxcpm2: 'Kloont een stem uit een opname · beschrijf een stijl · 30 talen en Kantonees',
    'qwen-image-2.1-turbo': 'Gedistilleerd · vast 8 stappen · ruim twee keer zo snel als het basismodel',
    'qwen-image-2.1': 'Basismodel · langzamer, meer stappen',
    'yue2-3b': 'Genereert uit een stijl of songtekst · een paar minuten voor 30 seconden',
  },
  recommended: 'Aanbevolen',
  installed: 'Geïnstalleerd',
  missingParts: 'Ontbrekende onderdelen',
  planLine: (parts) => `Wordt samen gedownload: ${parts}`,
  downloading: (name) => `${name} wordt gedownload`,
  inBackground: 'Wordt op de achtergrond gedownload',
  bgNote: 'Voor het downloaden zie je waar het vandaan komt en waar het wordt opgeslagen. Het begint pas na je bevestiging en loopt op de achtergrond, dus je hoeft niet te wachten.',
  asrAlt: 'Liever niets downloaden? Je kunt later ook spraakherkenning in de cloud toevoegen via Instellingen › API-aanbieders.',
  unsupported: 'Deze computer kan deze modellen niet draaien. Je kunt deze stap overslaan.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'Agents op deze computer',
  agentChecking: 'Agents op deze computer zoeken…',
  agentMissingBody: 'Vink aan welke je wilt en BaoCut installeert ze op de achtergrond. Log daarna één keer in met je bestaande account.',
  agentNote:
    'Aangevinkte agents verschijnen in het agentmenu van nieuwe sessies. Installeren gebeurt op de achtergrond, dus je hoeft niet te wachten. Kies de standaard of voeg er meer toe via Instellingen › Agentaanbieders.',
  agentInstalled: 'Geïnstalleerd op deze computer',
  agentFix: (problem) => `${problem} · Los het op via Instellingen › Agentaanbieders`,
  agentManual: 'Installeer in de terminal volgens de officiële instructies · Zie Instellingen › Agentaanbieders',
  agentNotInstalled: (plan) => (plan ? `Niet geïnstalleerd · Na installatie inloggen met: ${plan}` : 'Niet geïnstalleerd'),
  agentWillInstall: (method, command, login) =>
    `Wordt op de achtergrond geïnstalleerd met ${method} (${command}) · Voer daarna ${login} uit in de terminal om in te loggen`,
  agentInstalling: (method, login) => `Wordt nu op de achtergrond geïnstalleerd met ${method} · Voer daarna ${login} uit in de terminal om in te loggen`,
  agentInstallingLabel: (name) => `${name} wordt geïnstalleerd`,
  agentInstallFailed: 'Installeren mislukt · Details staan bij Achtergrondtaken',

  next: 'Volgende',
  finish: 'Klaar',
  skip: 'Overslaan',
  exit: 'Configuratie afsluiten',
  install: (n) => `Op de achtergrond ${n} installeren en doorgaan`,
  download: (size, last) => `Op de achtergrond${size ? ` ${size}` : ''} downloaden en ${last ? 'afronden' : 'doorgaan'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return kind === 'install' ? `${name} wordt geïnstalleerd${tail}` : kind === 'download' ? `${name} wordt gedownload${tail}` : `${name} wordt ingesteld${tail}`;
    },
    many: (kind, n) =>
      kind === 'install' ? `${n} installaties op de achtergrond` : kind === 'download' ? `${n} downloads op de achtergrond` : `${n} taken op de achtergrond`,
    idle: (kind) =>
      kind === 'install' ? 'Installaties op de achtergrond' : kind === 'download' ? 'Downloads op de achtergrond' : 'Downloads en installaties op de achtergrond',
    done: (kind, n) => (kind === 'install' ? `${n} geïnstalleerd` : kind === 'download' ? `${n} gedownload` : `${n} klaar`),
    failed: (kind, n) => (kind === 'install' ? `${n} niet geïnstalleerd` : kind === 'download' ? `${n} niet gedownload` : `${n} niet voltooid`),
  },
  closedToast: (models, agents) => {
    const m = models === 1 ? '1 model wordt' : `${models} modellen worden`;
    const a = agents === 1 ? '1 agent wordt' : `${agents} agents worden`;
    const text = models && agents ? `${m} op de achtergrond gedownload en ${a} geïnstalleerd` : models ? `${m} op de achtergrond gedownload` : `${a} op de achtergrond geïnstalleerd`;
    return `${text}. ${models + agents === 1 ? (models ? 'Zodra het klaar is, kun je het gebruiken.' : 'Zodra hij klaar is, kun je hem gebruiken.') : 'Zodra ze klaar zijn, kun je ze gebruiken.'}`;
  },
  viewTasks: 'Achtergrondtaken bekijken',
};
