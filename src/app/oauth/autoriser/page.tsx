import type { Metadata } from "next";
import { catalogueVue } from "@/lib/assistant/catalogue";
import { utilisateurConnecte } from "@/lib/oauth/session";
import { ErreurOAuth, demandeAutorisation, type DemandeAutorisation } from "@/lib/oauth/serveur";

export const metadata: Metadata = { title: "Autoriser une application — CoverSwap" };
export const dynamic = "force-dynamic";

/**
 * Page de consentement OAuth (mission 8). Derrière la session du CRM : seul
 * Lucas connecté peut accorder l'accès. Elle dit qui demande, vers où le
 * navigateur repartira, ce que l'application pourra faire, et deux boutons.
 * Une demande mal formée s'affiche ici, jamais de redirection à l'aveugle.
 */
export default async function AutoriserPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const utilisateur = await utilisateurConnecte();
  let demande: DemandeAutorisation | null = null;
  let erreur: string | null = null;
  try {
    demande = await demandeAutorisation(params);
  } catch (e) {
    erreur = e instanceof ErreurOAuth ? e.message : "Demande d'autorisation illisible.";
  }
  const outils = catalogueVue();
  const compte = (famille: "LECTURE" | "ANALYSE" | "ECRITURE") => outils.filter((o) => o.famille === famille).length;

  return (
    <main className="flex min-h-screen w-full flex-1 items-center justify-center bg-[#16181D] p-4 text-[#F2F3F5]">
      <div className="w-full max-w-[440px] rounded-[14px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-6 sm:p-7">
        <p className="flex items-baseline gap-2 text-[17px] font-semibold tracking-tight">
          CoverSwap
          <span className="text-[13px] font-normal text-[#6B7280]">assistant</span>
        </p>
        {erreur || !demande ? (
          <>
            <h1 className="mt-4 text-[15px] font-medium">Demande d&apos;autorisation refusée</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-[#F5B454]">{erreur}</p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-[#9CA3AF]">Rien n&apos;a été accordé. Recommence l&apos;ajout du connecteur depuis l&apos;application Claude ; si l&apos;erreur persiste, regarde Paramètres → Assistant Claude.</p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-[15px] font-medium">
              « {demande.client.nom} » demande l&apos;accès à ton CRM
            </h1>
            <dl className="mt-3 space-y-1.5 text-[12.5px] text-[#9CA3AF]">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-[#6B7280]">Application</dt>
                <dd className="break-all text-[#D1D5DB]">{demande.client.nom} <span className="text-[#6B7280]">({demande.client.origine === "CIMD" ? "identité vérifiée par document" : demande.client.origine === "DCR" ? "enregistrée dynamiquement" : "enregistrée à la main"})</span></dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-[#6B7280]">Retour vers</dt>
                <dd className="break-all text-[#D1D5DB]">{new URL(demande.redirectUri).host}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-[#6B7280]">Au nom de</dt>
                <dd className="break-all text-[#D1D5DB]">{utilisateur ?? "personne (connexion requise)"}</dd>
              </div>
            </dl>
            <div className="mt-4 rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3 text-[12.5px] leading-relaxed text-[#9CA3AF]">
              <p className="text-[#D1D5DB]">Ce que l&apos;application pourra faire, en ton nom :</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                <li>lire le CRM ({compte("LECTURE")} outils) et lancer les analyses ({compte("ANALYSE")} managers) ;</li>
                <li>écrire ({compte("ECRITURE")} outils) : notes, étapes, planification, documents… Les actions sensibles (mail ou lien à un client, facture, encaissement, action en masse) exigent ta confirmation dans Claude ;</li>
                <li>rien ne se supprime : « supprimer » archive. Chaque action est journalisée avec ta phrase (acteur « Claude (assistant) »).</li>
              </ul>
              <p className="mt-2">Accès révocable à tout moment dans Paramètres → Assistant Claude. Jeton d&apos;accès de 12 heures, renouvelé jusqu&apos;à 90 jours.</p>
            </div>
            <form method="post" action="/api/oauth/autoriser" className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {(["client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method", "resource", "response_type"] as const).map((cle) => {
                const v = params[cle];
                const valeur = Array.isArray(v) ? v[0] : v;
                return typeof valeur === "string" ? <input key={cle} type="hidden" name={cle} value={valeur} /> : null;
              })}
              <button type="submit" name="decision" value="refuser" className="inline-flex h-10 items-center justify-center rounded-[9px] border-[0.5px] border-[#2A2D34] px-4 text-[13px] text-[#D1D5DB] hover:bg-[#23262D]">
                Refuser
              </button>
              <button type="submit" name="decision" value="accorder" disabled={!utilisateur} className="inline-flex h-10 items-center justify-center rounded-[9px] bg-[#5DCAA5] px-4 text-[13px] font-medium text-[#0F1A16] hover:bg-[#6FD6B3] disabled:opacity-50">
                Autoriser l&apos;accès
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
