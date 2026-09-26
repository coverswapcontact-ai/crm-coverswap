"use client";

import { useState } from "react";
import { Bot, Copy, History, RotateCcw, Save, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Pastille, TitreSection, TRANS, ZoneTexte } from "@/components/pilotage/ui";
import type { OutilVue } from "@/lib/assistant/catalogue";
import type { TexteReglable, VersionVue } from "@/lib/assistant/consignes";
import type { VueAccesAssistant, VueConsignesAssistant } from "@/lib/assistant/vues-parametres";
import { cn } from "@/lib/utils";

/**
 * Paramètres → Assistant Claude (mission 8) : l'adresse du serveur MCP et la
 * marche à suivre pour l'ajouter dans l'application Claude ; les applications
 * connectées (révocables une à une, ou toutes) ; les consignes et le
 * positionnement que Claude lit à chaque session ; le catalogue des outils
 * avec leur niveau. Aucun secret n'apparaît ici : la connexion se fait par
 * OAuth, avec ta session du CRM.
 */

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]";
type Acces = VueAccesAssistant;
type Consignes = VueConsignesAssistant;

const TON_NIVEAU: Record<OutilVue["niveau"], "neutre" | "vert" | "ambre"> = { LECTURE: "neutre", REVERSIBLE: "vert", SENSIBLE: "ambre" };
const FAMILLES: { cle: OutilVue["famille"]; libelle: string }[] = [
  { cle: "LECTURE", libelle: "Lecture" },
  { cle: "ANALYSE", libelle: "Managers d'analyse" },
  { cle: "MAIL", libelle: "Mail (lecture et écriture)" },
  { cle: "ECRITURE", libelle: "Écriture" },
];

const quand = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "jamais");

export default function AssistantClaude({ initialAcces, initialConsignes }: { initialAcces: Acces; initialConsignes: Consignes }) {
  // Mission 13 (lot 3) : accès et consignes arrivent du serveur avec la page.
  const [acces, setAcces] = useState<Acces>(initialAcces);
  const [consignes, setConsignes] = useState<Consignes | null>(initialConsignes);

  return (
    <section className="mt-10" id="assistant">
      <TitreSection>Assistant Claude</TitreSection>
      <div className="space-y-3">
        <CarteConnexion acces={acces} onMaj={setAcces} />
        {consignes ? <CarteTexte cle="consignes" titre="Consignes" aide="Ce que Claude lit à chaque session : tarifs, prestations, conditions, protocole de campagne, principes de décision, format du point du jour. Écris-les comme tu les dirais à un directeur général. Claude peut les modifier à ta demande (« modifier_consignes », avec ta confirmation) : chaque enregistrement garde une version." texte={consignes.consignes} defaut={consignes.defauts.consignes} versions={consignes.versions?.consignes ?? []} onMaj={setConsignes} /> : null}
        {consignes ? <CarteTexte cle="positionnement" titre="Positionnement (contexte marché)" aide="Le cadre des recherches web de Claude : ce que vend CoverSwap, à qui, contre qui, à quels prix." texte={consignes.positionnement} defaut={consignes.defauts.positionnement} versions={consignes.versions?.positionnement ?? []} onMaj={setConsignes} /> : null}
        <CarteOutils outils={acces.outils} />
      </div>
    </section>
  );
}

function CarteConnexion({ acces, onMaj }: { acces: Acces; onMaj: (a: Acces) => void }) {
  const [occupe, setOccupe] = useState<string | null>(null);

  async function revoquer(corps: { clientId: string } | { jetonId: string } | { tout: true }, cle: string) {
    if (!window.confirm("tout" in corps ? "Révoquer toutes les connexions ? Claude devra être reconnecté (Paramètres du connecteur → se reconnecter)." : "Révoquer cet accès ? L'application devra demander l'autorisation à nouveau.")) return;
    setOccupe(cle);
    try {
      onMaj(await envoyerJson<Acces>("/api/assistant/acces", "DELETE", corps));
      toast.success("Accès révoqué");
    } catch (erreur) {
      toast.error("Révocation impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function copier() {
    try {
      await navigator.clipboard.writeText(acces.adresseMcp);
      toast.success("Adresse copiée");
    } catch {
      toast.error("Copie impossible : sélectionne l'adresse à la main.");
    }
  }

  const clients = acces.acces.clients.filter((c) => !c.revoqueLe || c.connexions.some((j) => j.active));
  return (
    <div className={cn(CARTE, "p-4")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-[#F2F3F5]">
            <Bot size={15} aria-hidden className="text-[#5DCAA5]" />
            Serveur MCP du CRM
          </p>
          <p className="mt-1 break-all font-mono text-[12.5px] text-[#D1D5DB]">{acces.adresseMcp}</p>
        </div>
        <Bouton taille="sm" icone={<Copy size={13} aria-hidden />} onClick={() => void copier()}>
          Copier
        </Bouton>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-[#9CA3AF]">
        <li>Dans l&apos;application Claude (iPhone ou claude.ai) : Personnaliser → Connecteurs → Ajouter un connecteur personnalisé. Nom : « CoverSwap », adresse : celle ci-dessus. Laisse les champs de client OAuth vides.</li>
        <li>Claude ouvre la page d&apos;autorisation du CRM : connecte-toi au CRM si besoin et appuie sur « Autoriser l&apos;accès ». Aucun secret à recopier : ta session du CRM est la clé.</li>
        <li>Vérifie : « Fais-moi le point du matin ». La connexion apparaît ci-dessous ; l&apos;accès dure 12 heures et se renouvelle seul pendant 90 jours.</li>
      </ol>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-[#9CA3AF]">
          {acces.acces.connexionsActives === 0 ? "Aucune connexion active." : `${acces.acces.connexionsActives} connexion${acces.acces.connexionsActives > 1 ? "s" : ""} active${acces.acces.connexionsActives > 1 ? "s" : ""}.`}
        </p>
        {acces.acces.connexionsActives > 0 ? (
          <Bouton taille="sm" variante="danger" icone={<ShieldOff size={13} aria-hidden />} chargement={occupe === "tout"} onClick={() => void revoquer({ tout: true }, "tout")}>
            Tout révoquer
          </Bouton>
        ) : null}
      </div>
      {clients.length ? (
        <ul className="mt-3 divide-y-[0.5px] divide-[#2A2D34] rounded-[9px] border-[0.5px] border-[#2A2D34]">
          {clients.map((c) => (
            <li key={c.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#F2F3F5]">
                    {c.nom} <span className="text-[11.5px] font-normal text-[#6B7280]">{c.origine === "CIMD" ? "identité par document" : c.origine === "DCR" ? "enregistrement dynamique" : "à la main"} · depuis le {quand(c.creeLe)}</span>
                  </p>
                </div>
                {!c.revoqueLe ? (
                  <Bouton taille="sm" chargement={occupe === c.id} onClick={() => void revoquer({ clientId: c.id }, c.id)}>
                    Révoquer l&apos;application
                  </Bouton>
                ) : (
                  <Pastille ton="rouge">Révoquée</Pastille>
                )}
              </div>
              {c.connexions.length ? (
                <ul className="mt-2 space-y-1">
                  {c.connexions.map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#9CA3AF]">
                      <span>
                        {j.clientNom ?? "Client MCP"} · {j.utilisateur} · ouverte le {quand(j.creeLe)} · dernier usage {quand(j.dernierUsageLe)} · {j.active ? `expire le ${quand(j.expireLe)}` : j.revoqueLe ? "révoquée" : "expirée"}
                      </span>
                      {j.active ? (
                        <button type="button" className="text-[12px] text-[#F87171] hover:underline" disabled={occupe === j.id} onClick={() => void revoquer({ jetonId: j.id }, j.id)}>
                          Révoquer
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CarteTexte({ cle, titre, aide, texte, defaut, versions, onMaj }: { cle: "consignes" | "positionnement"; titre: string; aide: string; texte: TexteReglable; defaut: string; versions: VersionVue[]; onMaj: (c: Consignes) => void }) {
  const [valeur, setValeur] = useState(texte.texte);
  const [occupe, setOccupe] = useState(false);
  const [historique, setHistorique] = useState(false);
  const modifie = valeur.trim() !== texte.texte.trim();

  async function restaurer(numero: number) {
    if (!window.confirm(`Restaurer la version ${numero} ? Le texte actuel reste dans l'historique.`)) return;
    setOccupe(true);
    try {
      const r = await envoyerJson<Consignes>("/api/assistant/consignes", "PATCH", { restaurer: { texte: cle, numero } });
      onMaj(r);
      setValeur(r[cle].texte);
      toast.success(`Version ${numero} restaurée.`);
    } catch (erreur) {
      toast.error("Restauration impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupe(false);
    }
  }

  async function enregistrer(contenu: string) {
    setOccupe(true);
    try {
      const r = await envoyerJson<Consignes>("/api/assistant/consignes", "PATCH", { [cle]: contenu });
      onMaj(r);
      setValeur(r[cle].texte);
      toast.success(`${titre} : enregistré. Claude le lit à sa prochaine session.`);
    } catch (erreur) {
      toast.error("Non enregistré", { description: messageErreur(erreur) });
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div className={cn(CARTE, "p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] font-medium text-[#F2F3F5]">
          {titre} <span className="ml-1 text-[11.5px] font-normal text-[#6B7280]">{texte.source === "LUCAS" ? `écrit par toi${texte.majLe ? `, le ${quand(texte.majLe)}` : ""}` : "texte par défaut"}</span>
        </p>
        <div className="flex gap-2">
          {texte.source === "LUCAS" ? (
            <Bouton taille="sm" icone={<RotateCcw size={13} aria-hidden />} disabled={occupe} onClick={() => void enregistrer(defaut)}>
              Revenir au défaut
            </Bouton>
          ) : null}
          <Bouton taille="sm" variante="primaire" icone={<Save size={13} aria-hidden />} chargement={occupe} disabled={!modifie} onClick={() => void enregistrer(valeur.trim())}>
            Enregistrer
          </Bouton>
        </div>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#9CA3AF]">{aide}</p>
      <ZoneTexte libelle="" value={valeur} onChange={(e) => setValeur(e.target.value)} rows={14} className="mt-2 font-mono text-[12px]" classeConteneur="mt-2" />
      {versions.length ? (
        <div className="mt-2">
          <button type="button" onClick={() => setHistorique((v) => !v)} className={cn("inline-flex items-center gap-1.5 text-[12px] text-[#5DCAA5] hover:underline", TRANS)} aria-expanded={historique}>
            <History size={13} aria-hidden /> {historique ? "Masquer l'historique" : `Historique des versions (${versions.length})`}
          </button>
          {historique ? (
            <ul className="mt-2 divide-y-[0.5px] divide-[#2A2D34] rounded-[9px] border-[0.5px] border-[#2A2D34]">
              {versions.map((v) => (
                <li key={v.numero} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 text-[#D1D5DB]">
                    v{v.numero} · {quand(v.le)} · {v.par?.startsWith("ASSISTANT") ? "Claude" : v.par === "LUCAS" ? "toi" : (v.par ?? "?")}
                    {v.commande ? <span className="text-[#8B919C]"> · « {v.commande} »</span> : null}
                    <span className="text-[#6B7280]"> · {v.caracteres} car.</span>
                  </span>
                  {v.courante ? <Pastille ton="vert">Courante</Pastille> : (
                    <button type="button" disabled={occupe} onClick={() => void restaurer(v.numero)} className={cn("text-[12px] font-medium text-[#5DCAA5] hover:underline disabled:opacity-50", TRANS)}>
                      Restaurer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CarteOutils({ outils }: { outils: OutilVue[] }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div className={cn(CARTE, "p-4")}>
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOuvert((o) => !o)}>
        <p className="text-[13.5px] font-medium text-[#F2F3F5]">
          {outils.length} outils exposés à Claude <span className="ml-1 text-[11.5px] font-normal text-[#6B7280]">{outils.filter((o) => o.niveau === "LECTURE").length} lecture · {outils.filter((o) => o.niveau === "REVERSIBLE").length} réversibles · {outils.filter((o) => o.niveau === "SENSIBLE").length} sensibles</span>
        </p>
        <span className="text-[12px] text-[#5DCAA5]">{ouvert ? "Replier" : "Voir la liste"}</span>
      </button>
      {ouvert ? (
        <div className="mt-3 space-y-4">
          {FAMILLES.map((f) => (
            <div key={f.cle}>
              <p className="mb-1.5 text-[11.5px] font-medium tracking-wide text-[#6B7280] uppercase">{f.libelle}</p>
              <ul className="divide-y-[0.5px] divide-[#2A2D34] rounded-[9px] border-[0.5px] border-[#2A2D34]">
                {outils
                  .filter((o) => o.famille === f.cle)
                  .map((o) => (
                    <li key={o.nom} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[13px] text-[#F2F3F5]">
                          {o.titre} <code className="ml-1 text-[11px] text-[#6B7280]">{o.nom}</code>
                        </p>
                        <Pastille ton={TON_NIVEAU[o.niveau]}>{o.libelleNiveau}</Pastille>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-[#9CA3AF]">{o.description}</p>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <p className="text-[11.5px] leading-relaxed text-[#6B7280]">Sensible = jamais sans ta confirmation dans Claude (aperçu d&apos;abord). Rien ne se supprime : « supprimer » archive. Plafond : 60 écritures par heure, au-delà le serveur refuse et t&apos;alerte. Journal : Tâches de fond → Sessions de l&apos;assistant.</p>
        </div>
      ) : null}
    </div>
  );
}
