import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Send, Loader2, User, Truck, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface WorkOrderChatProps {
  workOrderId: string;
  workOrderTitle: string;
  portalFetch: (url: string, options?: RequestInit) => Promise<any>;
  trigger?: React.ReactNode;
}

export function WorkOrderChat({ workOrderId, workOrderTitle, portalFetch, trigger }: WorkOrderChatProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const chatQuery = useQuery({
    queryKey: ["/api/portal/work-order-chat", workOrderId],
    queryFn: () => portalFetch(`/api/portal/work-order-chat/${workOrderId}`),
    enabled: open,
    refetchInterval: open ? 10000 : false,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      return portalFetch(`/api/portal/work-order-chat/${workOrderId}`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/portal/work-order-chat", workOrderId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte skicka meddelande",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatQuery.data?.messages]);

  const messages = chatQuery.data?.messages || [];
  const workOrder = chatQuery.data?.workOrder;
  const resource = chatQuery.data?.resource;

  const handleSend = () => {
    if (message.trim()) {
      sendMutation.mutate();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" data-testid={`button-chat-${workOrderId}`}>
            <MessageCircle className="h-4 w-4 mr-1" />
            Chatt
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            {workOrderTitle}
          </DialogTitle>
          {workOrder && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {resource && (
                <Badge variant="outline">
                  <Truck className="h-3 w-3 mr-1" />
                  {resource.name}
                </Badge>
              )}
              {workOrder.scheduledDate && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {format(new Date(workOrder.scheduledDate), "d MMM", { locale: sv })}
                </span>
              )}
            </div>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
          <div className="space-y-4 py-4">
            {chatQuery.isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Inga meddelanden ännu</p>
                <p className="text-sm">Skriv ett meddelande för att kontakta teknikern</p>
              </div>
            ) : (
              messages.map((msg: any) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.senderType === "customer" ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${msg.id}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      msg.senderType === "customer"
                        ? "bg-primary text-primary-foreground"
                        : msg.senderType === "system"
                        ? "bg-muted border"
                        : "bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {msg.senderType === "customer" ? (
                        <User className="h-3 w-3" />
                      ) : msg.senderType === "system" ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : (
                        <Truck className="h-3 w-3" />
                      )}
                      <span className="text-xs font-medium">
                        {msg.senderType === "customer"
                          ? "Du"
                          : msg.senderType === "system"
                          ? "System"
                          : msg.senderName || "Tekniker"}
                      </span>
                      <span className="text-xs opacity-70">
                        {format(new Date(msg.createdAt), "HH:mm", { locale: sv })}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="flex gap-2 pt-4 border-t">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Skriv ett meddelande..."
            disabled={sendMutation.isPending}
            data-testid="input-chat-message"
          />
          <Button
            onClick={handleSend}
            disabled={sendMutation.isPending || !message.trim()}
            data-testid="button-send-message"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default WorkOrderChat;
