// ============================================================================
// META ADS — Lead Ads webhook + Conversions API (CAPI)
// ============================================================================
// 1. Réception directe des leads depuis Meta Lead Ads (sans Zapier/n8n)
// 2. Remontée des conversions (Lead, Purchase) pour optimiser les campagnes
// ============================================================================

const GRAPH_API = "https://graph.facebook.com/v21.0";

// ── Fetch lead data from Meta Graph API ──────────────────────────────
export async function fetchMetaLead(leadgenId: string): Promise<{
  prenom: string;
  nom: string;
  telephone: string;
  email?: string;
  ville?: string;
  formName?: string;
  createdTime?: Date; // Date réelle de soumission du lead sur Meta
} | null> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error("[meta] META_ACCESS_TOKEN non configuré");
    return null;
  }

  try {
    // Demande explicite des champs (inclut created_time)
    const res = await fetch(
      `${GRAPH_API}/${leadgenId}?fields=field_data,form_name,created_time&access_token=${token}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      console.error("[meta] Graph API error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const fields: Record<string, string> = {};
    for (const f of data.field_data || []) {
      fields[f.name] = f.values?.[0] || "";
    }

    // full_name en priorité (format courant Meta), sinon first/last
    let prenom = "Inconnu";
    let nom = "Inconnu";
    if (fields.full_name) {
      const parts = fields.full_name.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        prenom = parts[0];
        nom = parts[0];
      } else if (parts.length >= 2) {
        prenom = parts[0];
        nom = parts.slice(1).join(" ");
      }
    } else {
      prenom = fields.first_name || fields.prénom || "Inconnu";
      nom = fields.last_name || fields.nom || "Inconnu";
    }

    // Ville : cherche clé qui contient "situ/ville/city"
    const villeKey = Object.keys(fields).find((k) =>
      /situ|ville|city|o[ûu]_[eê]tes/i.test(k)
    );

    // Meta renvoie created_time au format ISO 8601 "2024-01-15T14:30:00+0000"
    let createdTime: Date | undefined;
    if (data.created_time) {
      const d = new Date(data.created_time);
      if (!isNaN(d.getTime())) createdTime = d;
    }

    return {
      prenom,
      nom,
      telephone: fields.phone_number || fields.téléphone || "",
      email: fields.email || undefined,
      ville: (villeKey && fields[villeKey]) || undefined,
      formName: data.form_name || undefined,
      createdTime,
    };
  } catch (err) {
    console.error("[meta] Erreur fetch lead:", err);
    return null;
  }
}

// ── Meta Conversions API (CAPI) ──────────────────────────────────────
// Doc: https://developers.facebook.com/docs/marketing-api/conversions-api
export type ConversionEvent =
  | "Lead"           // Nouveau lead reçu
  | "Contact"        // Lead contacté
  | "SubmitApplication" // Devis envoyé
  | "Purchase"       // Devis signé (conversion finale)
  | "Other";         // Catch-all

interface SendEventOptions {
  eventName: ConversionEvent;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  value?: number;     // montant en € (pour Purchase)
  currency?: string;  // EUR par défaut
  eventId?: string;   // pour dédupliquer (ex: devisId)
  sourceUrl?: string; // URL du CRM
}

export async function sendConversionEvent(opts: SendEventOptions): Promise<boolean> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !token) {
    // Silencieux si pas configuré — pas bloquant
    return false;
  }

  try {
    // Hasher les données utilisateur (SHA256 requis par Meta)
    const crypto = await import("crypto");
    const hash = (s: string) =>
      s ? crypto.createHash("sha256").update(s.trim().toLowerCase()).digest("hex") : undefined;

    const userData: Record<string, string | undefined> = {};
    if (opts.email) userData.em = hash(opts.email);
    if (opts.phone) userData.ph = hash(opts.phone.replace(/\D/g, ""));
    if (opts.firstName) userData.fn = hash(opts.firstName);
    if (opts.lastName) userData.ln = hash(opts.lastName);
    if (opts.city) userData.ct = hash(opts.city);
    userData.country = hash("fr");

    const event: Record<string, unknown> = {
      event_name: opts.eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "system_generated",
      user_data: userData,
    };

    if (opts.eventId) event.event_id = opts.eventId;
    if (opts.sourceUrl) event.event_source_url = opts.sourceUrl;

    if (opts.value) {
      event.custom_data = {
        value: opts.value,
        currency: opts.currency || "EUR",
      };
    }

    const res = await fetch(`${GRAPH_API}/${pixelId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [event],
        access_token: token,
      }),
    });

    if (!res.ok) {
      console.error("[meta-capi] Erreur:", res.status, await res.text());
      return false;
    }

    const result = await res.json();
    console.log(`[meta-capi] ${opts.eventName} envoyé — events_received: ${result.events_received}`);
    return true;
  } catch (err) {
    console.error("[meta-capi] Erreur envoi event:", err);
    return false;
  }
}

// ── Helpers pour les transitions CRM ─────────────────────────────────
export function devisStatutToConversion(
  statut: string
): { eventName: ConversionEvent; label: string } | null {
  switch (statut) {
    case "ENVOYE":
      return { eventName: "SubmitApplication", label: "Devis envoyé" };
    case "SIGNE":
      return { eventName: "Purchase", label: "Devis signé" };
    default:
      return null;
  }
}
