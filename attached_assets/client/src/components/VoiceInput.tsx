import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useVoice } from "@/hooks/useVoice";

const NON_FATAL_ERRORS = [
  "Inspelningen avbröts",
  "Inget tal upptäcktes",
];

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  lang?: string;
  className?: string;
}

export function VoiceInput({ onTranscript, lang = "sv-SE", className }: VoiceInputProps) {
  const { toast } = useToast();

  const handleResult = useCallback((transcript: string, isFinal: boolean) => {
    if (isFinal && transcript.trim()) {
      onTranscript(transcript.trim());
    }
  }, [onTranscript]);

  const handleError = useCallback((error: string) => {
    if (NON_FATAL_ERRORS.includes(error)) {
      return;
    }
    toast({
      title: "Röstinput fel",
      description: error,
      variant: "destructive",
    });
  }, [toast]);

  const {
    isListening,
    startListening,
    stopListening,
    isRecognitionSupported,
  } = useVoice({
    language: lang,
    continuous: true,
    onResult: handleResult,
    onError: handleError,
  });

  if (!isRecognitionSupported) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={className}
        onClick={() => {
          toast({
            title: "Röstinput stöds ej",
            description: "Röstinput stöds ej i denna webbläsare",
            variant: "destructive",
          });
        }}
        data-testid="button-voice-unsupported"
        aria-label="Röstinput stöds ej i denna webbläsare"
        title="Röstinput stöds ej i denna webbläsare"
      >
        <MicOff className="h-4 w-4 text-muted-foreground" />
      </Button>
    );
  }

  const label = isListening ? "Stoppa inspelning" : "Starta röstinput";

  return (
    <Button
      type="button"
      variant={isListening ? "destructive" : "outline"}
      size="icon"
      className={`${className || ""} ${isListening ? "animate-pulse" : ""}`}
      onClick={isListening ? stopListening : startListening}
      data-testid="button-voice-input"
      aria-label={label}
      title={label}
    >
      {isListening ? (
        <Square className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
