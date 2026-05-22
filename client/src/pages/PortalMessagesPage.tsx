import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Send, ArrowLeft, Mail, Clock, User } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest } from "@/lib/queryClient";

interface CustomerConversation {
  customerId: string;
  customerName: string;
  customerEmail?: string;
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: string | null;
  messageCount: number;
}

interface Message {
  id: string;
  message: string;
  sender: "customer" | "staff";
  createdAt: string;
  readAt: string | null;
}

interface CustomerMessages {
  customer: {
    id: string;
    name: string;
    email?: string;
  };
  messages: Message[];
}

export default function PortalMessagesPage() {
  const queryClient = useQueryClient();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");

  const conversationsQuery = useQuery<CustomerConversation[]>({
    queryKey: ["/api/staff/portal-messages"],
  });

  const messagesQuery = useQuery<CustomerMessages>({
    queryKey: ["/api/staff/portal-messages", selectedCustomerId],
    enabled: !!selectedCustomerId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      return apiRequest("POST", `/api/staff/portal-messages/${selectedCustomerId}`, { message });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff/portal-messages", selectedCustomerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff/portal-messages"] });
      setNewMessage("");
    },
  });

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate(newMessage.trim());
  };

  const conversations = conversationsQuery.data || [];

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center gap-4">
        <MessageCircle className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Kundmeddelanden</h1>
          <p className="text-muted-foreground">Hantera meddelanden från kundportalen</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Konversationer
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              {conversationsQuery.isLoading ? (
                <div className="p-4 text-center text-muted-foreground">Laddar...</div>
              ) : conversations.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Inga meddelanden ännu</p>
                </div>
              ) : (
                <div className="divide-y">
                  {conversations.map((conv) => (
                    <button
                      key={conv.customerId}
                      onClick={() => setSelectedCustomerId(conv.customerId)}
                      className={`w-full p-4 text-left hover-elevate transition-colors ${
                        selectedCustomerId === conv.customerId ? "bg-accent" : ""
                      }`}
                      data-testid={`conversation-${conv.customerId}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{conv.customerName}</span>
                            {conv.unreadCount > 0 && (
                              <Badge variant="default" className="text-xs">
                                {conv.unreadCount}
                              </Badge>
                            )}
                          </div>
                          {conv.customerEmail && (
                            <p className="text-xs text-muted-foreground truncate">{conv.customerEmail}</p>
                          )}
                          <p className="text-sm text-muted-foreground truncate mt-1">{conv.lastMessage}</p>
                        </div>
                        {conv.lastMessageAt && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(conv.lastMessageAt), "d MMM", { locale: sv })}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            {selectedCustomerId && messagesQuery.data?.customer ? (
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedCustomerId(null)}
                  className="lg:hidden"
                  data-testid="button-back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{messagesQuery.data.customer.name}</CardTitle>
                    {messagesQuery.data.customer.email && (
                      <p className="text-sm text-muted-foreground">{messagesQuery.data.customer.email}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <CardTitle className="text-lg">Välj en konversation</CardTitle>
            )}
          </CardHeader>
          <CardContent className="p-0 flex flex-col h-[600px]">
            {!selectedCustomerId ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Välj en kund från listan för att se konversationen</p>
                </div>
              </div>
            ) : messagesQuery.isLoading ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Laddar meddelanden...
              </div>
            ) : (
              <>
                <ScrollArea className="flex-1 p-4" data-testid="staff-messages">
                  <div className="space-y-4">
                    {(messagesQuery.data?.messages || []).map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.sender === "staff" ? "justify-end" : "justify-start"}`}
                        data-testid={`staff-message-${msg.id}`}
                      >
                        <div
                          className={`max-w-[80%] p-3 rounded-lg ${
                            msg.sender === "staff"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <p className="text-sm">{msg.message}</p>
                          <div className={`flex items-center gap-1 mt-1 text-xs ${
                            msg.sender === "staff" ? "text-primary-foreground/70" : "text-muted-foreground"
                          }`}>
                            <Clock className="h-3 w-3" />
                            {format(new Date(msg.createdAt), "d MMM HH:mm", { locale: sv })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="p-4 border-t">
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <Input
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Skriv ett svar..."
                      className="flex-1"
                      disabled={sendMessageMutation.isPending}
                      data-testid="input-staff-message"
                    />
                    <Button
                      type="submit"
                      disabled={sendMessageMutation.isPending || !newMessage.trim()}
                      data-testid="button-send-staff-message"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Skicka
                    </Button>
                  </form>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
