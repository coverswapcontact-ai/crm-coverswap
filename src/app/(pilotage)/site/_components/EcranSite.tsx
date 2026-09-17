"use client";

import { useEffect, useState } from "react";
import { Globe, ImageIcon, Star } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, EnTetePage, EtatVide, ListeDeroulante, Modale, Pastille, TitreSection, ZoneTexte, CaseACocher } from "@/components/pilotage/ui";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { LIBELLES_TYPE_PROJET } from "@/lib/prospects/constantes";
import type { PublicationVue } from "@/lib/site/publications";
import { cn } from "@/lib/utils";

type Dossier = { id: string; objet: string; clientNom: string; ville: string | null; typeProjet: string | null; clientId: string | null; nbApres: number };
type Photo = { chemin: string; apres: boolean; url: string };

const CARTE = "rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#16181D]";
const VIDE = { type: "REALISATION", titre: "", texte: "", ville: "", typeProjet: "", note: "5", auteur: "", dossierId: "", clientId: "", photoAvant: "", photoApres: "", accord: false, accordClientLe: "" };

function etat(p: PublicationVue): { ton: "vert" | "ambre" | "neutre"; libelle: string } {
  if (p.publieLe && !p.retireLe) return { ton: "vert", libelle: `En ligne depuis le ${formatDateCourte(p.publieLe)}` };
  if (p.retireLe) return { ton: "neutre", libelle: `Retirée le ${formatDateCourte(p.retireLe)}` };
  return { ton: "ambre", libelle: "Brouillon" };
}

/**
 * Ce que le site montre : réalisations (photos après chantier des dossiers)
 * et avis clients. Rien ne part en ligne sans l'accord écrit de la personne,
 * daté ici ; le site relit la liste toutes les cinq minutes.
 */
export default function EcranSite({ initiales, dossiers }: { initiales: PublicationVue[]; dossiers: Dossier[] }) {
  const [publications, setPublications] = useState(initiales);
  const [ouverte, setOuverte] = useState(false);
  const [enCours, setEnCours] = useState<PublicationVue | null>(null);
  const [saisie, setSaisie] = useState(VIDE);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [envoi, setEnvoi] = useState<string | null>(null);

  useEffect(() => {
    if (!saisie.dossierId) {
      setPhotos([]);
      return;
    }
    let annule = false;
    appelApi<{ photos?: Photo[] }>(`/api/publications/_?dossier=${encodeURIComponent(saisie.dossierId)}`)
      .then((d) => {
        if (!annule) setPhotos(d.photos ?? []);
      })
      .catch(() => setPhotos([]));
    return () => {
      annule = true;
    };
  }, [saisie.dossierId]);

  const ouvrir = (p?: PublicationVue) => {
    setEnCours(p ?? null);
    setSaisie(
      p
        ? {
            type: p.type,
            titre: p.titre,
            texte: p.texte ?? "",
            ville: p.ville ?? "",
            typeProjet: p.typeProjet ?? "",
            note: String(p.note ?? 5),
            auteur: p.auteur ?? "",
            dossierId: p.dossierId ?? "",
            clientId: p.clientId ?? "",
            photoAvant: p.photoAvant ?? "",
            photoApres: p.photoApres ?? "",
            accord: !!p.accordClientLe,
            accordClientLe: p.accordClientLe ? p.accordClientLe.slice(0, 10) : "",
          }
        : VIDE
    );
    setOuverte(true);
  };

  const choisirDossier = (id: string) => {
    const d = dossiers.find((x) => x.id === id);
    setSaisie((s) => ({ ...s, dossierId: id, clientId: d?.clientId ?? "", ville: s.ville || d?.ville || "", typeProjet: s.typeProjet || d?.typeProjet || "", titre: s.titre || (d ? d.objet : ""), photoAvant: "", photoApres: "" }));
  };

  const enregistrer = async () => {
    setEnvoi("enregistrer");
    try {
      const corps = {
        type: saisie.type,
        titre: saisie.titre,
        texte: saisie.texte || null,
        ville: saisie.ville || null,
        typeProjet: saisie.typeProjet || null,
        note: saisie.type === "AVIS" ? Number(saisie.note) : null,
        auteur: saisie.auteur || null,
        dossierId: saisie.dossierId || null,
        clientId: saisie.clientId || null,
        photoAvant: saisie.photoAvant || null,
        photoApres: saisie.photoApres || null,
        accordClientLe: saisie.accord && saisie.accordClientLe ? saisie.accordClientLe : null,
      };
      const { publication } = enCours
        ? await envoyerJson<{ publication: PublicationVue }>(`/api/publications/${enCours.id}`, "PATCH", corps)
        : await envoyerJson<{ publication: PublicationVue }>("/api/publications", "POST", corps);
      setPublications((liste) => (enCours ? liste.map((p) => (p.id === publication.id ? publication : p)) : [publication, ...liste]));
      setOuverte(false);
      toast.success(enCours ? "Publication modifiée" : "Publication enregistrée (brouillon)");
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnvoi(null);
    }
  };

  const action = async (p: PublicationVue, quoi: "publier" | "retirer") => {
    setEnvoi(`${quoi}-${p.id}`);
    try {
      const { publication } = await envoyerJson<{ publication: PublicationVue }>(`/api/publications/${p.id}`, "PATCH", { action: quoi });
      setPublications((liste) => liste.map((x) => (x.id === publication.id ? publication : x)));
      toast.success(quoi === "publier" ? "En ligne sur coverswap.fr (visible sous cinq minutes)" : "Retirée du site");
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnvoi(null);
    }
  };

  const realisations = publications.filter((p) => p.type === "REALISATION");
  const avis = publications.filter((p) => p.type === "AVIS");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6 md:px-8">
      <EnTetePage
        titre="Site"
        sousTitre="Ce que coverswap.fr montre : réalisations (photos après chantier) et avis clients. Rien ne part en ligne sans l'accord écrit de la personne."
        actions={
          <Bouton variante="primaire" icone={<Globe size={15} aria-hidden />} onClick={() => ouvrir()}>
            Nouvelle publication
          </Bouton>
        }
      />

      {[
        { titre: "Réalisations", liste: realisations, icone: <ImageIcon size={22} aria-hidden /> },
        { titre: "Avis clients", liste: avis, icone: <Star size={22} aria-hidden /> },
      ].map((section) => (
        <section key={section.titre}>
          <TitreSection>
            {section.titre} · {section.liste.length}
          </TitreSection>
          {section.liste.length === 0 ? (
            <EtatVide icone={section.icone} titre={`Aucune ${section.titre.toLowerCase().replace(/s clients?$/, "")} pour l'instant`} texte={section.titre === "Réalisations" ? "Ajoute des photos après chantier dans un dossier, puis crée une publication ici." : "Un avis se publie avec le texte et l'accord daté de la personne."} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {section.liste.map((p) => {
                const e = etat(p);
                return (
                  <li key={p.id} className={cn(CARTE, "flex gap-3 p-3")}>
                    {p.photoApres ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/dossiers/${p.dossierId}/photos/${p.photoApres.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "")}`} alt="" className="h-20 w-24 shrink-0 rounded-[8px] object-cover border-[0.5px] border-[#2A2D34]" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13.5px] text-[#F2F3F5]">{p.titre}</p>
                        <Pastille ton={e.ton}>{e.libelle}</Pastille>
                      </div>
                      <p className="mt-0.5 text-[12px] text-[#6B7280]">
                        {[p.ville, p.typeProjet ? LIBELLES_TYPE_PROJET[p.typeProjet] ?? p.typeProjet : null, p.type === "AVIS" && p.note ? `${p.note}/5` : null, p.auteur, p.accordClientLe ? `accord du ${formatDateCourte(p.accordClientLe)}` : "sans accord écrit"].filter(Boolean).join(" · ")}
                      </p>
                      {p.texte ? <p className="mt-1 line-clamp-2 text-[12.5px] text-[#9CA3AF]">{p.texte}</p> : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Bouton taille="sm" onClick={() => ouvrir(p)}>
                          Modifier
                        </Bouton>
                        {p.publieLe && !p.retireLe ? (
                          <Bouton taille="sm" variante="danger" chargement={envoi === `retirer-${p.id}`} onClick={() => void action(p, "retirer")}>
                            Retirer du site
                          </Bouton>
                        ) : (
                          <Bouton taille="sm" variante="primaire" chargement={envoi === `publier-${p.id}`} onClick={() => void action(p, "publier")}>
                            Publier
                          </Bouton>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      <Modale
        ouverte={ouverte}
        onFermer={() => setOuverte(false)}
        titre={enCours ? "Modifier la publication" : "Nouvelle publication"}
        description="Une réalisation vient d'un dossier avec ses photos après chantier ; un avis reprend les mots de la personne. L'accord écrit se date ici."
        largeur="lg"
        pied={
          <>
            <Bouton onClick={() => setOuverte(false)}>Annuler</Bouton>
            <Bouton variante="primaire" chargement={envoi === "enregistrer"} onClick={() => void enregistrer()}>
              Enregistrer
            </Bouton>
          </>
        }
      >
        <div className="space-y-4">
          <ListeDeroulante libelle="Type" value={saisie.type} onChange={(e) => setSaisie({ ...saisie, type: e.target.value })} options={[{ valeur: "REALISATION", libelle: "Réalisation (photos)" }, { valeur: "AVIS", libelle: "Avis client" }]} />
          <ListeDeroulante
            libelle="Dossier d'origine"
            aide="Seuls les dossiers avec des photos après chantier apparaissent."
            value={saisie.dossierId}
            onChange={(e) => choisirDossier(e.target.value)}
            options={[{ valeur: "", libelle: "— aucun —" }, ...dossiers.map((d) => ({ valeur: d.id, libelle: `${d.objet} · ${d.clientNom}${d.ville ? ` · ${d.ville}` : ""} (${d.nbApres} après)` }))]}
          />
          <Champ libelle="Titre" obligatoire value={saisie.titre} onChange={(e) => setSaisie({ ...saisie, titre: e.target.value })} placeholder="Cuisine en chêne clair à Lattes" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ libelle="Ville" value={saisie.ville} onChange={(e) => setSaisie({ ...saisie, ville: e.target.value })} />
            <ListeDeroulante libelle="Type de projet" value={saisie.typeProjet} onChange={(e) => setSaisie({ ...saisie, typeProjet: e.target.value })} options={[{ valeur: "", libelle: "—" }, ...Object.entries(LIBELLES_TYPE_PROJET).map(([valeur, libelle]) => ({ valeur, libelle }))]} />
          </div>
          {saisie.type === "AVIS" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Champ libelle="Auteur (prénom ou initiales)" value={saisie.auteur} onChange={(e) => setSaisie({ ...saisie, auteur: e.target.value })} />
              <ListeDeroulante libelle="Note" value={saisie.note} onChange={(e) => setSaisie({ ...saisie, note: e.target.value })} options={[5, 4, 3, 2, 1].map((n) => ({ valeur: String(n), libelle: `${n} / 5` }))} />
            </div>
          ) : null}
          <ZoneTexte libelle={saisie.type === "AVIS" ? "Texte de l'avis (ses mots, tels quels)" : "Légende"} rows={3} value={saisie.texte} onChange={(e) => setSaisie({ ...saisie, texte: e.target.value })} />
          {saisie.type === "REALISATION" && saisie.dossierId ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {(["photoAvant", "photoApres"] as const).map((cle) => (
                <fieldset key={cle}>
                  <legend className="mb-1.5 text-[12.5px] text-[#9CA3AF]">{cle === "photoAvant" ? "Photo avant (facultative)" : "Photo après (obligatoire pour publier)"}</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {photos
                      .filter((ph) => (cle === "photoApres" ? ph.apres : !ph.apres))
                      .map((ph) => (
                        <button
                          key={ph.chemin}
                          type="button"
                          aria-pressed={saisie[cle] === ph.chemin}
                          onClick={() => setSaisie({ ...saisie, [cle]: saisie[cle] === ph.chemin ? "" : ph.chemin })}
                          className={cn("overflow-hidden rounded-[8px] border-2", saisie[cle] === ph.chemin ? "border-[#1D9E75]" : "border-transparent hover:border-[#3A3E47]")}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ph.url} alt="" className="aspect-square w-full object-cover" />
                        </button>
                      ))}
                    {photos.filter((ph) => (cle === "photoApres" ? ph.apres : !ph.apres)).length === 0 ? <p className="col-span-3 text-[12px] text-[#6B7280]">Aucune photo de ce type dans le dossier.</p> : null}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : null}
          <div className="space-y-2">
            <CaseACocher libelle="Accord écrit de la personne reçu" description="Mail, SMS ou signature : la publication de ses photos ou de ses mots sur le site." checked={saisie.accord} onChange={(accord) => setSaisie({ ...saisie, accord })} />
            {saisie.accord ? <Champ libelle="Date de l'accord" type="date" obligatoire value={saisie.accordClientLe} onChange={(e) => setSaisie({ ...saisie, accordClientLe: e.target.value })} /> : null}
          </div>
        </div>
      </Modale>
    </div>
  );
}
