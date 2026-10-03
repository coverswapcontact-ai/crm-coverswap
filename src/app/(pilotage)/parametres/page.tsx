import type { Metadata } from "next";
import { vueAcces, vueConsignes } from "@/lib/assistant/vues-parametres";
import { lireCompteurs } from "@/lib/dossiers/compteurs";
import { etatMiroir } from "@/lib/drive/synchronisation";
import { etatConnexionGoogle } from "@/lib/google/connexion";
import { reglagesMail } from "@/lib/mail/reglages-vue";
import { etatAgentMail } from "@/lib/messages/consultation";
import { parametresPourEcran } from "@/lib/parametres/service";
import { etatFournisseur } from "@/lib/sms/fournisseurs";
import { listerCatalogue } from "@/lib/sms/modeles";
import OngletsParametres from "./_components/OngletsParametres";

export const metadata: Metadata = {
  title: "Paramètres — CoverSwap",
  description: "Activité, facturation (seuils et taux datés, numérotation), mail, SMS, assistant Claude, système (tâches de fond, cohérence, connexions, sessions de l'assistant), en six onglets ; ?section= ouvre un onglet.",
};

export const dynamic = "force-dynamic";

// Mission 13 (lot 3) : toutes les sections sont lues par le serveur, en une fois ; plus de « Chargement… » à l'arrivée.
// Mission 18 (A5) : sauf l'onglet Système, lu par ses propres routes quand on l'ouvre (le contrôle de cohérence parcourt
// tous les dossiers : il ne ralentit pas la page). `?section=systeme` (où mène /taches-de-fond) ouvre cet onglet.
export default async function ParametresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const texte = (cle: string) => (typeof parametres[cle] === "string" ? (parametres[cle] as string) : null);
  const [initiaux, google, drive, agent, mail, modeles, acces, consignes, compteurs] = await Promise.all([
    parametresPourEcran(),
    etatConnexionGoogle(),
    etatMiroir(),
    etatAgentMail(),
    reglagesMail(),
    listerCatalogue(),
    vueAcces(),
    vueConsignes(),
    lireCompteurs(),
  ]);
  return (
    <OngletsParametres
      parametres={initiaux}
      connexions={{ google, drive, agent }}
      retour={{ google: texte("google"), compte: texte("compte"), message: texte("message") }}
      mail={mail}
      sms={{ modeles, fournisseur: etatFournisseur() }}
      acces={acces}
      consignes={consignes}
      compteurs={compteurs}
      section={texte("section")}
    />
  );
}
