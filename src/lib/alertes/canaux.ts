/**
 * Alertes immédiates vers le téléphone du gérant.
 *
 * Un lead de publicité payante coûte plusieurs dizaines d'euros : rappeler dans
 * l'heure change le taux de signature. La notification part donc sur TOUS les
 * canaux, jamais sur un seul : si Telegram tombe, le mail passe, et inversement.
 * Aucun canal n'est bloquant ; chaque échec est journalisé et rendu à l'appelant,
 * qui décide quoi en faire.
 *
 * RÈGLE (20/09/2026) : le compte rendu contient TOUJOURS une ligne par canal,
 * y compris pour un canal non configuré. Avant, un canal sans variable était
 * simplement absent du tableau : la réponse du webhook disait « mail : ok » et
 * rien d'autre, ce qui se lisait comme « tout va bien » alors que le push
 * n'avait jamais été tenté. Un canal muet doit se voir.
 *
 * Canaux (chacun s'active en posant ses variables d'environnement) :
 *  - Telegram : TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID — notification poussée,
 *    gratuite, avec liens cliquables ; arrive même quand le CRM est fermé.
 *  - ntfy : NTFY_TOPIC (+ NTFY_SERVEUR, ntfy.sh par défaut) — notification
 *    poussée sans compte, application libre ; deuxième canal indépendant.
 *  - Mail : RESEND_API_KEY + LEAD_NOTIFICATION_EMAIL — filet toujours présent,
 *    mais un mail ne fait pas sonner un téléphone : ce n'est pas un push.
 */
import { Resend } from "resend";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { CANAUX, CANAUX_PUSH, variablesManquantes, type Canal, type ResultatCanal } from "./configuration";
import { decrireErreur, envoyerAvecRepli } from "./reseau";
import { consignerAlerte } from "./registre";
import { envoyerParRelais, relaisNtfyDisponible } from "./relais-ntfy";

export {
  CANAUX,
  CANAUX_PUSH,
  VARIABLES_CANAL,
  canalConfigure,
  canauxConfigures,
  pushDisponible,
  variablesManquantes,
} from "./configuration";
export type { Canal, ResultatCanal } from "./configuration";

export type Alerte = {
  /** Titre court, lu sur l'écran verrouillé. */
  titre: string;
  /** Corps en texte simple : ce qui doit être lisible sans ouvrir quoi que ce soit. */
  texte: string;
  /** Lien principal (fiche du CRM). */
  lien?: string;
  libelleLien?: string;
  /** Numéro à appeler : devient un bouton d'appel sur Telegram et ntfy. */
  telephone?: string;
  /** Plus c'est haut, plus la notification insiste (ntfy : 3 = défaut, 4 = haute, 5 = urgente). */
  urgence?: 1 | 2 | 3 | 4 | 5;
  /** Version HTML du mail ; à défaut, le texte est repris. */
  html?: string;
  /** Push web : l'icône à faire sonner de préférence (« messages » pour un SMS reçu). */
  application?: "crm" | "messages";
  /** Push web : deux notifications de même étiquette se remplacent au lieu de s'empiler. */
  etiquette?: string;
};


const DELAI_MS = 10_000;





/** Compte rendu lisible d'un envoi, pour un journal ou une réponse HTTP. */
export function resumerEnvoi(resultats: ResultatCanal[]): string {
  return resultats.map((r) => `${r.canal} : ${r.ok ? "envoyée" : (r.detail ?? "échec")}`).join(" · ");
}

function nonConfigure(canal: Canal): ResultatCanal {
  return {
    canal,
    ok: false,
    configure: false,
    detail: `non configuré — ${variablesManquantes(canal).join(" et ")} absente${variablesManquantes(canal).length > 1 ? "s" : ""}`,
  };
}

/** En-tête ntfy : ASCII seulement. Les accents sont transposés, la ponctuation large remplacée. */
export function titreAscii(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^ -~]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function echappeHtml(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Numéro au format international, tel que les téléphones savent le composer. */
export function telephoneInternational(numero: string): string | null {
  return normaliserTelephone(numero);
}

async function envoyerTelegram(alerte: Alerte): Promise<ResultatCanal> {
  const jeton = process.env.TELEGRAM_BOT_TOKEN;
  const discussion = process.env.TELEGRAM_CHAT_ID;
  if (!jeton || !discussion) return nonConfigure("telegram");
  const tel = alerte.telephone ? telephoneInternational(alerte.telephone) : null;
  const corps = [`<b>${echappeHtml(alerte.titre)}</b>`, echappeHtml(alerte.texte)].join("\n\n");
  const boutons: { text: string; url: string }[][] = [];
  if (tel) boutons.push([{ text: `📞 Appeler ${alerte.telephone}`, url: `tel:${tel}` }]);
  if (alerte.lien) boutons.push([{ text: alerte.libelleLien ?? "Ouvrir la fiche", url: alerte.lien }]);
  try {
    const rep = await envoyerAvecRepli(`https://api.telegram.org/bot${jeton}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: discussion,
        text: corps,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(boutons.length ? { reply_markup: { inline_keyboard: boutons } } : {}),
      }),
      delaiMs: DELAI_MS,
    });
    if (rep.status < 200 || rep.status >= 300) return { canal: "telegram", ok: false, configure: true, detail: `HTTP ${rep.status} ${rep.texte.slice(0, 200)}` };
    return { canal: "telegram", ok: true, configure: true, ...(rep.chemin === "ipv4" ? { detail: "envoyée par le chemin de repli (IPv4 forcé)" } : {}) };
  } catch (erreur) {
    // Le jeton figure dans l'adresse : ne jamais laisser une erreur le recopier.
    return { canal: "telegram", ok: false, configure: true, detail: decrireErreur(erreur).replaceAll(jeton, "<jeton>").slice(0, 400) };
  }
}

/**
 * Chemin qui a marché en dernier vers ntfy. Quand le direct est sans réponse
 * (adresse de Railway filtrée par ntfy.sh), chaque lead ne doit pas repayer
 * plusieurs secondes d'attente avant de passer par la passerelle : on s'en
 * souvient une heure, puis on retente le direct.
 */
const memoireNtfy = globalThis as unknown as { __ntfyDirectEnPanneJusqua?: number };
const OUBLI_PANNE_MS = 60 * 60_000;

async function envoyerNtfy(alerte: Alerte): Promise<ResultatCanal> {
  const sujet = process.env.NTFY_TOPIC;
  if (!sujet) return nonConfigure("ntfy");
  const serveur = (process.env.NTFY_SERVEUR || "https://ntfy.sh").replace(/\/$/, "");
  const tel = alerte.telephone ? telephoneInternational(alerte.telephone) : null;
  // Le libellé voyage dans un en-tête : ASCII seulement (un « é » vaut un refus
  // HTTP 400 de ntfy), sans virgule ni point-virgule, qui séparent les actions.
  const libelle = titreAscii(alerte.libelleLien ?? "Ouvrir la fiche").replace(/[,;]/g, " ").replace(/\s{2,}/g, " ").trim();
  const actions = [tel ? `view, Appeler, tel:${tel}` : null, alerte.lien ? `view, ${libelle}, ${alerte.lien}` : null].filter(Boolean) as string[];
  const titre = titreAscii(alerte.titre);
  const priorite = String(alerte.urgence ?? 4);
  const masquer = (texte: string) => texte.replaceAll(sujet, "<sujet>").slice(0, 400);

  const relais = relaisNtfyDisponible();
  const direct = async (): Promise<ResultatCanal> => {
    const rep = await envoyerAvecRepli(`${serveur}/${encodeURIComponent(sujet)}`, {
      method: "POST",
      headers: {
        // En-têtes ntfy : ASCII seulement, les accents passent par le corps du message.
        Title: titre,
        Priority: priorite,
        Tags: "bell",
        ...(actions.length ? { Actions: actions.join("; ") } : {}),
        ...(process.env.NTFY_TOKEN ? { Authorization: `Bearer ${process.env.NTFY_TOKEN}` } : {}),
      },
      body: alerte.texte,
      // Court quand une passerelle attend derrière : un lead ne patiente pas dix secondes.
      delaiMs: relais ? 4000 : DELAI_MS,
    });
    if (rep.status < 200 || rep.status >= 300) return { canal: "ntfy", ok: false, configure: true, detail: `HTTP ${rep.status} ${rep.texte.slice(0, 200)}` };
    memoireNtfy.__ntfyDirectEnPanneJusqua = 0;
    return { canal: "ntfy", ok: true, configure: true, ...(rep.chemin === "ipv4" ? { detail: "envoyée par le chemin de repli (IPv4 forcé)" } : {}) };
  };
  const parRelais = async (): Promise<ResultatCanal> => {
    await envoyerParRelais({ sujet, titre, priorite, tags: "bell", actions: actions.join("; "), texte: alerte.texte, ...(process.env.NTFY_TOKEN ? { jeton: process.env.NTFY_TOKEN } : {}) });
    return { canal: "ntfy", ok: true, configure: true, detail: "envoyée par la passerelle du site (ntfy.sh ne répond pas en direct depuis ce serveur)" };
  };

  // Ordre des chemins : le direct d'abord, sauf s'il vient d'échouer (mémoire d'une heure).
  const directEnPanne = relais && (memoireNtfy.__ntfyDirectEnPanneJusqua ?? 0) > Date.now();
  const chemins: ["direct" | "relais", () => Promise<ResultatCanal>][] = relais
    ? directEnPanne
      ? [["relais", parRelais], ["direct", direct]]
      : [["direct", direct], ["relais", parRelais]]
    : [["direct", direct]];
  const echecs: string[] = [];
  for (const [nom, envoyer] of chemins) {
    try {
      return await envoyer();
    } catch (erreur) {
      echecs.push(`${nom} : ${masquer(decrireErreur(erreur))}`);
      if (nom === "direct" && relais) memoireNtfy.__ntfyDirectEnPanneJusqua = Date.now() + OUBLI_PANNE_MS;
    }
  }
  return { canal: "ntfy", ok: false, configure: true, detail: echecs.join(" ; ").slice(0, 500) };
}

async function envoyerMail(alerte: Alerte): Promise<ResultatCanal> {
  const cle = process.env.RESEND_API_KEY;
  if (!cle) return nonConfigure("mail");
  const tel = alerte.telephone ? telephoneInternational(alerte.telephone) : null;
  const html =
    alerte.html ??
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
      <h2 style="margin:0 0 12px">${echappeHtml(alerte.titre)}</h2>
      <p style="white-space:pre-line;margin:0 0 16px">${echappeHtml(alerte.texte)}</p>
      ${tel ? `<p style="margin:0 0 8px"><a href="tel:${tel}" style="display:inline-block;padding:10px 18px;background:#16a34a;color:#fff;border-radius:6px;text-decoration:none">📞 Appeler ${echappeHtml(alerte.telephone ?? "")}</a></p>` : ""}
      ${alerte.lien ? `<p style="margin:0"><a href="${alerte.lien}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">${echappeHtml(alerte.libelleLien ?? "Ouvrir la fiche")}</a></p>` : ""}
    </div>`;
  try {
    await new Resend(cle).emails.send({
      from: process.env.EMAIL_FROM || "CoverSwap <onboarding@resend.dev>",
      to: process.env.LEAD_NOTIFICATION_EMAIL || "contact@coverswap.fr",
      subject: alerte.titre,
      html,
      text: alerte.texte,
    });
    return { canal: "mail", ok: true, configure: true };
  } catch (erreur) {
    return { canal: "mail", ok: false, configure: true, detail: String(erreur).slice(0, 200) };
  }
}

async function envoyerParPushWeb(alerte: Alerte): Promise<ResultatCanal> {
  try {
    const { envoyerPushWeb } = await import("./pushweb");
    return await envoyerPushWeb({ titre: alerte.titre, texte: alerte.texte, lien: alerte.lien, etiquette: alerte.etiquette }, { application: alerte.application });
  } catch (erreur) {
    return { canal: "pushweb", ok: false, configure: false, detail: `push web indisponible : ${decrireErreur(erreur).slice(0, 200)}` };
  }
}

const ENVOIS: Record<Canal, (alerte: Alerte) => Promise<ResultatCanal>> = {
  telegram: envoyerTelegram,
  ntfy: envoyerNtfy,
  pushweb: envoyerParPushWeb,
  mail: envoyerMail,
};

/**
 * Envoie l'alerte sur tous les canaux, en parallèle. Ne lève jamais, et rend
 * une ligne par canal — celui qui n'est pas configuré le dit, il ne disparaît
 * pas du compte rendu. L'appelant garde ces lignes (elles sont écrites sur le
 * lead et montrées dans l'écran Publicité).
 *
 * `origine` range l'envoi dans le registre des alertes (AlerteEnvoi) : c'est ce
 * qui rend une panne de canal visible à l'écran. Sans origine, rien n'est écrit.
 */
export async function alerter(alerte: Alerte, options: { canaux?: readonly Canal[]; origine?: string } = {}): Promise<ResultatCanal[]> {
  const canaux = options.canaux ?? CANAUX;
  const resultats = await Promise.all(canaux.map((canal) => ENVOIS[canal](alerte)));
  for (const r of resultats) {
    if (!r.ok && r.configure) console.error(`[alertes] ${r.canal} en échec : ${r.detail}`);
    else if (!r.configure) console.warn(`[alertes] ${r.canal} ${r.detail} : ce canal n'a rien envoyé.`);
  }
  if (!resultats.some((r) => r.ok)) console.error("[alertes] AUCUN canal n'a abouti : notification perdue.");
  else if (!resultats.some((r) => r.ok && CANAUX_PUSH.includes(r.canal))) {
    console.error("[alertes] aucune notification POUSSÉE : le téléphone n'a pas sonné, seul un mail est parti.");
  }
  if (options.origine) await consignerAlerte(options.origine, resultats);
  return resultats;
}
