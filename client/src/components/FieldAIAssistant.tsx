import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Mic, MicOff, Volume2, VolumeX, Send, X, 
  Loader2, Bot, User, HelpCircle 
} from "lucide-react";
import { useVoice } from "@/hooks/useVoice";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  suggestedQuestions?: string[];
}

interface JobContext {
  jobTitle?: string;
  objectName?: string;
  objectAddress?: string;
  accessInfo?: {
    gateCode?: string;
    keyLocation?: string;
    parking?: string;
    specialInstructions?: string;
  };
}

interface FieldAIAssistantProps {
  jobContext?: JobContext;
  onClose?: () => void;
  isOpen: boolean;
}

export function FieldAIAssistant({ jobContext, onClose, isOpen }: FieldAIAssistantProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleVoiceResult = useCallback((transcript: string, isFinal: boolean) => {
    setInputText(transcript);
    if (isFinal && transcript.trim()) {
      handleSendMessage(transcript);
    }
  }, []);

  const handleVoiceError = useCallback((error: string) => {
    toast({
      title: "Röstfel",
      description: error,
      variant: "destructive",
    });
  }, [toast]);

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isRecognitionSupported,
    isSpeaking,
    speak,
    stopSpeaking,
    isSynthesisSupported,
  } = useVoice({
    language: "sv-SE",
    continuous: false,
    onResult: handleVoiceResult,
    onError: handleVoiceError,
  });

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Update input text while listening
  useEffect(() => {
    if (isListening) {
      setInputText(transcript);
    }
  }, [isListening, transcript]);

  const handleSendMessage = async (text?: string) => {
    const messageText = text || inputText.trim();
    if (!messageText || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText("");
    setIsLoading(true);
    setSuggestedQuestions([]);

    try {
      // Send conversation history for context
      const conversationHistory = newMessages.map(m => ({
        role: m.role,
        content: m.content
      }));
      
      const response = await apiRequest("POST", "/api/ai/field-assistant", {
        question: messageText,
        jobContext,
        conversationHistory,
      });

      const data = await response.json();
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        timestamp: new Date(),
        suggestedQuestions: data.suggestedQuestions,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      
      // Update suggested questions
      if (data.suggestedQuestions && data.suggestedQuestions.length > 0) {
        setSuggestedQuestions(data.suggestedQuestions);
      }

      // Speak the response if voice output is enabled
      if (voiceOutputEnabled && isSynthesisSupported && data.answer) {
        speak(data.answer);
      }
    } catch (error) {
      console.error("AI request failed:", error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Kunde inte svara just nu. Försök igen.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const toggleVoiceOutput = () => {
    if (isSpeaking) {
      stopSpeaking();
    }
    setVoiceOutputEnabled(!voiceOutputEnabled);
  };

  const quickQuestions = [
    "Hur gör jag om porten är låst?",
    "Vad gör jag vid problem?",
    "Hur rapporterar jag?",
  ];

  if (!isOpen) return null;

  return (
    <Card className="fixed inset-4 z-50 flex flex-col max-h-[calc(100vh-2rem)] bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-4 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="font-semibold">AI-Assistent</span>
          {isSpeaking && (
            <Badge variant="secondary" className="text-xs">
              Läser...
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isSynthesisSupported && (
            <Button
              size="icon"
              variant={voiceOutputEnabled ? "default" : "ghost"}
              onClick={toggleVoiceOutput}
              data-testid="button-toggle-voice-output"
            >
              {voiceOutputEnabled ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <VolumeX className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            data-testid="button-close-ai-assistant"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">Hej! Hur kan jag hjälpa dig?</p>
            <p className="text-sm mb-6">
              Ställ en fråga eller tryck på mikrofonen för att prata.
            </p>
            
            {/* Quick questions */}
            <div className="flex flex-col gap-2 max-w-xs mx-auto">
              {quickQuestions.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-left justify-start h-auto py-2 px-3 whitespace-normal"
                  onClick={() => {
                    setInputText(q);
                    handleSendMessage(q);
                  }}
                  data-testid={`button-quick-question-${i}`}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {message.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
              data-testid={`message-${message.role}-${message.id}`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            </div>
            {message.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="bg-muted rounded-lg px-4 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        {/* Suggested follow-up questions */}
        {!isLoading && suggestedQuestions.length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground mb-2">Föreslagna följdfrågor:</p>
            <div className="flex flex-col gap-2">
              {suggestedQuestions.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-left justify-start h-auto py-2 px-3 whitespace-normal"
                  onClick={() => {
                    handleSendMessage(q);
                  }}
                  data-testid={`button-suggested-question-${i}`}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          {isRecognitionSupported && (
            <Button
              size="mobile"
              variant={isListening ? "destructive" : "outline"}
              onClick={toggleVoiceInput}
              className="flex-shrink-0"
              data-testid="button-voice-input"
            >
              {isListening ? (
                <>
                  <MicOff className="h-5 w-5 mr-2" />
                  Stopp
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5 mr-2" />
                  Prata
                </>
              )}
            </Button>
          )}
          
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={isListening ? "Lyssnar..." : "Skriv din fråga..."}
            className="flex-1 min-h-14 px-4 text-lg border rounded-md bg-background"
            disabled={isLoading || isListening}
            data-testid="input-ai-question"
          />
          
          <Button
            size="mobile"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            className="flex-shrink-0"
            data-testid="button-send-ai-question"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>
        
        {isListening && (
          <p className="text-sm text-muted-foreground mt-2 text-center animate-pulse">
            Lyssnar... Tala nu
          </p>
        )}
      </div>
    </Card>
  );
}
