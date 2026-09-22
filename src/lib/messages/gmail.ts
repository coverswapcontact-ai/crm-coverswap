import { PORTEES_GOOGLE, appelGoogle } from "@/lib/google/connexion";
import { decoderEntites, htmlEnTexte, lireAdresse, lireAdresses, nettoyerTexte } from "./texte";

/**
 * Appels à l'API Gmail, au plus juste : lister, lire un message et ses pièces
 * jointes, changer ses libellés (archiver = retirer de la boîte de réception),
 * envoyer. Aucune fonction de corbeille ni de suppression : un mail archivé
 * reste dans « Tous les messages », sous le libellé du CRM.
 */

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const LIBELLE_BRUIT = "CoverSwap CRM/Bruit archivé";

type EnTeteGmail = { name: string; value: string };
export type PartieGmail = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: EnTeteGmail[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: PartieGmail[];
};
export type MessageGmail = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: PartieGmail;
};

async function lireReponse(reponse: Response, action: string): Promise<Record<string, unknown>> {
  const corps = (await reponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!reponse.ok) {
    const message = (corps.error as { message?: string } | undefined)?.message ?? `HTTP ${reponse.status}`;
    throw new Error(`Gmail : ${action} impossible (${message})`);
  }
  return corps;
}

/** Identifiants des messages qui répondent à la recherche Gmail, du plus récent au plus ancien. */
export async function listerMessagesGmail(recherche: string, limite: number): Promise<{ id: string; threadId: string | null }[]> {
  const resultat: { id: string; threadId: string | null }[] = [];
  let page: string | undefined;
  do {
    const parametres = new URLSearchParams({ q: recherche, maxResults: String(Math.min(100, limite - resultat.length)) });
    if (page) parametres.set("pageToken", page);
    const corps = await lireReponse(await appelGoogle(`${API}/messages?${parametres}`, { portee: PORTEES_GOOGLE.GMAIL_MODIFIER, method: "GET" }), "lecture de la boîte");
    for (const message of (corps.messages as { id: string; threadId?: string }[] | undefined) ?? []) {
      resultat.push({ id: message.id, threadId: message.threadId ?? null });
    }
    page = typeof corps.nextPageToken === "string" ? corps.nextPageToken : undefined;
  } while (page && resultat.length < limite);
  return resultat;
}

/** Le message complet ; null s'il n'existe plus dans la boîte. */
export async function lireMessageGmail(id: string): Promise<MessageGmail | null> {
  const reponse = await appelGoogle(`${API}/messages/${encodeURIComponent(id)}?format=full`, { portee: PORTEES_GOOGLE.GMAIL_MODIFIER, method: "GET" });
  if (reponse.status === 404) return null;
  return (await lireReponse(reponse, "lecture d'un message")) as unknown as MessageGmail;
}

function trouverPartie(partie: PartieGmail | undefined, identifiant: string): PartieGmail | null {
  if (!partie) return null;
  if (partie.partId === identifiant) return partie;
  for (const enfant of partie.parts ?? []) {
    const trouvee = trouverPartie(enfant, identifiant);
    if (trouvee) return trouvee;
  }
  return null;
}

export function decoderBase64Url(donnees: string): Buffer {
  return Buffer.from(donnees.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Contenu d'une pièce jointe. L'identifiant de pièce de Gmail change d'une
 * lecture à l'autre : on relit le message et on retrouve la partie par son
 * numéro, qui lui est stable.
 */
export async function lirePieceGmail(messageId: string, partie: string): Promise<Buffer> {
  const message = await lireMessageGmail(messageId);
  if (!message) throw new Error("Message introuvable dans la boîte mail.");
  const trouvee = trouverPartie(message.payload, partie);
  if (!trouvee) throw new Error("Pièce jointe introuvable dans le message.");
  if (trouvee.body?.data) return decoderBase64Url(trouvee.body.data);
  if (!trouvee.body?.attachmentId) throw new Error("Pièce jointe vide.");
  const corps = await lireReponse(
    await appelGoogle(`${API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(trouvee.body.attachmentId)}`, {
      portee: PORTEES_GOOGLE.GMAIL_MODIFIER,
      method: "GET",
    }),
    "lecture d'une pièce jointe"
  );
  return decoderBase64Url(String(corps.data ?? ""));
}

const cacheLibelles = new Map<string, string>();

/** Identifiant du libellé (créé s'il n'existe pas). */
export async function libelleGmail(nom: string): Promise<string> {
  const connu = cacheLibelles.get(nom);
  if (connu) return connu;
  const corps = await lireReponse(await appelGoogle(`${API}/labels`, { portee: PORTEES_GOOGLE.GMAIL_MODIFIER, method: "GET" }), "lecture des libellés");
  const existant = ((corps.labels as { id: string; name: string }[] | undefined) ?? []).find((libelle) => libelle.name === nom);
  if (existant) {
    cacheLibelles.set(nom, existant.id);
    return existant.id;
  }
  const cree = await lireReponse(
    await appelGoogle(`${API}/labels`, {
      portee: PORTEES_GOOGLE.GMAIL_MODIFIER,
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: nom, labelListVisibility: "labelShow", messageListVisibility: "show" }),
    }),
    `création du libellé « ${nom} »`
  );
  cacheLibelles.set(nom, String(cree.id));
  return String(cree.id);
}

/** Essais seulement : oublie les libellés connus. */
export function oublierLibellesGmail(): void {
  cacheLibelles.clear();
}

/** Ajoute ou retire des libellés. Retirer INBOX archive le message ; le remettre le ramène dans la boîte. */
export async function modifierLibellesGmail(id: string, changement: { ajouter?: string[]; retirer?: string[] }): Promise<"FAIT" | "INTROUVABLE"> {
  const reponse = await appelGoogle(`${API}/messages/${encodeURIComponent(id)}/modify`, {
    portee: PORTEES_GOOGLE.GMAIL_MODIFIER,
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ addLabelIds: changement.ajouter ?? [], removeLabelIds: changement.retirer ?? [] }),
  });
  if (reponse.status === 404) return "INTROUVABLE";
  await lireReponse(reponse, "rangement d'un message");
  return "FAIT";
}

/** Envoie un message MIME déjà construit ; rend ses identifiants Gmail. */
export async function envoyerMessageGmail(mime: Buffer, fil: string | null): Promise<{ id: string; threadId: string | null }> {
  const corps = await lireReponse(
    await appelGoogle(`${API}/messages/send`, {
      portee: PORTEES_GOOGLE.GMAIL_ENVOYER,
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ raw: mime.toString("base64url"), ...(fil ? { threadId: fil } : {}) }),
    }),
    "envoi"
  );
  return { id: String(corps.id), threadId: typeof corps.threadId === "string" ? corps.threadId : null };
}

/* ── Lecture d'un message Gmail ─────────────────────────────────────── */

/** En-têtes gardés : ceux qui servent au tri (bruit, fil) et aux réponses. */
const ENTETES_GARDES = [
  "message-id",
  "in-reply-to",
  "references",
  "reply-to",
  "list-unsubscribe",
  "list-id",
  "precedence",
  "auto-submitted",
  "x-autoreply",
  "x-auto-response-suppress",
  "return-path",
  "date",
];

export type PieceRecue = { rang: number; nom: string; typeMime: string; taille: number; partie: string; enLigne: boolean };

/** Message reçu ou envoyé, quel que soit le canal (mail aujourd'hui, WhatsApp demain). */
export type MessageRecu = {
  canal: "EMAIL" | "WHATSAPP";
  compte: string;
  identifiantCanal: string;
  filCanal: string | null;
  sens: "ENTRANT" | "SORTANT";
  de: string;
  deNom: string | null;
  a: string[];
  objet: string | null;
  extrait: string | null;
  texte: string | null;
  recuLe: Date;
  entetes: Record<string, string>;
  libelles: string[];
  pieces: PieceRecue[];
};

const TEXTE_MAX = 100_000;

const TYPES_PAR_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

function enTetes(partie: PartieGmail | undefined): Map<string, string> {
  return new Map((partie?.headers ?? []).map((entete) => [entete.name.toLowerCase(), entete.value]));
}

function decoderCorps(partie: PartieGmail): string {
  const octets = decoderBase64Url(partie.body?.data ?? "");
  const jeu = /charset="?([^";\s]+)"?/i.exec(enTetes(partie).get("content-type") ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(jeu).decode(octets);
  } catch {
    return new TextDecoder("utf-8").decode(octets);
  }
}

function parcourir(partie: PartieGmail | undefined, visite: (partie: PartieGmail) => void): void {
  if (!partie) return;
  visite(partie);
  for (const enfant of partie.parts ?? []) parcourir(enfant, visite);
}

export function versMessageRecu(message: MessageGmail, compte: string): MessageRecu {
  const entetes = enTetes(message.payload);
  const libelles = message.labelIds ?? [];
  const expediteur = lireAdresse(entetes.get("from"));
  const destinataires = [...lireAdresses(entetes.get("to")), ...lireAdresses(entetes.get("cc"))].map((adresse) => adresse.adresse);

  const corps: { brut: string | null; html: string | null } = { brut: null, html: null };
  const pieces: PieceRecue[] = [];
  parcourir(message.payload, (partie) => {
    const type = (partie.mimeType ?? "").toLowerCase();
    const disposition = (enTetes(partie).get("content-disposition") ?? "").toLowerCase();
    if (partie.filename) {
      const extension = partie.filename.split(".").pop()?.toLowerCase() ?? "";
      const typeMime = type && type !== "application/octet-stream" ? type : (TYPES_PAR_EXTENSION[extension] ?? (type || "application/octet-stream"));
      pieces.push({
        rang: pieces.length + 1,
        nom: partie.filename.slice(0, 200),
        typeMime,
        taille: partie.body?.size ?? 0,
        partie: partie.partId ?? String(pieces.length),
        enLigne: disposition.startsWith("inline") && enTetes(partie).has("content-id"),
      });
      return;
    }
    if (disposition.startsWith("attachment")) return;
    if (type === "text/plain" && corps.brut === null && partie.body?.data) corps.brut = decoderCorps(partie);
    if (type === "text/html" && corps.html === null && partie.body?.data) corps.html = decoderCorps(partie);
  });
  const texte = corps.brut !== null ? nettoyerTexte(corps.brut) : corps.html !== null ? htmlEnTexte(corps.html) : null;

  const gardes: Record<string, string> = {};
  for (const nom of ENTETES_GARDES) {
    const valeur = entetes.get(nom);
    if (valeur) gardes[nom] = valeur.slice(0, 2000);
  }

  return {
    canal: "EMAIL",
    compte,
    identifiantCanal: message.id,
    filCanal: message.threadId ?? null,
    sens: libelles.includes("SENT") ? "SORTANT" : "ENTRANT",
    de: expediteur?.adresse ?? (entetes.get("from") ?? "inconnu").slice(0, 160),
    deNom: expediteur?.nom ?? null,
    a: [...new Set(destinataires)].slice(0, 50),
    objet: entetes.get("subject")?.slice(0, 500) ?? null,
    extrait: message.snippet ? decoderEntites(message.snippet).slice(0, 300) : null,
    texte: texte ? texte.slice(0, TEXTE_MAX) : null,
    recuLe: new Date(Number(message.internalDate ?? Date.now())),
    entetes: gardes,
    libelles,
    pieces: pieces.slice(0, 20),
  };
}

/* ── Historique incrémental (mission 7) ─────────────────────────────── */

/** Libellé des mails rangés d'office par le CRM (réversible : retirer le libellé les remonte). */
export const LIBELLE_RANGE = "CoverSwap/Rangé";

/** Le point courant de l'historique de la boîte. */
export async function profilGmail(): Promise<{ adresse: string; historyId: string }> {
  const corps = await lireReponse(await appelGoogle(`${API}/profile`, { portee: PORTEES_GOOGLE.GMAIL_MODIFIER, method: "GET" }), "lecture du profil");
  return { adresse: String(corps.emailAddress ?? ""), historyId: String(corps.historyId ?? "") };
}

export type ChangementsGmail = {
  /** Messages apparus (reçus ou envoyés), dans l'ordre. */
  ajoutes: string[];
  /** Libellés actuels des messages dont les libellés ont changé (INBOX, UNREAD, CoverSwap/Rangé…). */
  libelles: Map<string, string[]>;
  historyId: string;
};

/**
 * Ce qui a changé dans la boîte depuis `depuis` (history.list). `null` si ce
 * point de l'historique n'existe plus chez Gmail (trop ancien) : il faut alors
 * relire la boîte par recherche.
 */
export async function changementsGmail(depuis: string, limite = 2000): Promise<ChangementsGmail | null> {
  const ajoutes: string[] = [];
  const libelles = new Map<string, string[]>();
  let historyId = depuis;
  let page: string | undefined;
  let vus = 0;
  do {
    const parametres = new URLSearchParams({ startHistoryId: depuis, maxResults: "500" });
    for (const type of ["messageAdded", "labelAdded", "labelRemoved"]) parametres.append("historyTypes", type);
    if (page) parametres.set("pageToken", page);
    const reponse = await appelGoogle(`${API}/history?${parametres}`, { portee: PORTEES_GOOGLE.GMAIL_MODIFIER, method: "GET" });
    if (reponse.status === 404) return null;
    const corps = await lireReponse(reponse, "lecture de l'historique");
    type Element = { message?: { id?: string; labelIds?: string[] } };
    for (const entree of (corps.history as { messagesAdded?: Element[]; labelsAdded?: Element[]; labelsRemoved?: Element[] }[] | undefined) ?? []) {
      vus++;
      for (const ajout of entree.messagesAdded ?? []) {
        const id = ajout.message?.id;
        if (id && !ajoutes.includes(id)) ajoutes.push(id);
        if (id && ajout.message?.labelIds) libelles.set(id, ajout.message.labelIds);
      }
      for (const changement of [...(entree.labelsAdded ?? []), ...(entree.labelsRemoved ?? [])]) {
        const id = changement.message?.id;
        if (id && changement.message?.labelIds) libelles.set(id, changement.message.labelIds);
      }
    }
    if (typeof corps.historyId === "string") historyId = corps.historyId;
    page = typeof corps.nextPageToken === "string" ? corps.nextPageToken : undefined;
  } while (page && vus < limite);
  return { ajoutes, libelles, historyId };
}

/** Libellés actuels d'un message (lecture légère) ; null s'il n'existe plus. */
export async function libellesDuMessage(id: string): Promise<string[] | null> {
  const reponse = await appelGoogle(`${API}/messages/${encodeURIComponent(id)}?format=minimal`, { portee: PORTEES_GOOGLE.GMAIL_MODIFIER, method: "GET" });
  if (reponse.status === 404) return null;
  const corps = await lireReponse(reponse, "lecture des libellés d'un message");
  return (corps.labelIds as string[] | undefined) ?? [];
}
