import type { HomeBriefMessages } from './home-brief.ts';

export const it: HomeBriefMessages = {
  about: (minutes: number, seconds: number) => `Circa ${[minutes ? `${minutes} min` : '', seconds ? `${seconds} s` : ''].filter(Boolean).join(' ')}`,
  fromMaterials: 'Crea un video dai materiali che ho allegato.',
  materials: (paths: readonly string[]) => `Materiali: ${paths.join(', ')}`,
  connectFirst: 'Connetti prima l’IA',
  sayFirst: 'Descrivi cosa vuoi creare o allega materiali',
  agentOffTitle: 'Tutti gli agenti di codice installati sono disattivati',
  agentOffBody: 'Un agente di codice è installato su questo computer ma disattivato nelle Impostazioni. Attivane uno per iniziare direttamente qui.',
  enableNamed: (name: string) => `Attiva ${name}`,
  enableAgent: 'Attiva agente',
  agentMissingTitle: 'Serve un agente di codice',
  agentMissingBody: 'Installa Claude Code o Codex CLI e accedi con il tuo abbonamento, poi torna qui per iniziare.',
  connectAgent: 'Connetti agente',
  nameEmpty: 'Inserisci un nome per il progetto',
  nameInvalid: 'Il nome del progetto non può contenere barre o caratteri di controllo',
};
