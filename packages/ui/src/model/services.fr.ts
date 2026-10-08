import { pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services.ts';

export const fr: ServicesMessages = {
  portRange: "Saisissez un port entre 1024 et 65535",
  portTaken: (port: number, service: string) => `${port} est déjà utilisé par « ${service} » ; choisissez un autre port`,
  browser: "Navigateur",
  sessionMeta: (connections: number, ago: string, expires: string | null) =>
    [connections ? `${connections} ${pluralForm('fr', connections, { one: "connexion", other: "connexions" })}` : "Aucune connexion", `Actif ${ago}`, expires ? `Expire à ${expires}` : null]
      .filter(Boolean)
      .join(" · "),
  runtime: { connected: "Connecté", incompatible: "Version incompatible", disconnected: "Non connecté" },
};
