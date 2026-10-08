import type { ApprovalsMessages } from './approvals-copy.ts';
export const nl: ApprovalsMessages = {
 help: `Gebruik:
  baocut approvals                 Wachtende goedkeuringen uit sessies en externe diensten tonen
  baocut approvals allow <id>      Een wachtende goedkeuring toestaan; goedkeuringen die gegevens delen
                                   gelden standaard alleen deze keer (bedrag onbekend)
    --persist                      Ook een blijvende toestemming geven (dezelfde gegevensdeling vraagt niet opnieuw)
    --scope <video|all>            Bereik van de blijvende toestemming: de video van deze aanroep (standaard) of alle video’s
    --max-calls <n>                Aanroeplimiet voor de blijvende toestemming
    --budget <amount> --currency <currency>
                                   Uitgavenlimiet voor de blijvende toestemming (alleen modellen met prijzen;
                                   aanroepen waarvan de kosten niet te schatten zijn vragen elke keer goedkeuring)
    --expires <ISO time>           Wanneer de blijvende toestemming verloopt
  baocut approvals deny <id>       Een wachtende goedkeuring weigeren`,
 persistNeedsAllow: '--persist hoort alleen bij allow', alreadyResolved: (id) => `Goedkeuring ${id} is al afgehandeld, verlopen of geannuleerd (of bestaat niet)`, allowed: (id) => `${id} toegestaan`, denied: (id) => `${id} geweigerd`, unknownMode: (value, flags) => `Onbekende toegangsmodus: ${value}. --mode accepteert ${flags.join(', ')}`, mode: (label, flag) => `${label} (${flag})`, usage: 'Gebruik: baocut approvals [list | allow <approval id> | deny <approval id>]', riskLabels: { read: 'Lezen', edit: 'Bewerken', command: 'Opdracht', high: 'Hoog risico' }, none: 'Geen wachtende goedkeuringen', fromSession: (title) => `Sessie ‘${title}’`, fromService: (serviceId, clientName) => `Dienst ${serviceId} · ${clientName}`, basisMode: (mode) => `modus ${mode}`, basisLevel: (level) => `niveau ${level}`, approvalLine: (a) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? '' : `, automatisch geweigerd over ${a.secondsLeft} s`})`, runCommand: (command) => `Opdracht uitvoeren: ${command}`, changeFiles: (files) => `Bestanden wijzigen: ${files.join(', ')}`, callTool: (tool, files) => `${tool} aanroepen${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};
