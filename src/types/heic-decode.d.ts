/** Déclaration minimale de `heic-decode` (le paquet n'embarque pas de types) : ce que `lib/site/conversion-photo.ts` utilise. */
declare module "heic-decode" {
  type ImageHeic = { width: number; height: number; data: Uint8ClampedArray };
  function decode(entree: { buffer: Buffer | Uint8Array }): Promise<ImageHeic>;
  export default decode;
}
