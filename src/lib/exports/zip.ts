import zlib from "node:zlib";

/**
 * Mission 23 (L1) — un écrivain de zip « stored » (sans compression), sans dépendance : les fichiers exportés sont des
 * JPEG et des PNG déjà compressés. Format : en-tête local + données par fichier, puis répertoire central et fin de
 * répertoire. Pas de zip64 : au-delà de 4 Go ou de 65 535 fichiers, l'écriture est refusée.
 *
 * En flux : chaque fichier n'est lu qu'au moment de l'écrire (`contenu` peut être une fonction), et le flux ne tient
 * qu'un fichier en mémoire à la fois — 150 × 2 photos ne passent jamais ensemble dans la mémoire du serveur.
 */

export type EntreeZip = {
  /** Chemin dans l'archive, barres obliques (« abc/avant.jpg »). */
  nom: string;
  contenu: Uint8Array | (() => Promise<Uint8Array>);
  date?: Date;
};

const LIMITE_32 = 0xffffffff;
const LIMITE_ENTREES = 0xffff;
/** Bit 11 : noms en UTF-8. */
const DRAPEAU_UTF8 = 0x0800;
const VERSION = 20;

let table: Uint32Array | null = null;

/** CRC-32 (polynôme 0xEDB88320) par table, pour un Node sans `zlib.crc32` (ajouté en 20.15 / 22.2). */
export function crc32Table(octets: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < octets.length; i++) crc = table[(crc ^ octets[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC-32 d'un fichier : celui de Node quand il existe, sinon la table. */
export function crc32(octets: Uint8Array): number {
  const natif = (zlib as unknown as { crc32?: (donnees: Uint8Array) => number }).crc32;
  return typeof natif === "function" ? natif(octets) >>> 0 : crc32Table(octets);
}

/** Date et heure au format MS-DOS (heure locale du serveur, à 2 s près). */
function dateDos(date: Date): { heure: number; jour: number } {
  const annee = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    heure: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    jour: ((annee - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

type Enregistre = { nom: Buffer; crc: number; taille: number; decalage: number; heure: number; jour: number };

function enTeteLocal(e: Enregistre): Buffer {
  const b = Buffer.alloc(30);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(VERSION, 4);
  b.writeUInt16LE(DRAPEAU_UTF8, 6);
  b.writeUInt16LE(0, 8); // stored
  b.writeUInt16LE(e.heure, 10);
  b.writeUInt16LE(e.jour, 12);
  b.writeUInt32LE(e.crc, 14);
  b.writeUInt32LE(e.taille, 18);
  b.writeUInt32LE(e.taille, 22);
  b.writeUInt16LE(e.nom.length, 26);
  b.writeUInt16LE(0, 28);
  return Buffer.concat([b, e.nom]);
}

function enTeteCentral(e: Enregistre): Buffer {
  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(VERSION, 4);
  b.writeUInt16LE(VERSION, 6);
  b.writeUInt16LE(DRAPEAU_UTF8, 8);
  b.writeUInt16LE(0, 10);
  b.writeUInt16LE(e.heure, 12);
  b.writeUInt16LE(e.jour, 14);
  b.writeUInt32LE(e.crc, 16);
  b.writeUInt32LE(e.taille, 20);
  b.writeUInt32LE(e.taille, 24);
  b.writeUInt16LE(e.nom.length, 28);
  // extra, commentaire, disque, attributs internes et externes : 0
  b.writeUInt32LE(e.decalage, 42);
  return Buffer.concat([b, e.nom]);
}

function finDeRepertoire(nombre: number, taille: number, decalage: number): Buffer {
  const b = Buffer.alloc(22);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(nombre, 8);
  b.writeUInt16LE(nombre, 10);
  b.writeUInt32LE(taille, 12);
  b.writeUInt32LE(decalage, 16);
  return b;
}

/** Les morceaux du zip, un fichier à la fois. */
export async function* morceauxZip(entrees: Iterable<EntreeZip> | AsyncIterable<EntreeZip>): AsyncGenerator<Uint8Array> {
  const enregistres: Enregistre[] = [];
  let decalage = 0;
  for await (const entree of entrees) {
    if (enregistres.length >= LIMITE_ENTREES) throw new Error("Zip refusé : plus de 65 535 fichiers (pas de zip64).");
    const nom = Buffer.from(entree.nom.replace(/\\/g, "/").replace(/^\/+/, ""), "utf8");
    if (nom.length === 0 || nom.length > 0xffff) throw new Error(`Zip : nom de fichier invalide « ${entree.nom} ».`);
    const contenu = typeof entree.contenu === "function" ? await entree.contenu() : entree.contenu;
    const e: Enregistre = { nom, crc: crc32(contenu), taille: contenu.length, decalage, ...dateDos(entree.date ?? new Date()) };
    const entete = enTeteLocal(e);
    if (decalage + entete.length + contenu.length > LIMITE_32) throw new Error("Zip refusé : plus de 4 Go (pas de zip64).");
    enregistres.push(e);
    decalage += entete.length + contenu.length;
    yield entete;
    yield contenu;
  }
  const central = Buffer.concat(enregistres.map(enTeteCentral));
  if (decalage + central.length + 22 > LIMITE_32) throw new Error("Zip refusé : plus de 4 Go (pas de zip64).");
  yield central;
  yield finDeRepertoire(enregistres.length, central.length, decalage);
}

/** Le zip en flux, pour une réponse HTTP : un morceau par lecture, rien d'avance. */
export function zipEnFlux(entrees: Iterable<EntreeZip> | AsyncIterable<EntreeZip>): ReadableStream<Uint8Array> {
  const morceaux = morceauxZip(entrees);
  return new ReadableStream<Uint8Array>({
    async pull(controleur) {
      try {
        const { value, done } = await morceaux.next();
        if (done) controleur.close();
        else controleur.enqueue(value);
      } catch (erreur) {
        controleur.error(erreur);
      }
    },
    async cancel() {
      await morceaux.return(undefined);
    },
  });
}

/** Le zip entier en mémoire (petits zips, essais). */
export async function zipEnMemoire(entrees: Iterable<EntreeZip> | AsyncIterable<EntreeZip>): Promise<Buffer> {
  const morceaux: Uint8Array[] = [];
  for await (const m of morceauxZip(entrees)) morceaux.push(m);
  return Buffer.concat(morceaux);
}
