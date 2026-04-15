import AIChat from "@/components/assistant/AIChat";

export default function AssistantPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Assistant IA</h1>
      <p className="text-gray-400">Posez vos questions sur vos leads, devis, et performances</p>
      <AIChat />
    </div>
  );
}
