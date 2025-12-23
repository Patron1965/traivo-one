import { useState, useCallback, useRef, useEffect } from "react";

export interface UseVoiceOptions {
  language?: string;
  continuous?: boolean;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

export interface UseVoiceReturn {
  // Speech recognition (voice input)
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  isRecognitionSupported: boolean;
  
  // Speech synthesis (voice output)
  isSpeaking: boolean;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  isSynthesisSupported: boolean;
}

// Internal types for Web Speech API (browser implementations vary)
interface WebSpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface WebSpeechRecognitionResultList {
  length: number;
  [index: number]: WebSpeechRecognitionResult;
}

interface WebSpeechRecognitionEvent {
  resultIndex: number;
  results: WebSpeechRecognitionResultList;
}

interface WebSpeechRecognitionErrorEvent {
  error: string;
}

interface WebSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

// Get SpeechRecognition constructor (handles vendor prefixes)
function getSpeechRecognition(): (new () => WebSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const {
    language = "sv-SE", // Swedish by default
    continuous = false,
    onResult,
    onError,
  } = options;

  // Speech recognition state
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<WebSpeechRecognition | null>(null);

  // Speech synthesis state
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Check browser support
  const isRecognitionSupported = getSpeechRecognition() !== null;
  
  const isSynthesisSupported = typeof window !== "undefined" && 
    "speechSynthesis" in window;

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: WebSpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      const currentTranscript = finalTranscript || interimTranscript;
      setTranscript(currentTranscript);
      
      if (onResult) {
        onResult(currentTranscript, !!finalTranscript);
      }
    };

    recognition.onerror = (event: WebSpeechRecognitionErrorEvent) => {
      console.error("[Voice] Recognition error:", event.error);
      setIsListening(false);
      
      if (onError) {
        const errorMessages: Record<string, string> = {
          "no-speech": "Inget tal upptäcktes",
          "audio-capture": "Ingen mikrofon hittades",
          "not-allowed": "Mikrofonåtkomst nekad",
          "network": "Nätverksfel",
          "aborted": "Inspelningen avbröts",
          "language-not-supported": "Språket stöds inte",
        };
        onError(errorMessages[event.error] || `Fel: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [language, continuous, onResult, onError]);

  // Start listening
  const startListening = useCallback(() => {
    if (!isRecognitionSupported || !recognitionRef.current) {
      onError?.("Röstinspelning stöds inte i denna webbläsare");
      return;
    }

    setTranscript("");
    try {
      recognitionRef.current.start();
    } catch (error) {
      console.error("[Voice] Failed to start recognition:", error);
    }
  }, [isRecognitionSupported, onError]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
  }, [isListening]);

  // Speak text
  const speak = useCallback((text: string) => {
    if (!isSynthesisSupported) {
      console.warn("[Voice] Speech synthesis not supported");
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to find a Swedish voice
    const voices = window.speechSynthesis.getVoices();
    const swedishVoice = voices.find(
      (voice) => voice.lang.startsWith("sv") || voice.lang.includes("Swedish")
    );
    if (swedishVoice) {
      utterance.voice = swedishVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
    };

    utterance.onerror = (event) => {
      console.error("[Voice] Speech synthesis error:", event);
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  }, [language, isSynthesisSupported]);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if (isSynthesisSupported) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [isSynthesisSupported]);

  return {
    // Speech recognition
    isListening,
    transcript,
    startListening,
    stopListening,
    isRecognitionSupported,
    
    // Speech synthesis
    isSpeaking,
    speak,
    stopSpeaking,
    isSynthesisSupported,
  };
}
