"use client";

import { useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, RefreshCw, TestTube } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Pastille } from "@/components/pilotage/ui";
import type { ResultatCanal } from "@/lib/alertes/canaux";
import { pluriel, quand } from "@/lib/commun/format";
import type { RapportEssai } from "@/lib/meta/essai";
import type { EtatCanal, SanteMeta } from "@/lib/meta/sante";
import { cn } from "@/lib/utils";
import { CARTE_A, LBL, PAD_CARTE, TITRE_CARTE } from "./base";

/**
 * Mission 17 (partie B) — « Chaîne des leads Meta », en bas de l'onglet Publicité : ce qui SERT À TRAVAILLER de
 * l'ancien écran /publicite (retiré), sans ses chiffres (repris par l'Analytique) : état de la chaîne, réception,
 * accès et notifications, essai complet, leads reçus mais pas encore dans le CRM (rejouer). Lu en base par le
 * serveur avec l'onglet (sans appel à Meta) ; « Vérifier » interroge Meta (jeton, abonnement de la page).
 */

function Ligne({ libelle, valeur, ton }: { libelle: string; valeur: React.ReactNode; ton?: "vert" | "ambre" | "rouge" | "neutre" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-trait py-2 last:border-0">
      <span className="text-[13px] text-texte-3">{libelle}</span>
      <span className={cn("text-right text-[13px]", ton === "vert" && "text-action-clair", (ton === "ambre" || ton === "rouge") && "text-attention-texte", (!ton || ton === "neutre") && "text-texte")}>
        {valeur}
      </span>
    </div>
  );
}

function CanalNotification({ etat, essai }: { etat: EtatCanal; essai: ResultatCanal | null }) {
  const ton = !etat.configure ? "ambre" : essai && !essai.ok ? "rouge" : etat.dernier && !etat.dernier.ok ? "rouge" : "vert";
  const valeur = !etat.configure
    ? etat.manquantes.length > 0
      ? `à configurer : ${etat.manquantes.join(", ")}`
      : "aucun appareil abonné : installer l'application sur le téléphone, puis activer les notifications"
    : essai
      ? essai.ok
        ? "essai envoyé à l'instant"
        : `essai en échec — ${essai.detail ?? "raison inconnue"}`
      : etat.dernier
        ? etat.dernier.ok
          ? `dernier envoi ${quand(etat.dernier.quand) ?? "jamais"}`
          : `dernier envoi en échec — ${etat.dernier.detail ?? "raison inconnue"}`
        : "configuré, aucun envoi encore";
  return <Ligne libelle={`${etat.canal}${etat.pousse ? " (push)" : " (mail)"}`} valeur={valeur} ton={ton} />;
}

const SOUS_CARTE = "rounded-[10px] border border-trait bg-fond p-4";

export function ChaineMeta({ initiale }: { initiale: SanteMeta }) {
  const [sante, setSante] = useState(initiale);
  const [ouvert, setOuvert] = useState(initiale.chaine.code !== "COMPLETE" || initiale.echecs.nombre > 0);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [rapport, setRapport] = useState<RapportEssai | null>(null);
  const [essaiNotification, setEssaiNotification] = useState<ResultatCanal[] | null>(null);

  async function rafraichir(interrogerMeta: boolean) {
    setOccupe("verifier");
    try {
      const { sante: neuve } = await appelApi<{ sante: SanteMeta }>(`/api/meta/sante?jours=7${interrogerMeta ? "" : "&meta=0"}`);
      setSante(neuve);
      setOuvert(true);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function rejouer(leadgenId?: string) {
    setOccupe(leadgenId ?? "rejouer");
    try {
      const { rejoues } = await envoyerJson<{ rejoues: number }>("/api/meta/rejouer", "POST", leadgenId ? { leadgenId } : {});
      toast.success(rejoues > 0 ? `${pluriel(rejoues, "lead")} remis en file.` : "Aucun lead à rejouer.");
      await rafraichir(false);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function testerNotification() {
    setOccupe("notification");
    try {
      const { resultats, pousseRecue } = await envoyerJson<{
        resultats: ResultatCanal[];
        pousseRecue: boolean;
      }>("/api/meta/notification", "POST", {});
      setEssaiNotification(resultats);
      if (pousseRecue) toast.success("Notification poussée envoyée : regarde ton téléphone.");
      else toast.error("Aucune notification poussée n'est partie.");
      await rafraichir(false);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function essayer(notifier: boolean) {
    setOccupe("essai");
    setRapport(null);
    try {
      const { rapport: resultat } = await envoyerJson<{
        rapport: RapportEssai;
      }>("/api/meta/essai", "POST", { notifier });
      setRapport(resultat);
      if (resultat.ok) toast.success("Essai complet réussi.");
      else toast.error("L'essai a relevé un problème.");
      await rafraichir(false);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  const { chaine, webhook, configuration, jeton, notifications, conversions, echecs } = sante;
  const complete = chaine.code === "COMPLETE";
  const recoit = webhook.recoit === "OUI";

  return (
    <section id="chaine-meta" className={cn(CARTE_A, PAD_CARTE, "flex flex-col gap-4")} aria-label="Chaîne des leads Meta">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className={TITRE_CARTE}>Chaîne des leads Meta</h2>
          <p className="text-[12px] text-texte-3 md:text-[13px]">Les leads Meta arrivent en direct dans le CRM : cette partie dit si la chaîne fonctionne.</p>
        </div>
        <div className="flex items-center gap-2">
          <Bouton taille="sm" icone={<RefreshCw size={13} aria-hidden />} chargement={occupe === "verifier"} onClick={() => void rafraichir(true)}>
            Vérifier
          </Bouton>
          <Bouton
            taille="sm"
            variante="fantome"
            aria-expanded={ouvert}
            aria-controls="chaine-meta-detail"
            icone={<ChevronDown size={14} aria-hidden className={cn("transition-transform duration-150", ouvert && "rotate-180")} />}
            onClick={() => setOuvert((o) => !o)}
          >
            {ouvert ? "Replier" : "Détail"}
          </Bouton>
        </div>
      </div>

      <div className={cn("rounded-[10px] border px-3.5 py-3", complete ? "border-action/40 bg-action-fond" : "border-attention-texte/40 bg-attention-texte/5")}>
        <p className={cn("flex items-start gap-2 text-[13.5px] leading-relaxed", complete ? "text-action-clair" : "text-attention-texte")}>
          {complete ? <CheckCircle2 size={15} aria-hidden className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />}
          <span>{chaine.libelle}</span>
        </p>
        {sante.alertes.length > 0 ? (
          <ul className="mt-2 space-y-1 border-t border-trait pt-2 text-[13px] text-texte-2">
            {sante.alertes.map((alerte) => (
              <li key={alerte}>• {alerte}</li>
            ))}
          </ul>
        ) : null}
        {echecs.nombre > 0 ? <p className="mt-2 text-[13px] text-attention-texte">{pluriel(echecs.nombre, "lead")} reçus mais pas encore dans le CRM.</p> : null}
      </div>

      {ouvert ? (
        <div id="chaine-meta-detail" className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={SOUS_CARTE}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className={cn(LBL, "flex items-center gap-2")}>
                  Réception <Pastille ton={recoit ? "vert" : "ambre"}>{recoit ? "reçoit des leads" : webhook.recoit === "PRET" ? "prêt, aucun lead sur 7 jours" : "ne reçoit pas"}</Pastille>
                </p>
                <Bouton taille="sm" icone={<TestTube size={14} aria-hidden />} chargement={occupe === "essai"} onClick={() => void essayer(true)}>
                  Lancer un essai
                </Bouton>
              </div>
              <Ligne libelle="Diagnostic" valeur={webhook.recoitDetail} />
              <Ligne libelle="Dernier lead reçu" valeur={`${quand(webhook.dernierLeadLe) ?? "jamais"}${webhook.dernierLeadNom ? ` · ${webhook.dernierLeadNom}` : ""}`} />
              <Ligne libelle="Sur 24 heures" valeur={webhook.surVingtQuatreHeures} />
              <Ligne libelle="Sur 7 jours" valeur={webhook.surSeptJours} />
              <Ligne libelle="Depuis le début" valeur={webhook.total} />
              <Ligne
                libelle="Abonnement de la page"
                valeur={
                  webhook.abonnement ? (webhook.abonnement.abonne ? `oui (${webhook.abonnement.champs.join(", ")})` : (webhook.abonnement.erreur ?? "non abonnée")) : "non vérifié (bouton Vérifier)"
                }
                ton={webhook.abonnement?.abonne ? "vert" : webhook.abonnement ? "rouge" : undefined}
              />
              <Ligne libelle="En cours de traitement" valeur={sante.enAttente} />
            </div>

            <div className={SOUS_CARTE}>
              <p className={cn(LBL, "mb-2")}>Accès et notifications</p>
              <Ligne libelle="Signature des appels" valeur={configuration.signature ? "vérifiée" : "META_APP_SECRET absente"} ton={configuration.signature ? "vert" : "ambre"} />
              <Ligne
                libelle="Lecture des formulaires"
                valeur={!configuration.lecture ? "jeton absent" : chaine.lectureImpossible ? "impossible (jeton refusé)" : "possible"}
                ton={configuration.lecture && !chaine.lectureImpossible ? "vert" : "rouge"}
              />
              <Ligne libelle="Jeton Meta" valeur={jeton.message} ton={jeton.etat === "sain" ? "vert" : jeton.etat === "absent" || jeton.etat === "non_verifie" ? "neutre" : "ambre"} />
              <Ligne libelle="Le téléphone sonne" valeur={notifications.push ? "oui" : "NON — seul le mail part"} ton={notifications.push ? (notifications.suffisant ? "vert" : "ambre") : "rouge"} />
              <Ligne
                libelle="Conversions renvoyées (7 j)"
                valeur={
                  !configuration.conversions
                    ? "non configuré"
                    : chaine.conversionsImpossibles
                      ? `impossibles (jeton) · ${conversions.enEchec} en échec`
                      : `${conversions.envoyees7j}${conversions.enEchec ? ` · ${conversions.enEchec} en échec` : ""}`
                }
                ton={!configuration.conversions ? "ambre" : chaine.conversionsImpossibles ? "rouge" : "vert"}
              />
              <Ligne libelle="Version de l'API" valeur={configuration.version} />
            </div>
          </div>

          <div className={SOUS_CARTE}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className={LBL}>Notification d&apos;un nouveau lead</p>
              <Bouton taille="sm" icone={<BellRing size={14} aria-hidden />} chargement={occupe === "notification"} onClick={() => void testerNotification()}>
                Tester la notification
              </Bouton>
            </div>
            {notifications.etats.map((etat) => (
              <CanalNotification key={etat.canal} etat={etat} essai={essaiNotification?.find((r) => r.canal === etat.canal) ?? null} />
            ))}
            {notifications.leadsSansPush.length > 0 ? (
              <div className="mt-3 rounded-[10px] border border-attention-texte/40 bg-attention-texte/5 p-3">
                <p className="text-[13px] text-attention-texte">{pluriel(notifications.leadsSansPush.length, "lead")} reçus sans notification poussée : le téléphone n&apos;a pas sonné.</p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-texte-3">
                  {notifications.leadsSansPush.slice(0, 5).map((lead) => (
                    <li key={lead.leadgenId}>
                      {lead.nom ?? `leadgen_id ${lead.leadgenId}`} · {quand(lead.quand) ?? "jamais"} · {lead.detail}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className={SOUS_CARTE}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className={LBL}>Leads reçus mais pas encore dans le CRM · {echecs.nombre}</p>
              {echecs.nombre > 0 ? (
                <Bouton taille="sm" chargement={occupe === "rejouer"} onClick={() => void rejouer()}>
                  Tout rejouer
                </Bouton>
              ) : null}
            </div>
            {echecs.nombre === 0 ? (
              <p className="text-[13px] text-texte-3">Aucun : tout ce que Meta a envoyé est arrivé dans le CRM.</p>
            ) : (
              <ul className="flex flex-col">
                {echecs.leads.map((lead) => (
                  <li key={lead.leadgenId} className="flex flex-wrap items-center justify-between gap-3 border-t border-trait py-2.5 first:border-t-0">
                    <div className="min-w-0">
                      <p className="text-[13px] text-texte">
                        Formulaire rempli {quand(lead.soumisLe) ?? "jamais"}
                        {lead.campagne ? ` · ${lead.campagne}` : ""}
                      </p>
                      <p className="text-[12px] text-texte-3">
                        leadgen_id {lead.leadgenId} · {pluriel(lead.tentatives, "tentative")}
                        {lead.erreur ? ` · ${lead.erreur}` : ""}
                      </p>
                    </div>
                    <Bouton taille="sm" chargement={occupe === lead.leadgenId} onClick={() => void rejouer(lead.leadgenId)}>
                      Rejouer
                    </Bouton>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {rapport ? (
            <div className={SOUS_CARTE}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className={cn(LBL, "flex items-center gap-2")}>Résultat de l&apos;essai {rapport.ok ? <Pastille ton="vert">tout est bon</Pastille> : <Pastille ton="ambre">à regarder</Pastille>}</p>
                <Bouton taille="sm" icone={<BellRing size={14} aria-hidden />} chargement={occupe === "essai"} onClick={() => void essayer(false)}>
                  Refaire sans notification
                </Bouton>
              </div>
              <ul className="space-y-1">
                {rapport.etapes.map((etape) => (
                  <li key={etape.etape} className="flex items-start gap-2 text-[13px]">
                    <span className={etape.ok ? "text-action-clair" : "text-attention-texte"}>{etape.ok ? "✓" : "✕"}</span>
                    <span className="text-texte-2">
                      <span className="text-texte">{etape.etape}</span> — {etape.detail}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-texte-3">Le contact d&apos;essai est archivé automatiquement : il n&apos;apparaît pas dans les leads.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
