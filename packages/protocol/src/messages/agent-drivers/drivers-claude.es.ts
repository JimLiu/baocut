import type { DriversClaudeMessages } from './drivers-claude.ts';
export const es: DriversClaudeMessages = {
 plan: 'Suscripción a Claude Pro o Max', installHint: 'Instala Claude Code', signedOut: 'Claude Code no ha iniciado sesión. Ejecuta claude en un terminal y sigue las indicaciones para iniciar sesión.',
 subscriptionPro: 'Suscripción a Claude Pro', subscriptionMax: 'Suscripción a Claude Max', subscriptionTeam: 'Suscripción a Claude Team', subscriptionEnterprise: 'Suscripción a Claude Enterprise',
 providerAnthropicAws: 'Anthropic (AWS)', providerAnthropicGoogleCloud: 'Anthropic (Google Cloud)', enterpriseGateway: 'Pasarela empresarial', claudeAccount: 'Cuenta de Claude',
 longLivedToken: 'Suscripción a Claude (token de larga duración)', apiKey: 'Clave de API de Anthropic', thirdPartyCloud: 'Nube de terceros',
 fromSettings: (p) => `De los ajustes de Claude Code (env.${p.key})`, imageUnsupported: (p) => `Claude no admite este formato de imagen: ${p.mimeType} (admite JPEG, PNG, GIF y WebP)`,
 defaultModel: 'modelo predeterminado', switchModelFailed: (p) => `Claude no pudo cambiar de modelo (${p.model}): ${p.error}`,
 autoUnsupported: (p) => `${p.model ? `El modelo ${p.model}` : 'El modelo actual'} no admite el modo de permisos «auto» de Claude${p.reason ? ` (${p.reason})` : ''}. Este turno se ejecuta en «preguntar cada vez» y preguntará antes de actuar.`,
 apiRetry: (p) => `Error de la API de Claude (${p.error}); reintento ${p.attempt}/${p.max}`,
 turnFailed: (p) => `El turno de Claude Code falló (${p.subtype})`,
 exitedPlanMode: (p) => `Claude Code salió del modo de planificación con el plan aprobado y empezará a hacer cambios. Mientras el modo de acceso siga en «${p.plan}», esos cambios se rechazarán. Para dejar que continúe, cambia el modo de acceso a «${p.edit}» u otro nivel.`,
};
