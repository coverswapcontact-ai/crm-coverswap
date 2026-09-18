import { describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cadrerPourGeneration, recadrerRendu, tailleSelonRatio, zoneDansToile } from "./cadrage";

describe("cadrage de la photo pour le modèle d'image", () => {
  test("le format de sortie suit l'orientation de la photo", () => {
    assert.equal(tailleSelonRatio(1600, 900), "1536x1024");
    assert.equal(tailleSelonRatio(1200, 1600), "1024x1536");
    assert.equal(tailleSelonRatio(1000, 1000), "1024x1024");
  });

  test("une photo 16:9 est posée entière, prolongée en miroir, puis le rendu est recoupé sur elle", async () => {
    assert.deepEqual(zoneDansToile(1600, 900, "1536x1024"), { left: 0, top: 80, width: 1536, height: 864 });
    const photo = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer();
    const cadrage = await cadrerPourGeneration(photo, "1024x1024", "miroir");
    assert.equal(cadrage.taille, "1536x1024");
    const toile = await sharp(cadrage.photo).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([toile.info.width, toile.info.height], [1536, 1024]);
    const pixel = (x: number, y: number) => [...toile.data.subarray((y * 1536 + x) * toile.info.channels, (y * 1536 + x) * toile.info.channels + 3)];
    assert.ok(pixel(700, 10)[0] > 180 && pixel(700, 10)[1] < 60); // marge du haut : la photo en miroir, pas une bande unie
    assert.ok(pixel(700, 500)[0] > 180 && pixel(700, 500)[1] < 60); // la photo, au centre

    const rendu = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 10, g: 200, b: 10 } } }).png().toBuffer();
    const recoupe = await sharp(await recadrerRendu(rendu, cadrage)).metadata();
    assert.deepEqual([recoupe.width, recoupe.height], [1536, 860]);
  });

  test("par défaut la photo est rognée au format du modèle, et la même image sert d'« avant »", async () => {
    const photo = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 30, g: 30, b: 200 } } }).jpeg().toBuffer();
    const cadrage = await cadrerPourGeneration(photo, "1024x1024", "rogner");
    const envoyee = await sharp(cadrage.photo).metadata();
    assert.deepEqual([envoyee.width, envoyee.height, cadrage.taille, cadrage.zone], [1536, 1024, "1536x1024", null]);
    const avant = await sharp(cadrage.avant!).metadata();
    assert.deepEqual([avant.width, avant.height], [1536, 1024]);
    const rendu = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    assert.equal(await recadrerRendu(rendu, cadrage), rendu);
    const auFormat = await cadrerPourGeneration(await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer(), "1024x1024", "rogner");
    assert.equal(auFormat.avant, null);
  });

  test("une photo déjà au format 3:2 n'est ni bordée ni recoupée", async () => {
    const photo = await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    const cadrage = await cadrerPourGeneration(photo, "1024x1024", "miroir");
    assert.deepEqual(cadrage.zone, { left: 0, top: 0, width: 1536, height: 1024 });
    const rendu = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    assert.equal(await recadrerRendu(rendu, cadrage), rendu);
  });
});
