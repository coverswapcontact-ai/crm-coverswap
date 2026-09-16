// ─────────────────────────────────────────────
// Client Google Places API (New) — module Prospection
// Docs : https://developers.google.com/maps/documentation/places/web-service/text-search
// FieldMask volontairement limité pour maîtriser le coût par requête.
// ─────────────────────────────────────────────
import type { AvisBrut } from "./constants";

const BASE_URL = "https://places.googleapis.com/v1";
const PAUSE_ENTRE_REQUETES_MS = 200;
const PAGE_SIZE_MAX = 20; // maximum autorisé par searchText
const PAGES_MAX = 3; // searchText plafonne à 60 résultats (3 pages)

// nextPageToken est indispensable dans le mask pour que la pagination fonctionne
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.businessStatus",
  "places.primaryType",
  "nextPageToken",
].join(",");

export type PlaceAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

export type PlaceResult = {
  id: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  addressComponents?: PlaceAddressComponent[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: unknown;
  businessStatus?: string; // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  primaryType?: string;
};

type SearchTextResponse = {
  places?: PlaceResult[];
  nextPageToken?: string;
};

type ReviewGoogle = {
  rating?: number;
  text?: { text?: string; languageCode?: string };
  originalText?: { text?: string; languageCode?: string };
  publishTime?: string;
  relativePublishTimeDescription?: string;
};

export type SearchPlacesOptions = {
  includedType?: string; // type Google Places (ex. "lodging", "restaurant")
  maxPages?: number; // 1 à 3, défaut 3 (60 résultats max)
  languageCode?: string; // défaut "fr"
  regionCode?: string; // défaut "FR"
};

function cleApi(): string {
  const cle = process.env.GOOGLE_PLACES_API_KEY;
  if (!cle) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY manquante — ajoute-la dans le fichier .env du CRM."
    );
  }
  return cle;
}

// Throttle global du module : au moins 200ms entre deux appels à l'API,
// recherches et détails confondus.
let derniereRequete = 0;
async function throttle(): Promise<void> {
  const attente = derniereRequete + PAUSE_ENTRE_REQUETES_MS - Date.now();
  if (attente > 0) await new Promise((r) => setTimeout(r, attente));
  derniereRequete = Date.now();
}

async function requeteGoogle<T>(
  url: string,
  fieldMask: string,
  init: RequestInit = {}
): Promise<T> {
  await throttle();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": cleApi(),
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const corps = (await res.json()) as { error?: { message?: string } };
      if (corps.error?.message) message = `${res.status} — ${corps.error.message}`;
    } catch {
      // corps non-JSON : on garde le statut HTTP
    }
    throw new Error(`Google Places : ${message}`);
  }
  return (await res.json()) as T;
}

/**
 * Recherche textuelle paginée (places:searchText).
 * Suit nextPageToken jusqu'à maxPages (les autres paramètres doivent rester
 * identiques entre les pages, exigence de l'API).
 */
export async function searchPlaces(
  query: string,
  options: SearchPlacesOptions = {}
): Promise<PlaceResult[]> {
  const {
    includedType,
    maxPages = PAGES_MAX,
    languageCode = "fr",
    regionCode = "FR",
  } = options;

  const places: PlaceResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < Math.min(maxPages, PAGES_MAX); page++) {
    const corps: Record<string, unknown> = {
      textQuery: query,
      pageSize: PAGE_SIZE_MAX,
      languageCode,
      regionCode,
    };
    if (includedType) corps.includedType = includedType;
    if (pageToken) corps.pageToken = pageToken;

    const data = await requeteGoogle<SearchTextResponse>(
      `${BASE_URL}/places:searchText`,
      SEARCH_FIELD_MASK,
      { method: "POST", body: JSON.stringify(corps) }
    );

    places.push(...(data.places ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return places;
}

/**
 * Avis d'un établissement (Place Details, FieldMask "reviews" uniquement).
 * L'API renvoie au plus 5 avis. Retourne une forme compacte prête à
 * persister dans Prospect.avisBruts (le scoring de l'étape 3 lira ce JSON).
 */
export async function fetchPlaceReviews(placeId: string): Promise<AvisBrut[]> {
  // languageCode=fr indispensable : sans lui Google renvoie les avis traduits
  // en anglais, et le lexique de vétusté (français) ne matche plus rien.
  const data = await requeteGoogle<{ reviews?: ReviewGoogle[] }>(
    `${BASE_URL}/places/${encodeURIComponent(placeId)}?languageCode=fr`,
    "reviews",
    { method: "GET" }
  );

  return (data.reviews ?? [])
    .map((avis) => ({
      note: avis.rating ?? 0,
      texte: avis.text?.text ?? avis.originalText?.text ?? "",
      datePublication: avis.publishTime,
      dateRelative: avis.relativePublishTimeDescription,
      langue: avis.text?.languageCode ?? avis.originalText?.languageCode,
    }))
    .filter((avis) => avis.texte.length > 0 || avis.note > 0);
}
