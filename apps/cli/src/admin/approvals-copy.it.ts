import type { ApprovalsMessages } from './approvals-copy.ts';

export const it: ApprovalsMessages = {
  help: `Uso:
  baocut approvals                 Elenca le approvazioni in attesa, da sessioni e servizi esterni
  baocut approvals allow <id>      Consente un’approvazione in attesa; le approvazioni che condividono dati
                                   sono consentite solo questa volta per impostazione predefinita (costo sconosciuto)
    --persist                      Concede anche un’autorizzazione persistente (la stessa condivisione non verrà richiesta di nuovo)
    --scope <video|all>            Ambito dell’autorizzazione persistente: il video di questa chiamata (predefinito) o tutti i video
    --max-calls <n>                Limite di chiamate per l’autorizzazione persistente
    --budget <amount> --currency <currency>
                                   Limite di spesa per l’autorizzazione persistente (solo modelli con prezzi;
                                   le chiamate con costo non stimabile richiedono approvazione ogni volta)
    --expires <ISO time>           Scadenza dell’autorizzazione persistente
  baocut approvals deny <id>       Nega un’approvazione in attesa`,
  persistNeedsAllow: '--persist si usa solo con allow', alreadyResolved: (id: string) => `L’approvazione ${id} è già stata gestita, è scaduta o è stata annullata (o non esiste)`, allowed: (id: string) => `Consentito: ${id}`, denied: (id: string) => `Negato: ${id}`,
  unknownMode: (value: string, flags: readonly string[]) => `Modalità di accesso sconosciuta: ${value}. --mode accetta ${flags.join(', ')}`, mode: (label: string, flag: string) => `${label} (${flag})`,
  usage: 'Uso: baocut approvals [list | allow <approval id> | deny <approval id>]', riskLabels: { read: 'Lettura', edit: 'Modifica', command: 'Comando', high: 'Rischio elevato' }, none: 'Nessuna approvazione in attesa',
  fromSession: (title: string) => `Sessione «${title}»`, fromService: (serviceId: string, clientName: string) => `Servizio ${serviceId} · ${clientName}`, basisMode: (mode: string) => `modalità ${mode}`, basisLevel: (level: string) => `livello ${level}`,
  approvalLine: (a) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? '' : `, negata automaticamente tra ${a.secondsLeft} s`})`,
  runCommand: (command: string) => `Esegui comando: ${command}`, changeFiles: (files: readonly string[]) => `Modifica file: ${files.join(', ')}`, callTool: (tool: string, files: readonly string[]) => `Chiama ${tool}${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};
