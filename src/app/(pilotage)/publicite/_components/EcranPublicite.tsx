"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Megaphone, RefreshCw, TestTube } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, EnTetePage, EtatVide, Pastille, TitreSection } from "@/components/pilotage/ui";
import type { EtatCanal, ResultatParAxe, SanteMeta } from "@/lib/meta/sante";
import type { RapportEssai } from "@/lib/meta/essai";
import type { ResultatCanal } from "@/lib/alertes/canaux";
import { cn } from "@/lib/utils";

const CARTE = "rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#16181D]";

function quand(iso: string | null): string {
  if (!iso) return "jamais";
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 60 * 24) return `il y a ${Math.round(minutes / 60)} h`;
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function Ligne({ libelle, valeur, ton }: { libelle: string; valeur: React.ReactNode; ton?: "vert" | "ambre" | "rouge" | "neutre" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b-[0.5px] border-[#2A2D34] py-2 last:border-0">
      <span className="text-[13px] text-[#9CA3AF]">{libelle}</span>
      <span className={cn("text-[13px] text-right", ton === "vert" && "text-[#5DCAA5]", ton === "ambre" && "text-[#F5B454]", ton === "rouge" && "text-[#F87171]", !ton && "text-[#F2F3F5]")}>{valeur}</span>
    </div>
  );
}

const FENETRES = [7, 21, 30] as const;

function Tableau({ titre, lignes }: { titre: string; lignes: ResultatParAxe[] }) {
  if (lignes.length === 0) return null;
  return (
    <div className={cn(CARTE, "overflow-x-auto p-4")}>
      <TitreSection>{titre}</TitreSection>
      <table className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-[#6B7280]">
            <th className="py-1 text-left font-medium">Nom</th>
            <th className="py-1 text-right font-medium">Leads</th>
            <th className="py-1 text-right font-medium">Contactés</th>
            <th className="py-1 text-right font-medium">Devis</th>
            <th className="py-1 text-right font-medium">Signés</th>
            <th className="py-1 text-right font-medium">Perdus</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {lignes.map((ligne) => (
            <tr key={ligne.nom} className="border-t-[0.5px] border-[#2A2D34]">
              <td className="py-1.5 pr-3 text-[#F2F3F5]">{ligne.nom}</td>
              <td className="py-1.5 text-right text-[#F2F3F5]">{ligne.leads}</td>
              <td className="py-1.5 text-right text-[#9CA3AF]">{ligne.contactes}</td>
              <td className="py-1.5 text-right text-[#9CA3AF]">{ligne.devis}</td>
              <td className="py-1.5 text-right text-[#5DCAA5]">{ligne.signes}</td>
              <td className="py-1.5 text-right text-[#9CA3AF]">{ligne.perdus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Un canal d'alerte et son état réel : configuré ou non, et son dernier envoi. */
function CanalNotification({ etat, essai }: { etat: EtatCanal; essai: ResultatCanal | null }) {
  const ton = !etat.configure ? (etat.pousse && etat.manquantes.length > 0 ? "rouge" : "ambre") : essai && !essai.ok ? "rouge" : etat.dernier && !etat.dernier.ok ? "rouge" : "vert";
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
          ? `dernier envoi ${quand(etat.dernier.quand)}`
          : `dernier envoi en échec — ${etat.dernier.detail ?? "raison inconnue"}`
        : "configuré, aucun envoi encore";
  return (
    <Ligne
      libelle={`${etat.canal}${etat.pousse ? " (push)" : " (mail)"}`}
      valeur={valeur}
      ton={ton as "vert" | "ambre" | "rouge"}
    />
  );
}

/**
 * Écran Publicité : l'état de la chaîne Meta en un coup d'œil — réception,
 * accès, notifications, résultats par campagne et par publicité sur la durée
 * d'une campagne, leads en attente. Deux gestes : rejouer ce qui attend, et
 * lancer un essai complet.
 */
export default function EcranPublicite({ initiale }: { initiale: SanteMeta }) {
  const [sante, setSante] = useState(initiale);
  const [jours, setJours] = useState<number>(initiale.resultats.jours);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [rapport, setRapport] = useState<RapportEssai | null>(null);
  const [essaiNotification, setEssaiNotification] = useState<ResultatCanal[] | null>(null);

  const rafraichir = useCallback(async (fenetre = jours) => {
    setOccupe("rafraichir");
    try {
      const { sante: neuve } = await appelApi<{ sante: SanteMeta }>(`/api/meta/sante?jours=${fenetre}`);
      setSante(neuve);
      setJours(neuve.resultats.jours);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }, [jours]);

  const rejouer = async (leadgenId?: string) => {
    setOccupe(leadgenId ?? "rejouer");
    try {
      const { rejoues } = await envoyerJson<{ rejoues: number }>("/api/meta/rejouer", "POST", leadgenId ? { leadgenId } : {});
      toast.success(rejoues > 0 ? `${rejoues} lead(s) remis en file.` : "Aucun lead à rejouer.");
      await rafraichir();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  };

  const testerNotification = async () => {
    setOccupe("notification");
    try {
      const { resultats, pousseRecue } = await envoyerJson<{ resultats: ResultatCanal[]; pousseRecue: boolean }>("/api/meta/notification", "POST", {});
      setEssaiNotification(resultats);
      toast[pousseRecue ? "success" : "error"](
        pousseRecue ? "Notification poussée envoyée : vérifiez votre téléphone." : "Aucune notification poussée n'est partie."
      );
      await rafraichir();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  };

  const essayer = async (notifier: boolean) => {
    setOccupe("essai");
    setRapport(null);
    try {
      const { rapport: resultat } = await envoyerJson<{ rapport: RapportEssai }>("/api/meta/essai", "POST", { notifier });
      setRapport(resultat);
      toast[resultat.ok ? "success" : "error"](resultat.ok ? "Essai complet réussi." : "L'essai a relevé un problème.");
      await rafraichir();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  };

  const { webhook, configuration, jeton, notifications, conversions, echecs } = sante;
  const recoit = configuration.signature && configuration.verification && (webhook.abonnement?.abonne ?? webhook.actif);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6 md:px-8">
      <EnTetePage
        titre="Publicité"
        sousTitre="Les leads Meta arrivent ici en direct, sans intermédiaire. Cet écran dit si la chaîne fonctionne."
        actions={
          <>
            <Bouton icone={<RefreshCw size={15} aria-hidden />} chargement={occupe === "rafraichir"} onClick={() => void rafraichir()}>
              Rafraîchir
            </Bouton>
            <Bouton variante="primaire" icone={<TestTube size={15} aria-hidden />} chargement={occupe === "essai"} onClick={() => void essayer(true)}>
              Lancer un essai
            </Bouton>
          </>
        }
      />

      {sante.alertes.length > 0 ? (
        <section className={cn(CARTE, "border-[#EF9F27]/40 bg-[#EF9F27]/5 p-4")}>
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-[#F5B454]">
            <AlertTriangle size={15} aria-hidden /> À régler avant de lancer la campagne
          </h2>
          <ul className="space-y-1 text-[13px] text-[#D1D5DB]">
            {sante.alertes.map((alerte) => (
              <li key={alerte}>• {alerte}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className={cn(CARTE, "border-[#1D9E75]/40 bg-[#112B22] p-4")}>
          <p className="flex items-center gap-2 text-[13px] text-[#5DCAA5]">
            <CheckCircle2 size={15} aria-hidden /> Tout est en place : réception, lecture des leads, notification et renvoi des conversions.
          </p>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className={cn(CARTE, "p-4")}>
          <TitreSection>
            Réception{" "}
            <Pastille ton={recoit ? "vert" : "rouge"}>{recoit ? "webhook connecté" : "non connecté"}</Pastille>
          </TitreSection>
          <Ligne libelle="Dernier lead reçu" valeur={`${quand(webhook.dernierLeadLe)}${webhook.dernierLeadNom ? ` · ${webhook.dernierLeadNom}` : ""}`} />
          <Ligne libelle="Sur 24 heures" valeur={webhook.surVingtQuatreHeures} />
          <Ligne libelle="Sur 7 jours" valeur={webhook.surSeptJours} />
          <Ligne libelle="Depuis le début" valeur={webhook.total} />
          <Ligne
            libelle="Abonnement de la page"
            valeur={webhook.abonnement ? (webhook.abonnement.abonne ? `oui (${webhook.abonnement.champs.join(", ")})` : (webhook.abonnement.erreur ?? "non abonnée")) : "non vérifié"}
            ton={webhook.abonnement?.abonne ? "vert" : webhook.abonnement ? "rouge" : undefined}
          />
          <Ligne libelle="En cours de traitement" valeur={sante.enAttente} />
        </section>

        <section className={cn(CARTE, "p-4")}>
          <TitreSection>Accès et notifications</TitreSection>
          <Ligne libelle="Signature des appels" valeur={configuration.signature ? "vérifiée" : "META_APP_SECRET absente"} ton={configuration.signature ? "vert" : "rouge"} />
          <Ligne libelle="Lecture des formulaires" valeur={configuration.lecture ? "jeton présent" : "jeton absent"} ton={configuration.lecture ? "vert" : "rouge"} />
          <Ligne libelle="Jeton Meta" valeur={jeton.message} ton={jeton.etat === "sain" ? "vert" : jeton.etat === "proche" ? "ambre" : jeton.etat === "absent" ? "neutre" : "rouge"} />
          <Ligne
            libelle="Le téléphone sonne"
            valeur={notifications.push ? "oui" : "NON — seul le mail part"}
            ton={notifications.push ? (notifications.suffisant ? "vert" : "ambre") : "rouge"}
          />
          <Ligne libelle="Conversions renvoyées (7 j)" valeur={configuration.conversions ? `${conversions.envoyees7j}${conversions.enEchec ? ` · ${conversions.enEchec} en échec` : ""}` : "non configuré"} ton={configuration.conversions ? "vert" : "ambre"} />
          <Ligne libelle="Version de l'API" valeur={configuration.version} />
        </section>
      </div>

      <section className={cn(CARTE, "p-4")}>
        <TitreSection
          action={
            <Bouton taille="sm" icone={<BellRing size={14} aria-hidden />} chargement={occupe === "notification"} onClick={() => void testerNotification()}>
              Tester la notification
            </Bouton>
          }
        >
          Notification d&apos;un nouveau lead
        </TitreSection>
        <div className="space-y-2">
          {notifications.etats.map((etat) => (
            <CanalNotification key={etat.canal} etat={etat} essai={essaiNotification?.find((r) => r.canal === etat.canal) ?? null} />
          ))}
        </div>
        {notifications.leadsSansPush.length > 0 ? (
          <div className="mt-3 rounded-[10px] border-[0.5px] border-[#F87171]/40 bg-[#F87171]/5 p-3">
            <p className="text-[13px] text-[#F87171]">
              {notifications.leadsSansPush.length} lead(s) reçus sans notification poussée : le téléphone n&apos;a pas sonné.
            </p>
            <ul className="mt-1 space-y-0.5 text-[12px] text-[#9CA3AF]">
              {notifications.leadsSansPush.slice(0, 5).map((lead) => (
                <li key={lead.leadgenId}>
                  {lead.nom ?? `leadgen_id ${lead.leadgenId}`} · {quand(lead.quand)} · {lead.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <TitreSection
          action={
            <div className="flex items-center gap-1">
              {FENETRES.map((f) => (
                <Bouton key={f} taille="sm" variante={f === jours ? "primaire" : "secondaire"} onClick={() => void rafraichir(f)}>
                  {f} j
                </Bouton>
              ))}
            </div>
          }
        >
          Résultats par campagne et par publicité · {sante.resultats.leads} lead(s) sur {sante.resultats.jours} jours
        </TitreSection>
        {sante.resultats.leads === 0 ? (
          <EtatVide icone={<Megaphone size={22} aria-hidden />} titre="Aucun lead sur la période" texte="Les leads apparaîtront ici dès que la campagne tournera, avec leur campagne et leur publicité d'origine." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Tableau titre="Par campagne" lignes={sante.resultats.parCampagne} />
            <Tableau titre="Par publicité" lignes={sante.resultats.parPublicite} />
          </div>
        )}
      </section>

      <section>
        <TitreSection
          action={
            echecs.nombre > 0 ? (
              <Bouton taille="sm" chargement={occupe === "rejouer"} onClick={() => void rejouer()}>
                Tout rejouer
              </Bouton>
            ) : undefined
          }
        >
          Leads reçus mais pas encore dans le CRM · {echecs.nombre}
        </TitreSection>
        {echecs.nombre === 0 ? (
          <EtatVide icone={<Megaphone size={22} aria-hidden />} titre="Aucun lead en attente" texte="Tout ce que Meta a envoyé est arrivé dans Prospects." />
        ) : (
          <ul className="space-y-2">
            {echecs.leads.map((lead) => (
              <li key={lead.leadgenId} className={cn(CARTE, "flex flex-wrap items-center justify-between gap-3 p-3")}>
                <div className="min-w-0">
                  <p className="text-[13px] text-[#F2F3F5]">
                    Formulaire rempli {quand(lead.soumisLe)}
                    {lead.campagne ? ` · ${lead.campagne}` : ""}
                  </p>
                  <p className="text-[12px] text-[#9CA3AF]">
                    leadgen_id {lead.leadgenId} · {lead.tentatives} tentative(s){lead.erreur ? ` · ${lead.erreur}` : ""}
                  </p>
                </div>
                <Bouton taille="sm" chargement={occupe === lead.leadgenId} onClick={() => void rejouer(lead.leadgenId)}>
                  Rejouer
                </Bouton>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rapport ? (
        <section className={cn(CARTE, "p-4")}>
          <TitreSection
            action={
              <Bouton taille="sm" icone={<BellRing size={14} aria-hidden />} chargement={occupe === "essai"} onClick={() => void essayer(false)}>
                Refaire sans notification
              </Bouton>
            }
          >
            Résultat de l&apos;essai {rapport.ok ? <Pastille ton="vert">tout est bon</Pastille> : <Pastille ton="rouge">à regarder</Pastille>}
          </TitreSection>
          <ul className="space-y-1">
            {rapport.etapes.map((etape) => (
              <li key={etape.etape} className="flex items-start gap-2 text-[13px]">
                <span className={etape.ok ? "text-[#5DCAA5]" : "text-[#F87171]"}>{etape.ok ? "✓" : "✕"}</span>
                <span className="text-[#D1D5DB]">
                  <span className="text-[#F2F3F5]">{etape.etape}</span> — {etape.detail}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-[#9CA3AF]">Le contact d&apos;essai est archivé automatiquement : il n&apos;apparaît pas dans Prospects.</p>
        </section>
      ) : null}
    </div>
  );
}
