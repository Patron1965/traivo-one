import { useRef, useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Send, Loader2, Sparkles, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  SYSTEM_OVERVIEW_AREAS,
  SYSTEM_OVERVIEW_ROLES,
  SYSTEM_OVERVIEW_INTRO,
  type SystemOverviewArea,
} from "@shared/system-overview-content";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function SystemGuidePage() {
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const { toast } = useToast();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const chatMutation = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiRequest("POST", "/api/ai/system-overview-chat", {
        question,
        conversationHistory: chatHistory.slice(-10),
      });
      return response.json();
    },
    onSuccess: (data: { answer: string }) => {
      setChatHistory((prev) => [...prev, { role: "assistant", content: data.answer }]);
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte skicka frågan",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatMutation.isPending]);

  const sendQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || chatMutation.isPending) return;
    setChatHistory((prev) => [...prev, { role: "user", content: trimmed }]);
    chatMutation.mutate(trimmed);
    setChatMessage("");
  };

  const fillSuggestedQuestion = (area: SystemOverviewArea) => {
    setChatMessage(area.suggestedQuestion);
    chatInputRef.current?.focus();
    chatInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="container py-6 space-y-6">
      <PageHeader
        icon={BookOpen}
        title="Systemöversikt"
        description={SYSTEM_OVERVIEW_INTRO}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          {SYSTEM_OVERVIEW_AREAS.map((area, idx) => (
            <Card key={area.key} data-testid={`card-area-${area.key}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <span aria-hidden>{area.icon}</span>
                    {area.title}
                    <Badge variant="outline" className="ml-1 text-xs font-normal">
                      {idx + 1} / {SYSTEM_OVERVIEW_AREAS.length}
                    </Badge>
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => fillSuggestedQuestion(area)}
                    data-testid={`button-ask-${area.key}`}
                  >
                    <Sparkles className="h-4 w-4 mr-1" />
                    Fråga AI
                  </Button>
                </div>
                <CardDescription className="text-primary font-medium">
                  {area.tagline}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {area.functions.map((fn) => (
                  <div
                    key={fn.title}
                    className="rounded-md border-l-4 border-primary/60 bg-muted/40 p-3"
                  >
                    <p className="font-medium text-sm">{fn.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">{fn.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <Card data-testid="card-roles">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Nästa steg: rollbaserad utbildning</CardTitle>
              <CardDescription className="text-primary font-medium">
                Samma system — olika vardag. Utbildningen fördjupas per roll.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {SYSTEM_OVERVIEW_ROLES.map((role) => (
                <div key={role.title} className="rounded-md border bg-muted/40 p-3">
                  <p className="font-medium text-sm">{role.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{role.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="flex flex-col h-[70vh] min-h-[480px]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5 text-primary" />
                Fråga om systemet
              </CardTitle>
              <CardDescription>
                Ställ en fråga som "Vad innebär detta för vår verksamhet?" — svaren utgår från
                systemöversikten.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-auto p-3 bg-muted/30 rounded-md mb-3 space-y-3">
                {chatHistory.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Klicka på "Fråga AI" vid ett område eller skriv en egen fråga.</p>
                    <p className="text-xs mt-1">Exempel: "Vad innebär orderkoncept för vår verksamhet?"</p>
                  </div>
                ) : (
                  chatHistory.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      data-testid={`chat-message-${idx}`}
                    >
                      <div
                        className={`max-w-[85%] p-3 rounded-lg ${
                          msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))
                )}
                {chatMutation.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-muted p-3 rounded-lg">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2">
                <Textarea
                  ref={chatInputRef}
                  placeholder="Skriv din fråga här..."
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendQuestion(chatMessage);
                    }
                  }}
                  className="flex-1"
                  rows={2}
                  data-testid="input-system-guide-chat"
                />
                <Button
                  onClick={() => sendQuestion(chatMessage)}
                  disabled={!chatMessage.trim() || chatMutation.isPending}
                  data-testid="button-send-system-guide-chat"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
