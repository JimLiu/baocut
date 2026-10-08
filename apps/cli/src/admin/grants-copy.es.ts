import type { GrantsMessages } from './grants-copy.ts';
import { pluralForm } from '@baocut/protocol';
const callsEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'llamada', other: 'llamadas' })}`;
export const es: GrantsMessages = {
 help: `Uso:
  baocut grants [list]             Listar autorizaciones de envío de datos (proveedores en línea y de agentes):
                                   destinatario, tipos de datos, ámbito, uso y presupuesto
    --recipient <id>               Solo las autorizaciones de este proveedor
    --video <video id>             Solo las autorizaciones que cubren este vídeo
    --include-ended                Incluir autorizaciones revocadas, caducadas y agotadas
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   Crear una autorización. Tipos: transcript (transcripciones y traducciones), frames (fotogramas),
                                   audio (audio), video (vídeo original), document (texto y prompts), context (contexto del agente)
    --video <video id|all>         Cubrir solo este vídeo; omitido o all significa todos los vídeos
    --max-calls <n>                Límite de llamadas; ilimitadas si se omite
    --budget <amount> --currency <currency>
                                   Límite de gasto: estimado y reservado según el precio del modelo;
                                   se rechazan llamadas a modelos sin precio (BUDGET_UNVERIFIABLE)
    --expires <ISO time>           Caducidad
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   Cambiar una autorización; restringirla, reducir un límite o adelantar la caducidad
                                   rechaza al empezar las llamadas en cola bajo las condiciones anteriores
  baocut grants revoke <id>        Revocar una autorización: no se permiten llamadas posteriores; los datos ya
                                   enviados y costes ya contados se muestran tal cual
  baocut grants usage <id>         Uso de una autorización y las tareas que la usaron (reservas y liquidaciones)`,
 usage: 'Uso: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options] | update <grant id> [options] | revoke <grant id> | usage <grant id>]', listSep: ', ', missingRecipient: 'Falta --recipient (el proveedor que recibe los datos, por ejemplo openai)', missingData: (kinds) => `Falta --data (tipos de datos separados por comas: ${kinds.join(', ')})`, missingPurpose: 'Falta --purpose (una frase para que la lean personas)', recipientFixed: 'No se puede cambiar el destinatario: revoca esta autorización y crea otra', nothingToUpdate: 'Nada que cambiar: proporciona --data, --video, --purpose, --max-calls, --budget o --expires', persistOnly: '--scope, --max-calls, --budget y --expires solo se usan con --persist', scopeChoices: '--scope acepta video o all', unknownKinds: (unknown, kinds) => `Tipo de datos desconocido: ${unknown}. Elige entre ${kinds.join(', ')}`, maxCallsRange: '--max-calls debe ser un entero entre 1 y 1000000, o none (sin límite)', currencyNeedsBudget: '--currency solo se usa con --budget', budgetFormat: '--budget debe ser un importe decimal no negativo con un máximo de 6 decimales (por ejemplo 5 o 2.50)', budgetNeedsCurrency: '--budget necesita --currency <código de moneda de tres letras, por ejemplo USD>', expiresFormat: '--expires debe ser una hora ISO con zona horaria (por ejemplo 2026-12-31T23:59:59Z), o none',
 stateLabels: { active: 'Activa', expired: 'Caducada', revoked: 'Revocada', exhausted: 'Agotada' }, originLabels: { user: 'autorizada por ti', approval: 'autorizada al aprobar', 'provider-enable': 'predeterminada al activar' }, calls: (calls, reserved, max) => `${calls}${reserved ? `+${reserved} reservadas` : ''}${max !== null ? `/${max}` : ''} ${max === null && !reserved ? pluralForm('es', calls, { one: 'llamada', other: 'llamadas' }) : 'llamadas'}`, unknownCostCalls: (n) => ` (${n} con coste desconocido)`, callsAndAmount: (calls, amount, reserved, cap, currency) => `${calls}, ${amount}${reserved ? `+${reserved} reservados` : ''}/${cap} ${currency}`, noGrants: 'Sin autorizaciones: las llamadas a proveedores en línea y de agentes pedirán aprobación (o crea una con baocut grants create)', scopeVideo: (videoId) => `vídeo ${videoId}`, scopeAll: 'todos los vídeos',
 grantLine: (g) => `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, solo tarea ${g.taskId}` : ''}${g.once ? ', solo esta vez' : ''}  uso ${g.usage}${g.expiresAt ? `, caduca ${g.expiresAt}` : ''}  (${g.origin}: ${g.purpose})`, revoked: (id, recipient, kinds) => `Revocada ${id} (${recipient} ← ${kinds})`, alreadySent: (calls, amount, unknownCostCalls) => `Ya enviado: ${callsEs(calls)}${amount ? `, ${amount} contados` : ''}${unknownCostCalls ? ` (${unknownCostCalls} con coste desconocido)` : ''}`, runningJobs: (jobs) => `Tareas aún en curso (terminarán normalmente): ${jobs.join(', ')}`, noJobs: '(Ninguna tarea la ha usado aún o se han limpiado los registros de tareas)', settled: (calls, amount, basis) => `liquidadas ${callsEs(calls)} ${amount} (${basis})`, unsettled: 'sin liquidar', jobLine: (jobId, state, calls, amount, settled) => `  ${jobId}  ${state}  reservadas ${callsEs(calls)} ${amount}  ${settled}`, approvalGrant: (a) => `    Envía: ${a.recipient} ← ${a.kinds}${a.videoId ? ` (vídeo ${a.videoId})` : ''}: ${a.purpose}${a.estimate ? `, estimado ${a.estimate}` : ', coste desconocido'}${a.maxCalls !== null ? `, como máximo ${callsEs(a.maxCalls)}` : ''}${a.reason === 'revoked' ? ', autorización revocada o caducada' : a.reason === 'unverifiable' ? ', no se puede estimar el coste' : ''}`,
};
