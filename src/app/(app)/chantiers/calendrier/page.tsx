import prisma from "@/lib/prisma";
import CustomCalendar from "@/components/chantiers/CustomCalendar";

export default async function CalendrierPage() {
  const chantiers = await prisma.chantier.findMany({ include: { lead: true } });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Calendrier des chantiers</h1>
      <CustomCalendar chantiers={JSON.parse(JSON.stringify(chantiers))} />
    </div>
  );
}
