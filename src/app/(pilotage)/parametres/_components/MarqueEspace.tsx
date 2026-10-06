/**
 * Paramètres → Espace client : l'espace parle au nom de CoverSwap. Le client voit
 * le logo et « l'équipe CoverSwap », jamais une personne ; le bouton d'appel, lui,
 * compose toujours le numéro de Lucas. Rien à régler ici : c'est la marque.
 */
export default function MarqueEspace() {
  return (
    <section className="mt-10">
      <h2 className="text-[12px] font-medium tracking-wide text-texte-3 uppercase">Espace client</h2>
      <div className="mt-3 flex items-center gap-4 rounded-[12px] border-[0.5px] border-trait bg-surface p-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[14px] bg-[#F5F4F1]" aria-hidden>
          <span className="relative flex h-9 w-9 items-center justify-center">
            <span className="absolute inset-[4px] rotate-45 rounded-[5px] bg-[#CC0000]" />
            <span className="relative text-[15px] font-bold text-white">C</span>
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] text-texte">Le logo CoverSwap, en haut de l&apos;espace de chaque client</p>
          <p className="mt-0.5 text-[12.5px] text-texte-3">L&apos;espace parle au nom de CoverSwap (« l&apos;équipe CoverSwap », « CoverSwap prépare votre devis »). Le bouton « Appeler » compose votre numéro.</p>
        </div>
      </div>
    </section>
  );
}
