import LeadForm from "@/components/leads/LeadForm";

export default function NouveauLeadPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Nouveau Lead</h1>
      <LeadForm />
    </div>
  );
}
