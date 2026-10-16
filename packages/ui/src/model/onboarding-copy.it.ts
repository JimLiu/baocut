import type { OnboardingMessages } from './onboarding-copy.ts';

export const it: OnboardingMessages = {
  dialogLabel: 'Ti diamo il benvenuto in BaoCut',
  stepsLabel: 'Passaggi di configurazione',
  step: {
    agent: 'Collega un agente',
    asr: 'Riconoscimento vocale',
    tts: 'Sintesi vocale',
    semantic: 'Ricerca semantica',
    image: 'Generazione di immagini',
    music: 'Generazione di musica',
  },
  title: {
    agent: 'Ti diamo il benvenuto in BaoCut',
    asr: 'Scarica i modelli di riconoscimento vocale',
    tts: 'Scarica i modelli di sintesi vocale',
    semantic: 'Installa la ricerca semantica',
    image: 'Scarica i modelli di generazione di immagini',
    music: 'Scarica i modelli di generazione di musica',
  },
  lead: {
    agent:
      'Descrivi il video che vuoi e un agente trascrive, aggiunge i sottotitoli, traduce, doppia e monta per te. BaoCut usa gli agenti di questo computer (come Claude Code o Codex) con il tuo account, senza costi aggiuntivi.',
    asr: 'Trascrivere, aggiungere sottotitoli e montare video parlati partono tutti dal trasformare il parlato in testo. I modelli girano su questo computer e funzionano offline.',
    tts: 'I modelli di sintesi vocale leggono il testo ad alta voce, clonano una voce da una registrazione e doppiano i video tradotti. Scegline uno o due per iniziare; scarica gli altri più tardi in Impostazioni › Sintesi vocale.',
    semantic:
      'Trova ciò che è stato detto e mostrato in base al significato: la usano la ricerca di Space, la scelta del materiale per argomento, l’abbinamento delle immagini e la memoria di traduzione. Una volta installata, i video esistenti vengono indicizzati in background.',
    image: 'Genera immagini da una frase su questo computer, per copertine e illustrazioni. I modelli sono grandi e la generazione è lenta.',
    music:
      'Genera musica di sottofondo e canzoni da uno stile o da un testo su questo computer, pronte da aggiungere alla traccia musicale di un video. La generazione è lenta: qualche minuto ogni 30 secondi.',
  },
  where: {
    tts: {
      title: 'Si usa in Strumenti › Genera voce',
      body: 'Scrivi un testo, oppure scegli un documento o dei sottotitoli in Space, poi scegli un modello e una voce. Anche i modelli non ancora scaricati si possono scaricare da lì.',
    },
    image: { title: 'Si usa in Strumenti › Genera immagine', body: 'Descrivi l’immagine in una frase. Anche gli agenti la usano per creare copertine.' },
    music: {
      title: 'Si usa in Strumenti › Genera musica',
      body: 'Scegli uno stile e scrivi il testo. La musica viene salvata in Space e si può aggiungere ai tuoi video.',
    },
  },
  diarizes: 'Distingue i parlanti durante la trascrizione',
  needsDiarization: (pack) => `Per distinguere i parlanti, scarica anche «${pack}»`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 voci predefinite · descrivi uno stile di parlato in una frase',
    'qwen3-tts-0.6b-base': 'Clona una voce da una registrazione di 3 secondi',
    voxcpm2: 'Clona una voce da una registrazione · descrivi uno stile · 30 lingue e cantonese',
    'qwen-image-2.1-turbo': 'Distillato · 8 passaggi fissi · più del doppio più veloce del modello base',
    'qwen-image-2.1': 'Modello base · più lento, più passaggi',
    'yue2-3b': 'Genera da uno stile o da un testo · qualche minuto ogni 30 secondi',
  },
  recommended: 'Consigliato',
  installed: 'Installato',
  missingParts: 'Componenti mancanti',
  planLine: (parts) => `Scaricati insieme: ${parts}`,
  downloading: (name) => `Download di ${name}`,
  inBackground: 'Download in background',
  bgNote: 'Prima del download vedrai da dove proviene e dove viene salvato. Parte solo dopo la tua conferma e procede in background, quindi non devi aspettare.',
  asrAlt: 'Non vuoi scaricare nulla? Puoi anche aggiungere più tardi il riconoscimento vocale nel cloud in Impostazioni › Provider API.',
  unsupported: 'Questo computer non può eseguire questi modelli. Puoi saltare questo passaggio.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'Agenti su questo computer',
  agentChecking: 'Ricerca degli agenti su questo computer…',
  agentMissingBody: 'Seleziona quelli che vuoi e BaoCut li installa in background. Una volta installati, accedi una volta con il tuo account esistente.',
  agentNote:
    'Gli agenti selezionati compaiono nel menu degli agenti delle nuove sessioni. L’installazione procede in background, quindi non devi aspettare. Scegli quello predefinito o aggiungine altri in Impostazioni › Provider degli agenti.',
  agentInstalled: 'Installato su questo computer',
  agentFix: (problem) => `${problem} · Risolvi in Impostazioni › Provider degli agenti`,
  agentManual: 'Installalo nel terminale seguendo le istruzioni ufficiali · Vedi Impostazioni › Provider degli agenti',
  agentNotInstalled: (plan) => (plan ? `Non installato · Dopo l’installazione accedi con: ${plan}` : 'Non installato'),
  agentWillInstall: (method, command, login) =>
    `Verrà installato in background con ${method} (${command}) · Poi esegui ${login} nel terminale per accedere`,
  agentInstalling: (method, login) => `Installazione in background con ${method} · Poi esegui ${login} nel terminale per accedere`,
  agentInstallingLabel: (name) => `Installazione di ${name}`,
  agentInstallFailed: 'Installazione non riuscita · I dettagli sono in Attività in background',

  next: 'Avanti',
  finish: 'Fatto',
  skip: 'Salta',
  exit: 'Esci dalla configurazione',
  install: (n) => `Installa ${n} in background e continua`,
  download: (size, last) => `Scarica${size ? ` ${size}` : ''} in background e ${last ? 'termina' : 'continua'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return kind === 'install' ? `Installazione di ${name}${tail}` : kind === 'download' ? `Download di ${name}${tail}` : `Preparazione di ${name}${tail}`;
    },
    many: (kind, n) =>
      kind === 'install' ? `${n} installazioni in background` : kind === 'download' ? `${n} download in background` : `${n} attività in background`,
    idle: (kind) =>
      kind === 'install' ? 'Installazioni in background' : kind === 'download' ? 'Download in background' : 'Download e installazioni in background',
    done: (kind, n) => {
      const e = n > 1 ? 'i' : 'o';
      return kind === 'install' ? `${n} installat${e}` : kind === 'download' ? `${n} scaricat${e}` : `${n} completat${e}`;
    },
    failed: (kind, n) => {
      const e = n > 1 ? 'i' : 'o';
      return kind === 'install' ? `${n} non installat${e}` : kind === 'download' ? `${n} non scaricat${e}` : `${n} non completat${e}`;
    },
  },
  closedToast: (models, agents) => {
    const parts = [
      ...(models ? [models === 1 ? '1 modello si sta scaricando' : `${models} modelli si stanno scaricando`] : []),
      ...(agents ? [agents === 1 ? '1 agente si sta installando' : `${agents} agenti si stanno installando`] : []),
    ];
    return `${parts.join(' e ')} in background. ${models + agents === 1 ? 'Sarà pronto all’uso al termine.' : 'Saranno pronti all’uso al termine.'}`;
  },
  viewTasks: 'Visualizza attività in background',
};
