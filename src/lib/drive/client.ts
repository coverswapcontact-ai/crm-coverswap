import { randomBytes } from "node:crypto";
import { PORTEES_GOOGLE, appelGoogle } from "@/lib/google/connexion";

/**
 * Appels à l'API Google Drive v3, au plus juste : créer un dossier, envoyer ou
 * remplacer un fichier, renommer, déplacer, lire un élément. Aucune fonction
 * de suppression ni de corbeille : un élément retiré du CRM est déplacé dans le
 * dossier d'archives du miroir.
 */

const API = "https://www.googleapis.com/drive/v3/files";
const ENVOI = "https://www.googleapis.com/upload/drive/v3/files";
const TYPE_DOSSIER = "application/vnd.google-apps.folder";

export type ElementDrive = { id: string; name: string; parents: string[]; trashed: boolean };

async function reponseJson(reponse: Response, action: string): Promise<Record<string, unknown>> {
  const corps = (await reponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!reponse.ok) {
    const message = (corps.error as { message?: string } | undefined)?.message ?? `HTTP ${reponse.status}`;
    throw new Error(`Drive : ${action} impossible (${message})`);
  }
  return corps;
}

export async function creerDossierDrive(nom: string, parentId: string | null): Promise<string> {
  const reponse = await appelGoogle(`${API}?fields=id`, {
    portee: PORTEES_GOOGLE.DRIVE,
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: nom, mimeType: TYPE_DOSSIER, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return String((await reponseJson(reponse, `création du dossier « ${nom} »`)).id);
}

/** Envoie un fichier (nouveau, ou nouvelle version d'un fichier existant). */
export async function envoyerFichierDrive(entree: { nom: string; type: string; contenu: Buffer; parentId: string | null; fichierId?: string | null }): Promise<string> {
  const separateur = `coverswap-${randomBytes(12).toString("hex")}`;
  const metadonnees = entree.fichierId ? { name: entree.nom } : { name: entree.nom, ...(entree.parentId ? { parents: [entree.parentId] } : {}) };
  const corps = Buffer.concat([
    Buffer.from(`--${separateur}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadonnees)}\r\n--${separateur}\r\nContent-Type: ${entree.type}\r\n\r\n`, "utf8"),
    entree.contenu,
    Buffer.from(`\r\n--${separateur}--`, "utf8"),
  ]);
  const url = entree.fichierId ? `${ENVOI}/${entree.fichierId}?uploadType=multipart&fields=id` : `${ENVOI}?uploadType=multipart&fields=id`;
  const reponse = await appelGoogle(url, {
    portee: PORTEES_GOOGLE.DRIVE,
    method: entree.fichierId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${separateur}` },
    body: new Uint8Array(corps),
  });
  return String((await reponseJson(reponse, `envoi de « ${entree.nom} »`)).id);
}

export async function renommerDrive(id: string, nom: string): Promise<void> {
  const reponse = await appelGoogle(`${API}/${id}?fields=id`, {
    portee: PORTEES_GOOGLE.DRIVE,
    method: "PATCH",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: nom }),
  });
  await reponseJson(reponse, `renommage en « ${nom} »`);
}

export async function deplacerDrive(id: string, versParentId: string, depuisParentIds: string[]): Promise<void> {
  const parametres = new URLSearchParams({ addParents: versParentId, fields: "id" });
  if (depuisParentIds.length) parametres.set("removeParents", depuisParentIds.join(","));
  const reponse = await appelGoogle(`${API}/${id}?${parametres}`, {
    portee: PORTEES_GOOGLE.DRIVE,
    method: "PATCH",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: "{}",
  });
  await reponseJson(reponse, "déplacement");
}

/** L'élément tel que Drive le voit ; null s'il n'existe plus (ou n'est plus accessible au CRM). */
export async function lireElementDrive(id: string): Promise<ElementDrive | null> {
  const reponse = await appelGoogle(`${API}/${id}?fields=id,name,parents,trashed`, { portee: PORTEES_GOOGLE.DRIVE, method: "GET" });
  if (reponse.status === 404) return null;
  const corps = await reponseJson(reponse, "lecture");
  return { id: String(corps.id), name: String(corps.name), parents: (corps.parents as string[] | undefined) ?? [], trashed: corps.trashed === true };
}
