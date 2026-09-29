"use client";

import { useState } from "react";
import { Archive, Mail, Pencil, Phone, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, Modale, Pastille, Puces, TRANS } from "@/components/pilotage/ui";
import { formaterTelephone } from "@/lib/clients/normalisation";
import type { ClientDetail, CoordonneeVue } from "@/lib/clients/types";
import { cn } from "@/lib/utils";
import { Carte } from "./fiche-ui";

/** Mission 13 (lot 7) : la rubrique « Coordonnées » de la fiche client — ajout, correction, archivage, coordonnée principale. */
export function Coordonnees({ client, onMiseAJour }: { client: ClientDetail; onMiseAJour: (client: ClientDetail) => void }) {
  const figee = Boolean(client.anonymiseLe || client.fusionneDans);
  const [ajout, setAjout] = useState<"email" | "telephone" | null>(null);
  const [edition, setEdition] = useState<{ nature: "email" | "telephone"; coordonnee: CoordonneeVue; valeur: string; libelle: string } | null>(null);
  const [valeur, setValeur] = useState("");
  const [libelle, setLibelle] = useState("");
  const [enArchivage, setEnArchivage] = useState<{ nature: "email" | "telephone"; coordonnee: CoordonneeVue } | null>(null);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function appeler(url: string, donnees: unknown, succes: string) {
    setEnvoi(true);
    try {
      const { client: misAJour } = await envoyerJson<{ client: ClientDetail }>(url, "POST", donnees);
      onMiseAJour(misAJour);
      toast.success(succes);
      return true;
    } catch (erreur) {
      toast.error("Modification impossible", { description: messageErreur(erreur) });
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  const rendre = (nature: "email" | "telephone", liste: CoordonneeVue[]) => {
    const actives = liste.filter((coordonnee) => !coordonnee.archiveLe);
    const archivees = liste.filter((coordonnee) => coordonnee.archiveLe);
    return (
      <>
        {actives.map((coordonnee) => (
          <li key={coordonnee.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <a
              href={nature === "email" ? `mailto:${coordonnee.valeur}` : `tel:${coordonnee.valeur}`}
              className={cn("flex min-h-11 sm:min-h-9 min-w-0 items-center gap-2 text-[13.5px] text-[#F2F3F5] hover:text-[#5DCAA5]", TRANS)}
            >
              {nature === "email" ? <Mail size={14} className="shrink-0 text-[#6B7280]" aria-hidden /> : <Phone size={14} className="shrink-0 text-[#6B7280]" aria-hidden />}
              <span className="truncate">{nature === "email" ? coordonnee.valeur : formaterTelephone(coordonnee.valeur)}</span>
              {coordonnee.libelle ? <span className="text-[12px] text-[#6B7280]">({coordonnee.libelle})</span> : null}
            </a>
            <span className="flex items-center gap-1">
              {coordonnee.principale ? (
                <Pastille ton="vert">
                  <Star size={10} aria-hidden className="fill-current" />
                  Principal
                </Pastille>
              ) : (
                <Bouton
                  taille="sm"
                  variante="fantome"
                  disabled={envoi || figee}
                  onClick={() =>
                    void appeler(`/api/clients/${client.id}/coordonnees/${coordonnee.id}`, { action: "principale", nature }, "Coordonnée principale changée")
                  }
                >
                  Rendre principal
                </Bouton>
              )}
              <Bouton
                taille="sm"
                variante="fantome"
                aria-label="Corriger"
                disabled={envoi || figee}
                onClick={() =>
                  setEdition({ nature, coordonnee, valeur: nature === "email" ? coordonnee.valeur : (coordonnee.saisi ?? formaterTelephone(coordonnee.valeur)), libelle: coordonnee.libelle ?? "" })
                }
              >
                <Pencil size={13} aria-hidden />
              </Bouton>
              <Bouton
                taille="sm"
                variante="fantome"
                aria-label="Archiver"
                disabled={envoi || figee}
                onClick={() => {
                  setMotif("");
                  setEnArchivage({ nature, coordonnee });
                }}
              >
                <Archive size={13} aria-hidden />
              </Bouton>
            </span>
          </li>
        ))}
        {archivees.map((coordonnee) => (
          <li key={coordonnee.id} className="py-1 text-[12px] text-[#6B7280] line-through decoration-[#6B7280]/50" title={coordonnee.archiveMotif ?? undefined}>
            {coordonnee.valeur.startsWith("anonymise-") ? "Effacé (RGPD)" : nature === "email" ? coordonnee.valeur : formaterTelephone(coordonnee.valeur)} — archivé
            {coordonnee.archiveMotif ? ` (${coordonnee.archiveMotif})` : ""}
          </li>
        ))}
      </>
    );
  };

  return (
    <Carte
      titre="Coordonnées"
      action={
        figee ? null : (
          <span className="flex gap-1">
            <Bouton taille="sm" variante="fantome" icone={<Plus size={13} aria-hidden />} onClick={() => setAjout("telephone")}>
              Numéro
            </Bouton>
            <Bouton taille="sm" variante="fantome" icone={<Plus size={13} aria-hidden />} onClick={() => setAjout("email")}>
              E-mail
            </Bouton>
          </span>
        )
      }
    >
      {client.telephones.length === 0 && client.emails.length === 0 ? (
        <p className="text-[13px] text-[#6B7280]">Aucune coordonnée.</p>
      ) : (
        <ul>
          {rendre("telephone", client.telephones)}
          {rendre("email", client.emails)}
        </ul>
      )}
      {client.adresse || client.ville ? (
        <p className="mt-2 border-t-[0.5px] border-[#2A2D34] pt-2 text-[13px] text-[#D1D5DB]">
          {[client.adresse, [client.codePostal, client.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
        </p>
      ) : null}

      <Modale
        ouverte={ajout !== null}
        onFermer={() => setAjout(null)}
        titre={ajout === "email" ? "Ajouter une adresse e-mail" : "Ajouter un numéro"}
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setAjout(null)}>
              Annuler
            </Bouton>
            <Bouton
              variante="primaire"
              chargement={envoi}
              disabled={!valeur.trim()}
              onClick={() =>
                void appeler(`/api/clients/${client.id}/coordonnees`, { nature: ajout, valeur, libelle: libelle || null }, "Coordonnée ajoutée").then((ok) => {
                  if (ok) {
                    setAjout(null);
                    setValeur("");
                    setLibelle("");
                  }
                })
              }
            >
              Ajouter
            </Bouton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Champ
            libelle={ajout === "email" ? "Adresse" : "Numéro"}
            type={ajout === "email" ? "email" : "tel"}
            inputMode={ajout === "email" ? "email" : "tel"}
            value={valeur}
            onChange={(evenement) => setValeur(evenement.target.value)}
          />
          <Champ libelle="Libellé (facultatif)" placeholder="pro, perso, comptabilité…" maxLength={40} value={libelle} onChange={(evenement) => setLibelle(evenement.target.value)} />
        </div>
      </Modale>

      <Modale
        ouverte={edition !== null}
        onFermer={() => setEdition(null)}
        titre={edition?.nature === "email" ? "Corriger l'adresse e-mail" : "Corriger le numéro"}
        description="Une faute de frappe se corrige sur place ; l'ancienne valeur reste au journal. Une coordonnée qui n'est plus utilisée s'archive plutôt."
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setEdition(null)}>
              Annuler
            </Bouton>
            <Bouton
              variante="primaire"
              chargement={envoi}
              disabled={!edition?.valeur.trim()}
              onClick={() =>
                edition &&
                void appeler(
                  `/api/clients/${client.id}/coordonnees/${edition.coordonnee.id}`,
                  { action: "modifier", nature: edition.nature, valeur: edition.valeur, libelle: edition.libelle.trim() || null },
                  "Coordonnée corrigée"
                ).then((ok) => ok && setEdition(null))
              }
            >
              Enregistrer
            </Bouton>
          </div>
        }
      >
        {edition ? (
          <div className="flex flex-col gap-3">
            <Champ
              libelle={edition.nature === "email" ? "Adresse" : "Numéro"}
              type={edition.nature === "email" ? "email" : "tel"}
              inputMode={edition.nature === "email" ? "email" : "tel"}
              value={edition.valeur}
              onChange={(evenement) => setEdition({ ...edition, valeur: evenement.target.value })}
            />
            <Champ libelle="Libellé (facultatif)" placeholder="pro, perso, comptabilité…" maxLength={40} value={edition.libelle} onChange={(evenement) => setEdition({ ...edition, libelle: evenement.target.value })} />
          </div>
        ) : null}
      </Modale>

      <Modale
        ouverte={enArchivage !== null}
        onFermer={() => setEnArchivage(null)}
        titre="Archiver cette coordonnée"
        description="Elle reste visible, barrée, et dans l'historique."
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setEnArchivage(null)}>
              Annuler
            </Bouton>
            <Bouton
              variante="danger"
              chargement={envoi}
              disabled={motif.trim().length < 3}
              onClick={() =>
                enArchivage &&
                void appeler(
                  `/api/clients/${client.id}/coordonnees/${enArchivage.coordonnee.id}`,
                  { action: "archiver", nature: enArchivage.nature, motif },
                  "Coordonnée archivée"
                ).then((ok) => ok && setEnArchivage(null))
              }
            >
              Archiver
            </Bouton>
          </div>
        }
      >
        <Puces
          libelle="Motif"
          obligatoire
          options={[
            { valeur: "Ne répond plus", libelle: "Ne répond plus" },
            { valeur: "Erreur de saisie", libelle: "Erreur de saisie" },
            { valeur: "Plus utilisée", libelle: "Plus utilisée" },
          ]}
          valeur={["Ne répond plus", "Erreur de saisie", "Plus utilisée"].includes(motif) ? motif : null}
          onChange={setMotif}
        />
        <Champ classeConteneur="mt-3" libelle="Ou préciser" value={motif} maxLength={300} onChange={(evenement) => setMotif(evenement.target.value)} />
      </Modale>
    </Carte>
  );
}
