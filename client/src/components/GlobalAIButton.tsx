import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sparkles, X, Loader2, Send, Lightbulb, Zap, BarChart3 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { ScrollArea } from "@/components/ui/scroll-area";

const pagesWithDedicatedAI = [
  "/",
  "/planner",
  "/week-planner",
  "/clusters",
  "/order-stock",
  "/dashboard",
  "/objects",
  "/resources",
  "/routes",
];

interface ModuleInfo {
  name: string;
  description: string;
  capabilities: string[];
}

const moduleInfo: Record<string, ModuleInfo> = {
  "/economics": {
    name: "Ekonomi",
    description: "Ekonomisk analys och kostnadsoptimering",
    capabilities: [
      "Analysera intäkter vs kostnader",
      "Identifiera kostnadsdrivare",
      "Föreslå kostnadsbesparingar",
    ],
  },
  "/vehicles": {
    name: "Fordon",
    description: "Fordonshantering och underhåll",
    capabilities: [
      "Förutse underhållsbehov",
      "Optimera fordonsallokering",
      "Analysera bränslekostnader",
    ],
  },
  "/weather": {
    name: "Väder",
    description: "Väderbaserad planering",
    capabilities: [
      "Anpassa kapacitet efter väder",
      "Prognostisera arbetsförhållanden",
      "Optimera schemaläggning",
    ],
  },
  "/optimization": {
    name: "Optimering",
    description: "Ruttoptimering och effektivisering",
    capabilities: [
      "Beräkna optimala rutter",
      "Minimera körsträckor",
      "Minska bränsleförbrukning",
    ],
  },
  "/subscriptions": {
    name: "Abonnemang",
    description: "Abonnemangshantering",
    capabilities: [
      "Analysera servicemönster",
      "Föreslå frekvensoptimering",
      "Identifiera avvikelser",
    ],
  },
  "/articles": {
    name: "Artiklar",
    description: "Artikelhantering",
    capabilities: [
      "Analysera artikelanvändning",
      "Optimera prissättning",
      "Identifiera trender",
    ],
  },
  "/import": {
    name: "Import",
    description: "Dataimport och validering",
    capabilities: [
      "Validera importdata",
      "Identifiera dupliceringar",
      "Föreslå datamappning",
    ],
  },
};

function getModuleInfo(path: string): ModuleInfo {
  for (const [key, info] of Object.entries(moduleInfo)) {
    if (path === key || path.startsWith(key + "/")) {
      return info;
    }
  }
  return {
    name: "Modul",
    description: "AI-assisterad funktionalitet",
    capabilities: [
      "Analysera data",
      "Ge rekommendationer",
      "Optimera arbetsflöden",
    ],
  };
}

interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export function GlobalAIButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");

  const hasDedicatedAI = pagesWithDedicatedAI.some(path => 
    location === path || (path !== "/" && location.startsWith(path + "/"))
  );

  const currentModule = getModuleInfo(location);

  const chatMutation = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiRequest("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          question,
          context: {
            module: currentModule.name,
            path: location,
          },
        }),
      });
      return response.answer || response.message || "Jag kan inte svara på det just nu.";
    },
    onSuccess: (answer) => {
      setMessages(prev => [...prev, { role: "assistant", content: answer }]);
    },
    onError: () => {
      setMessages(prev => [...prev, { 
        role: "assistant", 
        content: "Tyvärr kunde jag inte behandla din fråga. Försök igen." 
      }]);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || chatMutation.isPending) return;
    
    const question = input.trim();
    setMessages(prev => [...prev, { role: "user", content: question }]);
    setInput("");
    chatMutation.mutate(question);
  };

  if (hasDedicatedAI) {
    return null;
  }

  if (!isOpen) {
    return (
      <Button
        className="fixed bottom-6 right-6 shadow-lg z-50 gap-2"
        onClick={() => setIsOpen(true)}
        data-testid="button-global-ai"
      >
        <Sparkles className="h-4 w-4" />
        AI
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-6 right-6 z-50 w-96 shadow-2xl border-purple-500/20 flex flex-col max-h-[500px]">
      <CardHeader className="pb-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-purple-500" />
            AI Assistent - {currentModule.name}
          </CardTitle>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsOpen(false)}
            data-testid="button-close-ai"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{currentModule.description}</p>
      </CardHeader>
      
      <CardContent className="flex-1 min-h-0 p-3">
        <ScrollArea className="h-full">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground mb-3">
                AI-kapacitet för denna modul:
              </p>
              {currentModule.capabilities.map((cap, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                  {i === 0 && <Lightbulb className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />}
                  {i === 1 && <Zap className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />}
                  {i === 2 && <BarChart3 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />}
                  <p className="text-xs">{cap}</p>
                </div>
              ))}
              <p className="text-xs text-muted-foreground text-center mt-4">
                Ställ en fråga för att komma igång
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-2 rounded-md text-sm ${
                    msg.role === "user"
                      ? "bg-primary/10 ml-4"
                      : "bg-muted/50 mr-4"
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              {chatMutation.isPending && (
                <div className="flex items-center gap-2 p-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs text-muted-foreground">Tänker...</span>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
      
      <CardFooter className="shrink-0 p-3 pt-0">
        <form onSubmit={handleSubmit} className="flex gap-2 w-full">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ställ en fråga..."
            className="flex-1"
            disabled={chatMutation.isPending}
            data-testid="input-ai-question"
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={chatMutation.isPending || !input.trim()}
            data-testid="button-send-ai"
          >
            {chatMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
