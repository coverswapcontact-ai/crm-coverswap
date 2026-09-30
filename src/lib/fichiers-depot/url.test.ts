import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { adresseInterdite, lienDeTelechargementDrive, telechargerUrl, verifierAdresse, type AdresseResolue, type ReponseBrute, type Transport } from "./url";

/**
 * Mission 17 (partie C) — le téléchargement par URL : aucune adresse interne
 * joignable (SSRF), taille coupée en flux, liens Drive convertis, type lu dans
 * les octets. La résolution DNS et le transport sont remplacés : aucun réseau.
 */

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const appelsReseau: string[] = [];
let fetchAvant: typeof fetch;

before(() => {
  fetchAvant = globalThis.fetch;
  globalThis.fetch = (async (entree: string | URL | Request) => {
    appelsReseau.push(String(entree));
    throw new Error("réseau coupé pendant les essais");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = fetchAvant;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
});

/** Un faux DNS : nom → adresses. */
const dnsFactice = (table: Record<string, string[]>) => async (hote: string): Promise<AdresseResolue[]> => {
  const adresses = table[hote];
  if (!adresses) throw new Error("ENOTFOUND");
  return adresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

type Page = { statut?: number; entetes?: Record<string, string>; morceaux?: Buffer[] };
/** Un faux transport : URL → réponse ; trace chaque connexion (adresse épinglée) et chaque fermeture. */
function transportFactice(pages: Record<string, Page>) {
  const connexions: { url: string; adresse: string }[] = [];
  let fermetures = 0;
  let octetsLivres = 0;
  const transport: Transport = async ({ url, adresse }) => {
    connexions.push({ url: url.href, adresse: adresse.address });
    const page = pages[url.href];
    if (!page) throw new Error(`page inconnue : ${url.href}`);
    const morceaux = page.morceaux ?? [];
    let ferme = false;
    const corps = (async function* () {
      for (const m of morceaux) {
        if (ferme) return;
        octetsLivres += m.length;
        yield new Uint8Array(m);
      }
    })();
    const reponse: ReponseBrute = { statut: page.statut ?? 200, entetes: page.entetes ?? {}, corps, fermer: () => { ferme = true; fermetures++; } };
    return reponse;
  };
  return { transport, connexions, fermetures: () => fermetures, octetsLivres: () => octetsLivres };
}

const refus = (motif: RegExp, statut?: number) => (e: unknown) => e instanceof ErreurMetier && motif.test(e.message) && (statut === undefined || e.status === statut);

describe("adresses internes refusées (SSRF)", () => {
  test("IPv4 et IPv6 privées, locales, lien-local, métadonnées, réservées", () => {
    for (const ip of ["127.0.0.1", "127.8.9.1", "10.0.0.1", "10.255.1.2", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a00:1", "::127.0.0.1", "ff02::1", "2001:db8::1", "pas-une-ip"]) {
      assert.equal(adresseInterdite(ip), true, ip);
    }
    for (const ip of ["93.184.216.34", "142.250.74.14", "2a00:1450:4007:80e::200e", "172.32.0.1", "11.0.0.1"]) assert.equal(adresseInterdite(ip), false, ip);
  });

  test("schémas, noms réservés et adresses littérales refusés avant toute résolution", () => {
    for (const [url, motif] of [
      ["ftp://exemple.fr/devis.pdf", /http et https/],
      ["file:///etc/passwd", /http et https/],
      ["gopher://exemple.fr/", /http et https/],
      ["http://localhost/x.pdf", /réseau local/],
      ["http://truc.localhost/x.pdf", /réseau local/],
      ["http://metadata.google.internal/computeMetadata/v1/", /réseau local/],
      ["http://intranet/x.pdf", /réseau local/],
      ["http://127.0.0.1/x.pdf", /réseau interne/],
      ["http://10.1.2.3/x.pdf", /réseau interne/],
      ["http://169.254.169.254/latest/meta-data/", /réseau interne/],
      ["http://[::1]/x.pdf", /réseau interne/],
      ["http://[::ffff:127.0.0.1]/x.pdf", /réseau interne/],
      ["http://2130706433/x.pdf", /réseau interne/], // 127.0.0.1 en décimal, normalisé par l'analyseur d'URL
      ["http://0x7f.1/x.pdf", /réseau interne/],
      ["https://lucas:secret@exemple.fr/x.pdf", /identifiants/],
      ["https://exemple.fr:8443/x.pdf", /ports/],
      ["pas une url", /invalide/],
    ] as const) {
      assert.throws(() => verifierAdresse(url), refus(motif), url);
    }
    assert.equal(verifierAdresse("https://exemple.fr/devis.pdf").hostname, "exemple.fr");
  });

  test("un nom qui résout vers une adresse privée est refusé, sans connexion", async () => {
    const t = transportFactice({});
    await assert.rejects(telechargerUrl("https://piege.exemple.fr/devis.pdf", { resoudre: dnsFactice({ "piege.exemple.fr": ["10.0.0.5"] }), transport: t.transport }), refus(/réseau interne/, 403));
    await assert.rejects(telechargerUrl("https://mixte.exemple.fr/devis.pdf", { resoudre: dnsFactice({ "mixte.exemple.fr": ["93.184.216.34", "127.0.0.1"] }), transport: t.transport }), refus(/réseau interne/, 403), "une seule adresse interne suffit");
    await assert.rejects(telechargerUrl("https://v6.exemple.fr/devis.pdf", { resoudre: dnsFactice({ "v6.exemple.fr": ["::1"] }), transport: t.transport }), refus(/réseau interne/, 403));
    await assert.rejects(telechargerUrl("https://inconnu.exemple.fr/devis.pdf", { resoudre: dnsFactice({}), transport: t.transport }), refus(/introuvable/));
    assert.equal(t.connexions.length, 0, "aucune connexion ouverte");
  });

  test("une redirection vers une adresse interne est refusée (revérifiée à chaque saut)", async () => {
    const t = transportFactice({
      "https://public.exemple.fr/a.pdf": { statut: 302, entetes: { location: "http://169.254.169.254/latest/meta-data/" } },
      "https://public.exemple.fr/b.pdf": { statut: 301, entetes: { location: "https://interne.exemple.fr/b.pdf" } },
      "https://public.exemple.fr/c.pdf": { statut: 307, entetes: { location: "http://localhost:3001/api/mcp" } },
    });
    const resoudre = dnsFactice({ "public.exemple.fr": ["93.184.216.34"], "interne.exemple.fr": ["192.168.0.12"] });
    await assert.rejects(telechargerUrl("https://public.exemple.fr/a.pdf", { resoudre, transport: t.transport }), refus(/réseau interne/, 403));
    await assert.rejects(telechargerUrl("https://public.exemple.fr/b.pdf", { resoudre, transport: t.transport }), refus(/réseau interne/, 403));
    await assert.rejects(telechargerUrl("https://public.exemple.fr/c.pdf", { resoudre, transport: t.transport }), refus(/ports|réseau local/));
    assert.ok(t.connexions.every((c) => c.adresse === "93.184.216.34"), "seule l'adresse publique vérifiée a été jointe (connexion épinglée)");
  });

  test("une chaîne de redirections trop longue est coupée", async () => {
    const pages: Record<string, Page> = {};
    for (let i = 0; i < 8; i++) pages[`https://public.exemple.fr/${i}`] = { statut: 302, entetes: { location: `/${i + 1}` } };
    const t = transportFactice(pages);
    await assert.rejects(telechargerUrl("https://public.exemple.fr/0", { resoudre: dnsFactice({ "public.exemple.fr": ["93.184.216.34"] }), transport: t.transport }), refus(/Trop de redirections/));
  });
});

describe("taille et type", () => {
  const resoudre = dnsFactice({ "public.exemple.fr": ["93.184.216.34"] });

  test("taille maximale respectée en flux : le téléchargement est coupé dès le dépassement", async () => {
    const morceau = Buffer.alloc(64 * 1024, 0x41);
    morceau.write("%PDF-1.4\n", 0);
    const t = transportFactice({ "https://public.exemple.fr/gros.pdf": { morceaux: Array.from({ length: 100 }, () => morceau) } }); // 6,4 Mo, sans Content-Length
    await assert.rejects(telechargerUrl("https://public.exemple.fr/gros.pdf", { resoudre, transport: t.transport, octetsMax: 256 * 1024 }), refus(/trop lourd.*coupé/i, 413));
    assert.equal(t.fermetures(), 1, "flux fermé");
    assert.ok(t.octetsLivres() <= 256 * 1024 + morceau.length, `lecture arrêtée au plafond (${t.octetsLivres()} octets lus)`);
  });

  test("Content-Length annoncé au-delà du plafond : refusé sans rien lire", async () => {
    const t = transportFactice({ "https://public.exemple.fr/annonce.pdf": { entetes: { "content-length": String(50 * 1024 * 1024) }, morceaux: [PDF] } });
    await assert.rejects(telechargerUrl("https://public.exemple.fr/annonce.pdf", { resoudre, transport: t.transport }), refus(/trop lourd/i, 413));
    assert.equal(t.octetsLivres(), 0);
  });

  test("le type est lu dans les octets : une page HTML ou un exécutable nommé .pdf est refusé", async () => {
    const t = transportFactice({
      "https://public.exemple.fr/faux.pdf": { entetes: { "content-type": "application/pdf" }, morceaux: [Buffer.from("MZ\x90\x00 exécutable")] },
      "https://public.exemple.fr/page.pdf": { entetes: { "content-type": "text/html" }, morceaux: [Buffer.from("<!DOCTYPE html><html>…</html>")] },
      "https://public.exemple.fr/vrai": { entetes: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="devis cuisine.pdf"' }, morceaux: [PDF] },
    });
    await assert.rejects(telechargerUrl("https://public.exemple.fr/faux.pdf", { resoudre, transport: t.transport }), refus(/Format refusé/, 415));
    await assert.rejects(telechargerUrl("https://public.exemple.fr/page.pdf", { resoudre, transport: t.transport }), refus(/page web/, 415));
    const ok = await telechargerUrl("https://public.exemple.fr/vrai", { resoudre, transport: t.transport });
    assert.equal(ok.typeMime, "application/pdf");
    assert.equal(ok.nom, "devis cuisine.pdf");
    assert.equal(ok.contenu.length, PDF.length);
  });

  test("statut d'erreur du site : message lisible", async () => {
    const t = transportFactice({ "https://public.exemple.fr/prive": { statut: 403 } });
    await assert.rejects(telechargerUrl("https://public.exemple.fr/prive", { resoudre, transport: t.transport }), refus(/pas public/));
  });
});

describe("Google Drive", () => {
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  test("liens de partage convertis en téléchargement direct", () => {
    const direct = `https://drive.usercontent.google.com/download?id=${ID}&export=download&confirm=t`;
    assert.equal(lienDeTelechargementDrive(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), direct);
    assert.equal(lienDeTelechargementDrive(`https://drive.google.com/file/d/${ID}/view?usp=drive_link`), direct);
    assert.equal(lienDeTelechargementDrive(`https://drive.google.com/open?id=${ID}`), direct);
    assert.equal(lienDeTelechargementDrive(`https://drive.google.com/uc?id=${ID}&export=download`), direct);
    assert.equal(lienDeTelechargementDrive(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`), `https://docs.google.com/document/d/${ID}/export?format=pdf`);
    assert.equal(lienDeTelechargementDrive("https://exemple.fr/devis.pdf"), "https://exemple.fr/devis.pdf");
    assert.throws(() => lienDeTelechargementDrive(`https://drive.google.com/drive/folders/${ID}`), refus(/dossier Google Drive/));
  });

  test("un lien Drive se télécharge par son lien direct, redirection comprise", async () => {
    const direct = `https://drive.usercontent.google.com/download?id=${ID}&export=download&confirm=t`;
    const t = transportFactice({
      [direct]: { statut: 303, entetes: { location: "https://doc-0s.googleusercontent.com/fichier" } },
      "https://doc-0s.googleusercontent.com/fichier": { entetes: { "content-disposition": "attachment; filename*=UTF-8''photo%20cuisine.jpg" }, morceaux: [JPEG] },
    });
    const f = await telechargerUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`, { resoudre: dnsFactice({ "drive.usercontent.google.com": ["142.250.74.14"], "doc-0s.googleusercontent.com": ["142.250.74.15"] }), transport: t.transport });
    assert.equal(f.typeMime, "image/jpeg");
    assert.equal(f.nom, "photo cuisine.jpg");
    assert.deepEqual(t.connexions.map((c) => c.url), [direct, "https://doc-0s.googleusercontent.com/fichier"]);
  });
});
