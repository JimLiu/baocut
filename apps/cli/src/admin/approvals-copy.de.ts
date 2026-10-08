import type { ApprovalsMessages } from './approvals-copy.ts';

export const de: ApprovalsMessages = {
  help: `Verwendung:
  baocut approvals                 Ausstehende Genehmigungen aus Sitzungen und externen Diensten auflisten
  baocut approvals allow <id>      Eine ausstehende Genehmigung erlauben; Datenweitergaben werden
                                   standardmäßig nur einmal genehmigt (Betrag unbekannt)
    --persist                      Zusätzlich eine dauerhafte Berechtigung erteilen (dieselbe Weitergabe fragt nicht erneut)
    --scope <video|all>            Umfang der dauerhaften Berechtigung: Video dieses Aufrufs (Standard) oder alle Videos
    --max-calls <n>                Aufruflimit der dauerhaften Berechtigung
    --budget <amount> --currency <currency>
                                   Ausgabenlimit der dauerhaften Berechtigung (nur für Modelle mit Preis;
                                   Aufrufe ohne schätzbare Kosten benötigen jedes Mal eine Genehmigung)
    --expires <ISO time>           Ablaufzeit der dauerhaften Berechtigung
  baocut approvals deny <id>       Eine ausstehende Genehmigung ablehnen`, persistNeedsAllow: '--persist ist nur mit allow zulässig', alreadyResolved: (id) => `Genehmigung ${id} wurde bereits bearbeitet, ist abgelaufen oder wurde abgebrochen (oder existiert nicht)`, allowed: (id) => `Genehmigt: ${id}`, denied: (id) => `Abgelehnt: ${id}`, unknownMode: (value, flags) => `Unbekannter Zugriffsmodus: ${value}. --mode akzeptiert ${flags.join(', ')}`, mode: (label, flag) => `${label} (${flag})`, usage: 'Verwendung: baocut approvals [list | allow <approval id> | deny <approval id>]', riskLabels: { read: 'Lesen', edit: 'Bearbeiten', command: 'Befehl', high: 'Hohes Risiko' }, none: 'Keine ausstehenden Genehmigungen', fromSession: (title) => `Sitzung „${title}“`, fromService: (serviceId, clientName) => `Dienst ${serviceId} · ${clientName}`, basisMode: (mode) => `Modus ${mode}`, basisLevel: (level) => `Stufe ${level}`, approvalLine: (a) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? '' : `, in ${a.secondsLeft} s automatisch abgelehnt`})`, runCommand: (command) => `Befehl ausführen: ${command}`, changeFiles: (files) => `Dateien ändern: ${files.join(', ')}`, callTool: (tool, files) => `${tool} aufrufen${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};
