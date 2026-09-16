import Link from "next/link";
import { FolderKanban } from "lucide-react";

/** Bandeau des anciens écrans Devis et Factures, passés en lecture seule. */
export default function BandeauLectureSeule({ objet }: { objet: "devis" | "factures" }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-[13px] text-amber-800">
        <span className="font-semibold">Lecture seule.</span>{" "}
        {objet === "devis"
          ? "Les nouveaux devis se génèrent depuis un dossier, avec une numérotation unique."
          : "Les nouvelles factures et les encaissements se suivent depuis les dossiers."}
      </p>
      <Link
        href="/dossiers"
        className="inline-flex items-center gap-2 rounded-xl bg-[#CC0000] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#AA0000]"
      >
        <FolderKanban className="h-4 w-4" /> Ouvrir les dossiers
      </Link>
    </div>
  );
}
