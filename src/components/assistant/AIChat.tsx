"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Send, Bot, User, Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const suggestions = [
  "Analyse mes leads dormants",
  "Quels leads ont le meilleur score ?",
  "Calcule la marge pour 8ml de K1",
  "Rédige un email de relance",
];

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function sendMessage(text?: string) {
    const msg = text || input;
    if (!msg.trim()) return;

    const userMsg: Message = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error("Erreur");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            assistantContent += chunk;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", content: assistantContent };
              return updated;
            });
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setMessages((prev) => [...prev, { role: "assistant", content: "Désolé, une erreur est survenue. Vérifiez votre clé API." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="bg-[#262626] border-white/10 flex flex-col h-[600px]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-12 w-12 text-red-400 mb-4" />
            <p className="text-gray-400 mb-6">Comment puis-je vous aider ?</p>
            <div className="grid grid-cols-2 gap-2 max-w-md">
              {suggestions.map((s) => (
                <button key={s} onClick={() => sendMessage(s)}
                  className="text-left text-sm p-3 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 transition">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && <Bot className="h-6 w-6 text-red-400 shrink-0 mt-1" />}
            <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
              msg.role === "user" ? "bg-red-600/20 text-white" : "bg-white/5 text-gray-200"
            }`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === "user" && <User className="h-6 w-6 text-gray-400 shrink-0 mt-1" />}
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3">
            <Bot className="h-6 w-6 text-red-400 shrink-0 mt-1" />
            <div className="bg-white/5 rounded-lg px-4 py-2"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
          </div>
        )}
      </div>
      <div className="p-4 border-t border-white/10">
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Posez votre question..."
            className="bg-[#1a1a1a] border-white/10 text-white" disabled={loading} />
          <Button type="submit" disabled={loading || !input.trim()} className="bg-red-600 hover:bg-red-700 text-white">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </Card>
  );
}
