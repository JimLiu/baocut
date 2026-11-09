import type { McpMessages } from './mcp-copy.ts';

export const fr: McpMessages = {
  previousClientUnknown: "Impossible d’identifier le client utilisé par l’entrée remplacée ; aucun client n’a donc été révoqué : baocut mcp status liste les clients existants ; révoquez ceux inutilisés avec baocut services mcp revoke <clientId>",
  defaultProjectRegistered: (name: string, path: string) => `BaoCut n’avait aucun projet : projet par défaut « ${name} » (${path}) enregistré pour que les Agents externes y créent des vidéos`,


  help: `Utilisation :
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--transport stdio|http] [--level ask|auto] [--name <client name>] [--yes]
                                   Connecter un Agent externe au service MCP de BaoCut : démarrer le service (avec démarrage
                                   au lancement du Runtime), créer un client et jeton pour l’Agent, puis écrire adresse et jeton
                                   dans ses réglages MCP (entrée baocut) ; redémarrer ensuite l’Agent
                                   Si BaoCut n’a aucun projet, enregistrer le projet CLI dans le dossier par défaut pour les Agents externes
    --transport stdio|http         stdio (par défaut) : l’agent exécute baocut mcp serve --stdio, qui trouve ou démarre lui-même le
                                   Runtime de BaoCut ; http : écrit l’adresse du service, utilisable seulement quand le Runtime tourne
    --level ask|auto               Niveau : ask demande confirmation de chaque écriture et tâche dans BaoCut (par défaut) ;
                                   auto les exécute directement. Absent, le niveau actuel est conservé
    --name <client name>           Nom du client affiché dans BaoCut (nom de l’Agent par défaut) ; révocable séparément
    --yes                          Si l’Agent a déjà une entrée baocut, la remplacer et révoquer le client utilisé par l’ancienne
                                   (identifié par l’ancien jeton ; sinon, les clients de même nom sont
                                   listés pour décider lesquels révoquer). Sinon, aucun écrasement ni création de client
  Stockage du jeton : Claude Code le conserve dans env (BAOCUT_MCP_TOKEN) de ~/.claude/settings.json, les réglages le référencent.
  Codex (~/.codex/config.toml), Cursor (~/.cursor/mcp.json) et Gemini CLI (~/.gemini/settings.json) n’ont pas d’emplacement pour
  les variables d’environnement : le jeton est écrit en clair dans leurs fichiers. Ne les commitez ni ne les partagez ; préférez
  le niveau ask ; en cas de fuite, révoquez avec baocut services mcp revoke <clientId>.
  Le service est disponible seulement quand le Runtime de BaoCut fonctionne (ouvrez BaoCut, ou lancez baocut runtime ensure).
  baocut mcp status                État, adresse, niveau et clients du service MCP, et présence d’une entrée baocut
                                   dans les réglages de chaque Agent (sans les jetons)
  baocut mcp serve --stdio         Ce que lance l’entrée stdio : un serveur MCP stdio qui relaie vers le service MCP avec le jeton de
                                   BAOCUT_MCP_TOKEN et trouve ou démarre le Runtime au besoin. C’est l’agent qui le lance, pas un terminal`,
  entryExists: (file: string, entry: string) => `${file} contient déjà une entrée ${entry} ; rien n’a été modifié. Ajoutez --yes pour la remplacer`,
  serviceNotAvailable: "Cette version de BaoCut ne fournit pas le service MCP",
  serviceStartFailed: (reason: string | null) => `Le service MCP n’a pas démarré : ${reason ?? "motif inconnu"}`,
  connected: (host: string, url: string) => `Connexion de ${host} au service MCP de BaoCut : ${url}`,
  configEnv: (configFile: string, envFile: string, envVar: string) =>
    `Réglages : ${configFile} (le jeton se trouve dans env.${envVar} de ${envFile} ; les réglages ne font que le référencer)`,
  configPlaintext: (configFile: string, clientId: string) =>
    `Réglages : ${configFile} (le jeton est enregistré en clair dans ce fichier : ne le commitez ni ne le partagez ; en cas de fuite, révoquez-le avec baocut services mcp revoke ${clientId})`,
  clientLine: (name: string, clientId: string, level: string | null) => `Client : ${name} (${clientId})  Niveau : ${level ?? "—"}`,
  restartHint: (host: string) =>
    `Redémarrez ${host} pour appliquer les changements. Le service fonctionne avec le Runtime de BaoCut : s’il est arrêté, ouvrez BaoCut ou exécutez d’abord baocut runtime ensure`,
  replacedRevoked: (name: string, clientId: string) => `Ancienne entrée remplacée et son client révoqué : ${name} (${clientId})`,
  replacedRevokeFailed: (reason: string) => `Ancienne entrée remplacée, mais impossible de révoquer son client : ${reason}`,
  oldClientRemains: (ids: readonly string[]) =>
    `L’ancien client est toujours présent : ${ids.join(", ")}. S’il n’est plus utilisé : baocut services mcp revoke <clientId>`,

  sameNameClientsRemain: (ids: readonly string[], unrecognized: boolean) =>
    `${unrecognized ? "Impossible d’identifier le client de l’ancienne entrée ; des clients" : "Des clients"} du même nom sont toujours présents : ${ids.join(", ")}. S’ils ne sont plus utilisés : baocut services mcp revoke <clientId>`,
  hostsHeading: (entry: string) => `Présence d’une entrée ${entry} dans les réglages de chaque Agent :`,
  hostUnreadable: (problem: string) => `lecture impossible (${problem})`,
  hostConfigured: "oui",
  hostNotConfigured: "non",
  noServiceStatus: "Le Runtime n’a pas communiqué l’état du service MCP",
  levelChoice: (value: string) => `--level doit être ask ou auto : ${value}`,
  connectedStdio: (host, command) => `${host} est connecté au service MCP de BaoCut via stdio : ${host} lance ${command}`,
  configEnvInherited: (configFile, envFile, envVar) =>
    `Réglages : ${configFile} (le jeton se trouve dans env.${envVar} de ${envFile} ; la commande en hérite)`,
  restartHintStdio: (host) =>
    `Redémarrez ${host} pour appliquer les changements. ${host} lance la commande lui-même, et la commande démarre le Runtime de BaoCut s’il est arrêté`,
  transportChoice: (value) => `--transport doit valoir stdio ou http : ${value}`,
  serveTokenMissing: (envVar) =>
    `${envVar} n’est pas défini : aucun jeton pour le service MCP de BaoCut. Exécutez baocut mcp install --agent <agent> pour l’écrire dans les réglages MCP de l’agent`,
  serveServiceOff: 'Le service MCP de BaoCut est désactivé : activez-le dans BaoCut ou exécutez baocut services configure mcp --autostart on',
  serveTokenRejected: 'Le service MCP de BaoCut a refusé le jeton (révoqué, ou émis par un autre Runtime Home) : relancez baocut mcp install --agent <agent> --yes',
  serveRuntimeLost: 'Le Runtime de BaoCut s’est arrêté pendant cette requête ; elle n’a pas été relancée',
  serveRuntimeUnavailable: (reason) => `Impossible de joindre le Runtime de BaoCut : ${reason}`,
  serveHttpStatus: (status) => `Le service MCP de BaoCut a répondu HTTP ${status}`,
};
