import { useState, useRef, useEffect } from 'react';
import { Platform, Animated, Linking } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import { triggerNotification, triggerImpact, NotificationFeedbackType, ImpactFeedbackStyle } from '../lib/haptics';
import { apiRequest } from '../lib/query-client';
import { openMapNavigation } from '../lib/navigation-links';
import type { Order } from '../types';
import type { QueryClient } from '@tanstack/react-query';

interface UseVoiceCommandsArgs {
  navigation: any;
  activeOrders: Order[];
  isOnline: boolean;
  queryClient: QueryClient;
}

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 1500;

export const HELP_TEXT = 'Tillg\u00e4ngliga kommandon: Visa jobb, Starta n\u00e4sta, P\u00e5 plats, Markera klar, Navigera dit, Ring kunden, Ta rast, Visa statistik, Rapportera avvikelse, Hj\u00e4lp.';

const OFFLINE_KEYWORDS: Record<string, { action: string; displayMessage: string }> = {
  'klar': { action: 'complete_order', displayMessage: 'Markerar uppdraget som klart.' },
  'f\u00e4rdig': { action: 'complete_order', displayMessage: 'Markerar uppdraget som klart.' },
  'n\u00e4sta': { action: 'start_next', displayMessage: '\u00d6ppnar n\u00e4sta uppdrag.' },
  'p\u00e5 plats': { action: 'on_site', displayMessage: 'Markerar som p\u00e5 plats.' },
  'framme': { action: 'on_site', displayMessage: 'Markerar som p\u00e5 plats.' },
  'avvikelse': { action: 'report_deviation', displayMessage: '\u00d6ppnar avvikelserapportering.' },
  'rast': { action: 'start_break', displayMessage: 'Tar rast.' },
  'paus': { action: 'start_break', displayMessage: 'Tar rast.' },
  'hj\u00e4lp': { action: 'help', displayMessage: HELP_TEXT },
  'statistik': { action: 'navigate_statistics', displayMessage: '\u00d6ppnar statistik.' },
  'jobb': { action: 'navigate_orders', displayMessage: 'Visar dina uppdrag.' },
  'ordrar': { action: 'navigate_orders', displayMessage: 'Visar dina uppdrag.' },
  'ring': { action: 'call_customer', displayMessage: 'Ringer kunden.' },
  'navigera': { action: 'navigate_to', displayMessage: '\u00d6ppnar navigation.' },
};

function matchOfflineKeyword(text: string): { action: string; displayMessage: string } | null {
  const lower = text.toLowerCase().trim();
  for (const [keyword, result] of Object.entries(OFFLINE_KEYWORDS)) {
    if (lower.includes(keyword)) return result;
  }
  return null;
}

function speakConfirmation(message: string) {
  if (Platform.OS === 'web') return;
  Speech.speak(message, { language: 'sv-SE', rate: 1.0 });
}

function triggerHaptic(type: 'start' | 'stop' | 'error') {
  if (Platform.OS === 'web') return;
  switch (type) {
    case 'start':
      triggerImpact(ImpactFeedbackStyle.Heavy);
      break;
    case 'stop':
      triggerImpact(ImpactFeedbackStyle.Light);
      break;
    case 'error':
      triggerNotification(NotificationFeedbackType.Error);
      break;
  }
}

export function useVoiceCommands({ navigation, activeOrders, isOnline, queryClient }: UseVoiceCommandsArgs) {
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [voiceOverlayVisible, setVoiceOverlayVisible] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState<string>('');
  const [voiceError, setVoiceError] = useState(false);
  const [offlineQuickActions, setOfflineQuickActions] = useState(false);
  const voiceRecorderRef = useRef<any>(null);
  const isStoppingVoiceRef = useRef(false);
  const voiceChunksRef = useRef<any[]>([]);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const silenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const overlayPulseAnim = useRef(new Animated.Value(1)).current;
  const localTranscriptRef = useRef<string>('');
  const speechRecognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (silenceCheckRef.current) clearInterval(silenceCheckRef.current);
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
      }
      overlayPulseAnim.stopAnimation();
      pulseAnim.stopAnimation();
    };
  }, []);

  function showVoiceFeedback(msg: string) {
    setVoiceFeedback(msg);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setVoiceFeedback(null), 3500);
  }

  function executeVoiceAction(action: string, displayMessage: string) {
    if (action !== 'help') {
      showVoiceFeedback(displayMessage);
      speakConfirmation(displayMessage);
    }
    switch (action) {
      case 'navigate_orders':
        navigation.navigate('OrdersTab');
        break;
      case 'start_next': {
        const next = activeOrders.find(o => !o.isLocked) || activeOrders[0];
        if (next) {
          navigation.navigate('OrderDetail', { orderId: next.id });
        } else {
          const msg = 'Inga aktiva uppdrag att starta.';
          showVoiceFeedback(msg);
          speakConfirmation(msg);
        }
        break;
      }
      case 'report_deviation': {
        const current = activeOrders.find(o => o.status === 'in_progress' || o.status === 'on_site') || activeOrders[0];
        if (current) {
          navigation.navigate('ReportDeviation', { orderId: current.id });
        } else {
          const msg = 'Inget aktivt uppdrag f\u00f6r avvikelse.';
          showVoiceFeedback(msg);
          speakConfirmation(msg);
        }
        break;
      }
      case 'on_site': {
        const onSiteOrder = activeOrders.find(o => o.status === 'dispatched' || o.status === 'planerad_resurs') || activeOrders[0];
        if (onSiteOrder) {
          apiRequest('POST', `/api/mobile/orders/${onSiteOrder.id}/status`, { status: 'on_site' })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
              const msg = `P\u00e5 plats markerat f\u00f6r ${onSiteOrder.customerName}`;
              showVoiceFeedback(msg);
              speakConfirmation(msg);
            })
            .catch(() => {
              const msg = 'Kunde inte uppdatera status.';
              showVoiceFeedback(msg);
              speakConfirmation(msg);
            });
        } else {
          const msg = 'Inget uppdrag att markera som p\u00e5 plats.';
          showVoiceFeedback(msg);
          speakConfirmation(msg);
        }
        break;
      }
      case 'complete_order': {
        const currentOrder = activeOrders.find(o => o.status === 'in_progress' || o.status === 'on_site') || activeOrders[0];
        if (currentOrder) {
          apiRequest('POST', `/api/mobile/orders/${currentOrder.id}/status`, { status: 'completed' })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
              queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
              const msg = `Uppdrag ${currentOrder.orderNumber} markerat som klart.`;
              showVoiceFeedback(msg);
              speakConfirmation(msg);
            })
            .catch(() => {
              const msg = 'Kunde inte markera uppdraget som klart.';
              showVoiceFeedback(msg);
              speakConfirmation(msg);
            });
        } else {
          const msg = 'Inget aktivt uppdrag att markera som klart.';
          showVoiceFeedback(msg);
          speakConfirmation(msg);
        }
        break;
      }
      case 'navigate_to': {
        const navOrder = activeOrders.find(o => o.status === 'dispatched' || o.status === 'planerad_resurs' || o.status === 'on_site') || activeOrders[0];
        if (navOrder && navOrder.latitude && navOrder.longitude) {
          openMapNavigation(navOrder.latitude, navOrder.longitude, navOrder.address);
          const msg = `Navigerar till ${navOrder.address}.`;
          showVoiceFeedback(msg);
          speakConfirmation(msg);
        } else {
          const msg = 'Inget uppdrag att navigera till.';
          showVoiceFeedback(msg);
          speakConfirmation(msg);
        }
        break;
      }
      case 'call_customer': {
        const callOrder = activeOrders.find(o => o.status === 'in_progress' || o.status === 'on_site' || o.status === 'dispatched') || activeOrders[0];
        if (callOrder && callOrder.contacts && callOrder.contacts.length > 0) {
          const phone = callOrder.contacts[0].phone;
          if (phone) {
            Linking.openURL(`tel:${phone}`).catch(() => {});
            const msg = `Ringer ${callOrder.contacts[0].name || 'kunden'}.`;
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          } else {
            const msg = 'Inget telefonnummer tillg\u00e4ngligt.';
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          }
        } else {
          const msg = 'Ingen kontakt att ringa.';
          showVoiceFeedback(msg);
          speakConfirmation(msg);
        }
        break;
      }
      case 'start_break': {
        const msg = 'Rast startad. Vila dig!';
        showVoiceFeedback(msg);
        speakConfirmation(msg);
        break;
      }
      case 'navigate_statistics':
        navigation.navigate('Statistics');
        break;
      case 'help':
        speakConfirmation(HELP_TEXT);
        showVoiceFeedback(HELP_TEXT);
        break;
      default:
        handleUnknownCommand();
        break;
    }
  }

  function retryVoiceCommand() {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setVoiceError(false);
    setVoiceOverlayVisible(false);
    setTimeout(() => {
      startVoiceRecording();
    }, 300);
  }

  async function handleVoiceCommand() {
    if (voiceRecording) {
      stopVoiceRecording();
      return;
    }
    startVoiceRecording();
  }

  function startPulseAnimation() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }

  function startOverlayPulseAnimation() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(overlayPulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(overlayPulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }

  function stopPulseAnimation() {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
    overlayPulseAnim.stopAnimation();
    overlayPulseAnim.setValue(1);
  }

  function startLocalSpeechRecognition() {
    if (Platform.OS !== 'web') return;
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) return;
      const recognition = new SpeechRecognition();
      recognition.lang = 'sv-SE';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        localTranscriptRef.current = transcript;
        setVoiceTranscript(transcript);
      };
      recognition.onerror = () => {};
      recognition.onend = () => {};
      recognition.start();
      speechRecognitionRef.current = recognition;
    } catch {}
  }

  function stopLocalSpeechRecognition() {
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }
  }

  function startSilenceDetectionWeb(stream: MediaStream) {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      let silenceStart: number | null = null;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      silenceCheckRef.current = setInterval(() => {
        if (isStoppingVoiceRef.current || !voiceRecorderRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length / 255;

        if (avg < SILENCE_THRESHOLD) {
          if (!silenceStart) silenceStart = Date.now();
          if (Date.now() - silenceStart >= SILENCE_DURATION_MS) {
            stopVoiceRecording();
          }
        } else {
          silenceStart = null;
        }
      }, 100);
    } catch {
    }
  }

  function stopSilenceDetection() {
    if (silenceCheckRef.current) {
      clearInterval(silenceCheckRef.current);
      silenceCheckRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  async function startVoiceRecording() {
    if (voiceRecording || isStoppingVoiceRef.current) return;
    setVoiceError(false);
    setVoiceTranscript('');
    localTranscriptRef.current = '';

    setVoiceOverlayVisible(true);
    triggerHaptic('start');
    startOverlayPulseAnimation();

    if (Platform.OS === 'web') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        voiceChunksRef.current = [];
        mediaRecorder.ondataavailable = (e: any) => {
          if (e.data.size > 0) voiceChunksRef.current.push(e.data);
        };
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          stopSilenceDetection();
          const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm;codecs=opus' });
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1];
            processVoiceAudio(base64);
          };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        voiceRecorderRef.current = mediaRecorder;
        setVoiceRecording(true);
        startPulseAnimation();
        startSilenceDetectionWeb(stream);
        startLocalSpeechRecognition();
      } catch {
        stopPulseAnimation();
        showVoiceFeedback('Kunde inte starta mikrofonen.');
        setVoiceOverlayVisible(false);
      }
    } else {
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          stopPulseAnimation();
          showVoiceFeedback('Mikrofontillst\u00e5nd kr\u00e4vs.');
          setVoiceOverlayVisible(false);
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync({
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        });
        voiceRecorderRef.current = recording;
        setVoiceRecording(true);
        startPulseAnimation();

        let nativeSilenceStart: number | null = null;
        const NATIVE_SILENCE_DB = -60;
        const recordingStartedAt = Date.now();
        const MIN_RECORDING_MS = 2000;
        silenceCheckRef.current = setInterval(async () => {
          try {
            if (isStoppingVoiceRef.current || !voiceRecorderRef.current) return;
            if (Date.now() - recordingStartedAt < MIN_RECORDING_MS) return;
            const status = await recording.getStatusAsync();
            if (isStoppingVoiceRef.current) return;
            if (status.isRecording && status.metering !== undefined) {
              if (status.metering < NATIVE_SILENCE_DB) {
                if (!nativeSilenceStart) nativeSilenceStart = Date.now();
                if (Date.now() - nativeSilenceStart >= SILENCE_DURATION_MS) {
                  stopVoiceRecording();
                }
              } else {
                nativeSilenceStart = null;
              }
            }
          } catch {}
        }, 200);

        silenceTimerRef.current = setTimeout(() => {
          if (voiceRecorderRef.current && !isStoppingVoiceRef.current) {
            stopVoiceRecording();
          }
        }, 15000);
      } catch (err: any) {
        console.error('Voice recording error:', err);
        showVoiceFeedback('Kunde inte starta inspelning.');
        setVoiceOverlayVisible(false);
      }
    }
  }

  async function stopVoiceRecording() {
    if (isStoppingVoiceRef.current) return;
    isStoppingVoiceRef.current = true;

    setVoiceRecording(false);
    stopPulseAnimation();
    stopSilenceDetection();
    stopLocalSpeechRecognition();
    triggerHaptic('stop');

    try {
      if (Platform.OS === 'web') {
        const recorder = voiceRecorderRef.current;
        voiceRecorderRef.current = null;
        if (recorder && recorder.state === 'recording') {
          recorder.stop();
        }
      } else {
        const recording = voiceRecorderRef.current;
        voiceRecorderRef.current = null;
        if (recording) {
          try {
            await recording.stopAndUnloadAsync();
          } catch {
            setVoiceOverlayVisible(false);
            return;
          }
          const uri = recording.getURI();
          if (uri) {
            try {
              const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as const });
              processVoiceAudio(base64);
            } catch {
              setVoiceOverlayVisible(false);
            }
          } else {
            setVoiceOverlayVisible(false);
          }
        }
      }
    } catch {
      setVoiceOverlayVisible(false);
    } finally {
      isStoppingVoiceRef.current = false;
    }
  }

  function handleUnknownCommand() {
    setVoiceOverlayVisible(true);
    setVoiceError(true);
    triggerHaptic('error');
    const msg = 'Kommandot k\u00e4ndes inte igen.';
    showVoiceFeedback(msg);
    speakConfirmation(msg + ' F\u00f6rs\u00f6k igen.');
    silenceTimerRef.current = setTimeout(() => {
      setVoiceError(false);
      setVoiceOverlayVisible(false);
      startVoiceRecording();
    }, 1500);
  }

  function tryLocalKeywordMatch(spokenText: string): boolean {
    const match = matchOfflineKeyword(spokenText);
    if (match) {
      setVoiceOverlayVisible(false);
      executeVoiceAction(match.action, match.displayMessage);
      return true;
    }
    return false;
  }

  async function processVoiceAudio(base64: string) {
    setVoiceProcessing(true);
    setVoiceTranscript('Bearbetar...');

    const localText = localTranscriptRef.current;
    localTranscriptRef.current = '';

    if (localText) {
      setVoiceTranscript(localText);
      const quickMatch = matchOfflineKeyword(localText);
      if (quickMatch) {
        setVoiceOverlayVisible(false);
        executeVoiceAction(quickMatch.action, quickMatch.displayMessage);
        setVoiceProcessing(false);
        return;
      }
    }

    const networkAvailable = Platform.OS === 'web'
      ? navigator.onLine !== false
      : isOnline;

    if (!networkAvailable) {
      setOfflineQuickActions(true);
      setVoiceOverlayVisible(true);
      setVoiceTranscript('Offline \u2013 v\u00e4lj kommando:');
      triggerHaptic('error');
      speakConfirmation('Ingen n\u00e4tanslutning. V\u00e4lj ett snabbkommando.');
      setVoiceProcessing(false);
      return;
    }

    try {
      const result = await apiRequest('POST', '/api/mobile/ai/voice-command', { audio: base64 });
      const transcript = result.transcript || '';
      setVoiceTranscript(transcript);
      setVoiceOverlayVisible(false);
      if (result.action === 'unknown') {
        if (!tryLocalKeywordMatch(transcript)) {
          handleUnknownCommand();
        }
      } else {
        executeVoiceAction(result.action, result.displayMessage);
      }
    } catch {
      try {
        const transcribeResult = await apiRequest('POST', '/api/mobile/ai/transcribe', { audio: base64 });
        const transcript = transcribeResult.text || '';
        setVoiceTranscript(transcript);
        if (transcript && tryLocalKeywordMatch(transcript)) {
          return;
        }
        handleUnknownCommand();
      } catch {
        handleUnknownCommand();
      }
    } finally {
      setVoiceProcessing(false);
    }
  }

  return {
    voiceRecording,
    voiceProcessing,
    voiceFeedback,
    voiceOverlayVisible,
    voiceTranscript,
    voiceError,
    offlineQuickActions,
    pulseAnim,
    overlayPulseAnim,
    handleVoiceCommand,
    stopVoiceRecording,
    retryVoiceCommand,
    executeVoiceAction,
    setVoiceOverlayVisible,
    setVoiceError,
    setOfflineQuickActions,
    silenceTimerRef,
    HELP_TEXT,
  };
}
