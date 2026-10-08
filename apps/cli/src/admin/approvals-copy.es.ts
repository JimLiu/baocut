import type { ApprovalsMessages } from './approvals-copy.ts';
export const es: ApprovalsMessages = {
 help: `Uso:
  baocut approvals                 Listar aprobaciones pendientes de sesiones y servicios externos
  baocut approvals allow <id>      Permitir una aprobación pendiente; las aprobaciones que comparten datos
                                   se permiten solo esta vez por defecto (importe desconocido)
    --persist                      Crear también una autorización permanente (no se volverá a preguntar por el mismo envío)
    --scope <video|all>            Ámbito de la autorización permanente: el vídeo de esta llamada (predeterminado) o todos
    --max-calls <n>                Límite de llamadas de la autorización permanente
    --budget <amount> --currency <currency>
                                   Límite de gasto de la autorización permanente (solo modelos con precio;
                                   las llamadas cuyo coste no se puede estimar necesitan aprobación cada vez)
    --expires <ISO time>           Caducidad de la autorización permanente
  baocut approvals deny <id>       Denegar una aprobación pendiente`,
 persistNeedsAllow: '--persist solo se usa con allow', alreadyResolved: (id) => `La aprobación ${id} ya se gestionó, caducó o se canceló (o no existe)`, allowed: (id) => `Permitido ${id}`, denied: (id) => `Denegado ${id}`, unknownMode: (value, flags) => `Modo de acceso desconocido: ${value}. --mode acepta ${flags.join(', ')}`, mode: (label, flag) => `${label} (${flag})`, usage: 'Uso: baocut approvals [list | allow <approval id> | deny <approval id>]', riskLabels: { read: 'Lectura', edit: 'Edición', command: 'Comando', high: 'Riesgo alto' }, none: 'Sin aprobaciones pendientes', fromSession: (title) => `Sesión «${title}»`, fromService: (serviceId, clientName) => `Servicio ${serviceId} · ${clientName}`, basisMode: (mode) => `modo ${mode}`, basisLevel: (level) => `nivel ${level}`,
 approvalLine: (a) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? '' : `, se deniega automáticamente en ${a.secondsLeft} s`})`, runCommand: (command) => `Ejecutar comando: ${command}`, changeFiles: (files) => `Cambiar archivos: ${files.join(', ')}`, callTool: (tool, files) => `Llamar a ${tool}${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};
