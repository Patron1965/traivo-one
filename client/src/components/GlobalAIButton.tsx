import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, X, Loader2, Send } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
      const response = await apiRequest("POST", "/api/ai/chat", {
        question,
        context: {
          module: currentModule.name,
          path: location,
        },
      }) as { answer?: string; message?: string };
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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-testid="button-global-ai"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-0" 
        align="end"
        sideOffset={8}
      >
        <div className="flex flex-col h-96">
          <div className="flex items-center justify-between gap-2 p-3 border-b">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">AI Assistent</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
              data-testid="button-close-ai-chat"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <ScrollArea className="flex-1 p-3">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {currentModule.description}
                </p>
                <div className="space-y-2">
                  <p className="text-xs font-medium">Exempelfrågor:</p>
                  {currentModule.capabilities.map((cap, i) => (
                    <button
                      key={i}
                      className="block w-full text-left text-xs p-2 rounded-md bg-muted/50 hover-elevate"
                      onClick={() => {
                        setMessages([{ role: "user", content: cap }]);
                        chatMutation.mutate(cap);
                      }}
                      data-testid={`button-ai-suggestion-${i}`}
                    >
                      {cap}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-xs p-2 rounded-md ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-4"
                        : "bg-muted mr-4"
                    }`}
                    data-testid={`text-ai-message-${i}`}
                  >
                    {msg.content}
                  </div>
                ))}
                {chatMutation.isPending && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analyserar...
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <form onSubmit={handleSubmit} className="p-3 border-t">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ställ en fråga..."
                className="text-xs h-8"
                disabled={chatMutation.isPending}
                data-testid="input-ai-question"
              />
              <Button
                type="submit"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={chatMutation.isPending || !input.trim()}
                data-testid="button-send-ai-question"
              >
                <Send className="h-3 w-3" />
              </Button>
            </div>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
}
