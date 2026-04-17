"use client";

import DeleteRowButton from "@/components/ui/delete-row-button";

export default function ChantierActions({
  chantierId,
  reference,
}: {
  chantierId: string;
  reference: string;
}) {
  return (
    <div className="flex items-center gap-1 justify-end">
      <DeleteRowButton url={`/api/chantiers/${chantierId}`} entityLabel={`chantier ${reference}`} />
    </div>
  );
}
