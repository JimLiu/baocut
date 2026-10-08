import {
  MCP_DEFAULT_PORT,
  MODEL_API_DEFAULT_PORT,
  WEB_DEFAULT_PORT,

  type ServiceLevel,
  type ServiceStatus,
} from '@baocut/protocol';
const s = (n: number) => pluralForm('fr', n, { one: '', other: 's' });
import { pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const fr: ServicesMessages = {
  accessLinkVideo: (video: string) => `Après connexion, l’éditeur de la vidéo ${video} s’ouvre directement`,


  help: `Utilisation :
  baocut services [status]         Services externes : état, adresse, niveau et portée des services MCP,
                                   API de modèles, web et du nœud réseau local
  baocut services start <service>  Démarrer un service (mcp, model-api, web, node)
  baocut services stop <service>   Arrêter un service (ferme les connexions externes et annule les demandes
                                   en attente de confirmation ; les tâches soumises vont jusqu’au bout)
  baocut services configure <service> [options]
    --port <port>                  Port d’écoute (boucle locale uniquement ; MCP par défaut ${MCP_DEFAULT_PORT}, API de modèles
                                   ${MODEL_API_DEFAULT_PORT}) ; si occupé, le service signale une erreur sans changer de port
    --level read|ask|auto          read est en lecture seule ; ask demande confirmation de chaque écriture, tâche
                                   et génération dans BaoCut (par défaut) ; auto les exécute directement
    --videos all|<id,…>            Exposer toutes les vidéos ou ces videoIds uniquement (séparés par des virgules) ; les autres
                                   restent invisibles à l’extérieur (aucune portée pour l’API de modèles)
    --autostart on|off             Démarrer avec le Runtime
    --route-online on|off          API de modèles : transférer aux services en ligne activés (désactivé par défaut, modèles locaux seuls)
    --route-nodes on|off           API de modèles : transférer aux nœuds réseau local jumelés (désactivé par défaut)
    --route-agent on|off           API de modèles : transférer aux fournisseurs Agent (désactivé par défaut)
    --max-concurrent <n>           API de modèles : requêtes simultanées par client (4 par défaut) ; au-delà, erreur 429
    --read-only on|off             web uniquement : consultation seule, sans modification, message ni soumission de tâche
    --methods default|<method,…>   web uniquement : méthodes autorisées (noms ou <namespace>.*), peut seulement réduire l’ensemble par défaut
  baocut services mcp add-client <name>
                                   Créer un jeton pour une application externe (affiché une seule fois) ;
                                   un par application, révocable séparément
  baocut services mcp clients      Lister les clients créés (sans jetons)
  baocut services mcp revoke <clientId>
                                   Révoquer un client ; son jeton cesse immédiatement de fonctionner
  baocut services mcp connection [clientId]
                                   Afficher l’adresse et un extrait à coller dans les réglages d’un client MCP
                                   (avec jeton fictif)
  baocut services model-api add-client|clients|revoke|connection …
                                   Clients de l’API de modèles (point d’accès local de type OpenAI), mêmes commandes ;
                                   ses jetons et ceux de MCP ne sont pas interchangeables ;
                                   connection indique comment définir OPENAI_BASE_URL et OPENAI_API_KEY
  baocut services model-api aliases
                                   Lister les alias de modèles (par défaut whisper-1 → modèle local de transcription par défaut)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Ajouter ou modifier un alias ; sans modèle, celui du fournisseur par défaut est utilisé
  baocut services model-api unalias <name>
                                   Supprimer un alias
  baocut services web sessions     Lister les sessions de navigateur (sans jetons de session)
  baocut services web revoke <sessionId>
                                   Révoquer une session de navigateur : connexion immédiatement fermée`,

  webHelp: `Utilisation :
  baocut web open [--video <videoId>] [--launch]       Démarrer le service web (port par défaut ${WEB_DEFAULT_PORT}) et afficher un lien d’accès à usage unique, valable
                                   une seule fois pendant deux minutes. --video ouvre directement la vidéo dans l’éditeur (videoId fourni par
                                   baocut videos list). --launch ouvre la page de connexion sans code dans le navigateur par défaut ;
                                   le code d’accès n’est affiché que dans le terminal, pour le coller dans la page de connexion
                                   (il n’est pas transmis comme argument de la commande ouvrant le navigateur)`,
  usage:
    "Utilisation : baocut services [status | start <service> | stop <service>\n" +
    "       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n" +
    "                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n" +
    "                    [--read-only on|off] [--methods default|<method,…>]\n" +
    "       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n" +
    "       | mcp|model-api connection [clientId]\n" +
    "       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n" +
    "       | web sessions | web revoke <sessionId>]",
  unknownService: (id: string, available: readonly string[]) => `Service inconnu : ${id}. Disponibles : ${available.join(", ")}`,
  addClientUsage: (service: 'mcp' | 'model-api') =>
    `Utilisation : baocut services ${service} add-client <name> (choisissez un nom reconnaissable, par exemple ${service === 'mcp' ? "Claude Desktop" : "Outil de sous-titres"})`,
  aliasUsage: (capabilities: readonly string[]) =>
    `Utilisation : baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (capacités : ${capabilities.join(", ")})`,
  unknownCapability: (capability: string, available: readonly string[]) =>
    `Capacité inconnue : ${capability}. Disponibles : ${available.join(", ")}`,
  onOff: (flag: string) => `${flag} doit être on ou off`,
  portRange: "--port doit être un entier de 1 à 65535",
  levelChoice: (levels: readonly string[]) => `--level doit être une valeur parmi : ${levels.join(", ")}`,
  videosFormat: "--videos doit être all ou des identifiants de vidéo séparés par des virgules",
  maxConcurrentRange: "--max-concurrent doit être un entier de 1 à 64",
  routingOnlyModelApi: "--route-online, --route-nodes, --route-agent et --max-concurrent s’appliquent uniquement à model-api",
  methodsFormat: "--methods doit être default, ou des noms de méthodes et <namespace>.* séparés par des virgules",
  webOnlyFlags: "--read-only et --methods s’appliquent uniquement au service web",
  nothingToConfigure:
    "Rien à modifier : indiquez --port, --level, --videos, --autostart, le routage et la concurrence de model-api, ou --read-only et --methods pour web",
  states: {
    off: "Désactivé",
    starting: "Démarrage",
    on: "Activé",
    stopping: "Arrêt",
    error: "Erreur",
  } satisfies Record<ServiceStatus['state'], string>,
  levels: {
    read: "read (lecture seule)",
    ask: "ask (confirmer chaque écriture)",
    auto: "auto (exécution directe)",
  } satisfies Record<ServiceLevel, string>,
  levelAskModelApi: "ask (confirmer chaque demande de génération)",
  notProvided: (serviceId: string, label: string) => `${serviceId}  ${label}  Indisponible dans cette version`,
  port: (port: number) => `port ${port}`,
  reason: (error: string) => `  Motif : ${error}`,
  nodeHint: "  Utilisez baocut share pour le port, les capacités et le jumelage",
  autostart: (on: boolean) => `  Démarrer avec le Runtime : ${on ? "oui" : "non"}`,
  level: (level: string) => `  Niveau : ${level}`,
  levelScope: (level: string, scope: string) => `  Niveau : ${level}  Portée : ${scope}`,
  allVideos: "toutes les vidéos",
  someVideos: (ids: readonly string[]) => `${ids.length} vidéo${s(ids.length)} (${ids.join(", ")})`,
  routeLocal: "cet ordinateur",
  routeOnline: "services en ligne",
  routeNodes: "nœuds du réseau local",
  routeAgent: "Agent",
  routing: (routes: readonly string[], maxConcurrent: number) =>
    `  Routage vers : ${routes.join(", ")}  ${maxConcurrent} requête simultanée${s(maxConcurrent)} par client`,
  aliases: (aliases: readonly string[]) => `  Alias : ${aliases.length > 0 ? aliases.join(", ") : "aucun"}`,
  clientCount: (count: number) => `  Clients : ${count}`,
  web: (readOnly: boolean, methods: readonly string[] | null) =>
    `  Lecture seule : ${readOnly ? "oui" : "non"}  Méthodes autorisées : ${methods === null ? "ensemble par défaut" : methods.join(", ")}`,
  browserSessions: (count: number) => `  Sessions du navigateur : ${count} (lien d’accès : baocut web open)`,
  aliasTarget: (alias: string, providerId: string, modelId: string | null, capability: string) =>
    `${alias} → ${providerId}/${modelId ?? "modèle par défaut"} (${capability})`,
  noAliases: "Aucun alias. Ajoutez-en un avec baocut services model-api alias <name> <capability> <providerId>[/<modelId>]",
  noClients: (service: string) => `Aucun client. Créez-en un avec baocut services ${service} add-client <name>`,
  client: (clientId: string, name: string, createdAt: string, lastUsedAt: string | null) =>
    `${clientId}  ${name}  créé ${createdAt}  dernière utilisation ${lastUsedAt ?? "jamais"}`,
  clientCreated: (name: string, clientId: string) => `Client créé : ${name} (${clientId})`,
  tokenOnce: (token: string) =>
    `Jeton (affiché une seule fois ; copiez-le et enregistrez-le maintenant. Si vous le perdez, révoquez le client et créez-en un autre) : ${token}`,
  address: (url: string) => `URL : ${url}`,
  bearerHeader: "En-tête : Authorization: Bearer <token>",
  header: (value: string) => `En-tête : Authorization: ${value}`,
  interfaceVersion: (version: string) => `Version de l’interface : ${version}`,
  snippetIntro: "Extrait de réglages (remplacez le jeton fictif par celui fourni à la création du client) :",
  noWebSessions: "Aucune session de navigateur. Obtenez un lien d’accès avec baocut web open",
  webSession: (sessionId: string, createdAt: string, lastUsedAt: string, expiresAt: string, connections: number) =>
    `${sessionId}  connecté ${createdAt}  dernière utilisation ${lastUsedAt}  expire ${expiresAt}  ${connections} connexion${s(connections)}`,
  accessLinkNote: (expiresAt: string) =>
    `Ce lien fonctionne une seule fois et reste valide jusqu’à ${expiresAt} ; ne le partagez pas. Après utilisation ou expiration, relancez baocut web open`,
  badAccessLink: "Le lien d’accès n’a pas le format attendu : mettez BaoCut à jour ou relancez sans --launch",
  accessCode: (code: string) => `Code d’accès : ${code}`,
  launchNote: (loginUrl: string, expiresAt: string) =>
    `Collez ce code dans la page de connexion ouverte dans votre navigateur (${loginUrl}). Le code fonctionne une fois et reste valide jusqu’à ${expiresAt} ; ne le partagez pas. Après utilisation ou expiration, relancez baocut web open`,
  webNotStarted: (reason: string) => `Le service web n’a pas démarré : ${reason}`,
  serviceError: (serviceId: string, reason: string) => `${serviceId} en échec : ${reason}`,
  clientRevoked: (clientId: string) => `Révoqué : ${clientId} ; son jeton cesse immédiatement de fonctionner`,
  webSessionRevoked: (sessionId: string) => `Révoqué : ${sessionId} ; sa connexion a été fermée`,
  browserFailed: (message: string) => `Impossible d’ouvrir le navigateur : ${message}. Ouvrez vous-même la page de connexion ci-dessus`,
};
