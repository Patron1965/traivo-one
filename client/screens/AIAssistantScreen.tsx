import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, FlatList, Pressable, StyleSheet, TextInput,
  ActivityIndicator, Platform, Animated,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest, getApiUrl } from '../lib/query-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Order } from '../types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hej! Jag är Nordfield Assist, din AI-assistent. Vad kan jag hjälpa dig med?',
  timestamp: new Date(),
};

const QUICK_ACTIONS = [
  { id: 'tasks', icon: 'clipboard' as const, label: 'Mina uppdrag', color: Colors.primary, message: 'Kan du ge mig en sammanfattning av mina uppdrag idag?' },
  { id: 'route', icon: 'navigation' as const, label: 'Rutt', color: Colors.secondary, message: 'Vilken ordning ska jag köra mina uppdrag idag?' },
  { id: 'deviation', icon: 'alert-triangle' as const, label: 'Avvikelse', color: Colors.warning, message: 'Hur rapporterar jag en avvikelse?' },
  { id: 'next', icon: 'skip-forward' as const, label: 'Nästa steg', color: Colors.info, message: 'Vad är mitt nästa steg just nu?' },
  { id: 'help', icon: 'help-circle' as const, label: 'Hjälp', color: Colors.textSecondary, message: 'Vad kan du hjälpa mig med?' },
];

function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ])
      );
    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={styles.typingContainer}>
      <Animated.View style={[styles.typingDot, { opacity: dot1 }]} />
      <Animated.View style={[styles.typingDot, { opacity: dot2 }]} />
      <Animated.View style={[styles.typingDot, { opacity: dot3 }]} />
    </View>
  );
}

function SuggestionCards({ onSend }: { onSend: (text: string) => void }) {
  return (
    <View style={styles.suggestionsContainer}>
      <View style={styles.suggestionsGrid}>
        <Pressable style={styles.suggestionCard} onPress={() => onSend('Sammanfatta mina uppdrag idag')}>
          <Feather name="sun" size={20} color={Colors.warning} />
          <ThemedText variant="caption" style={styles.suggestionTitle}>Dagens sammanfattning</ThemedText>
          <ThemedText variant="caption" color={Colors.textMuted} style={styles.suggestionDesc}>Se status på alla uppdrag</ThemedText>
        </Pressable>
        <Pressable style={styles.suggestionCard} onPress={() => onSend('Vilken ordning ska jag köra mina stopp?')}>
          <Feather name="map" size={20} color={Colors.secondary} />
          <ThemedText variant="caption" style={styles.suggestionTitle}>Optimera rutt</ThemedText>
          <ThemedText variant="caption" color={Colors.textMuted} style={styles.suggestionDesc}>Få den bästa körordningen</ThemedText>
        </Pressable>
        <Pressable style={styles.suggestionCard} onPress={() => onSend('Hur rapporterar jag en avvikelse?')}>
          <Feather name="alert-circle" size={20} color={Colors.danger} />
          <ThemedText variant="caption" style={styles.suggestionTitle}>Rapportera problem</ThemedText>
          <ThemedText variant="caption" color={Colors.textMuted} style={styles.suggestionDesc}>Hjälp med avvikelser</ThemedText>
        </Pressable>
        <Pressable style={styles.suggestionCard} onPress={() => onSend('Vad kan du hjälpa mig med?')}>
          <Feather name="zap" size={20} color={Colors.primary} />
          <ThemedText variant="caption" style={styles.suggestionTitle}>Visa funktioner</ThemedText>
          <ThemedText variant="caption" color={Colors.textMuted} style={styles.suggestionDesc}>Vad kan Nordfield Assist?</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const MessageBubble = React.memo(function MessageBubble({ msg, index, formatTime, isStreamingMsg }: { msg: Message; index: number; formatTime: (date: Date) => string; isStreamingMsg?: boolean }) {
  const showTypingDots = isStreamingMsg && msg.content.length === 0;
  const showCursor = isStreamingMsg && msg.content.length > 0;

  return (
    <View
      style={[
        styles.messageBubbleRow,
        msg.role === 'user' ? styles.userRow : styles.assistantRow,
      ]}
    >
      {msg.role === 'assistant' ? (
        <View style={styles.avatarContainer}>
          <Feather name="zap" size={14} color="#fff" />
        </View>
      ) : null}
      <View
        style={[
          styles.messageBubble,
          msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        {showTypingDots ? (
          <TypingIndicator />
        ) : (
          <ThemedText
            variant="body"
            color={msg.role === 'user' ? Colors.textInverse : Colors.text}
            testID={`text-ai-message-${index}`}
            style={styles.messageText}
          >
            {msg.content}
            {showCursor ? <ThemedText variant="body" color={Colors.textMuted}>▊</ThemedText> : null}
          </ThemedText>
        )}
        {!showTypingDots ? (
          <ThemedText
            variant="caption"
            color={msg.role === 'user' ? 'rgba(255,255,255,0.7)' : Colors.textMuted}
            style={styles.timestamp}
          >
            {formatTime(msg.timestamp)}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
});

export function AIAssistantScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const flatListRef = useRef<FlatList>(null);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<any[]>([]);

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const isOnlyWelcome = messages.length === 1 && messages[0].id === 'welcome';

  const formatTime = useCallback((date: Date): string => {
    return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }, []);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    const aiMsgId = (Date.now() + 1).toString();
    const placeholderMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg, placeholderMsg]);
    setInputText('');
    setIsLoading(true);
    setStreamingMsgId(aiMsgId);

    const context = orders
      ? orders.map(o => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          status: o.status,
          address: o.address,
          city: o.city,
          description: o.description,
        }))
      : [];

    let accumulated = '';

    try {
      let authToken: string | null = null;
      try {
        const stored = await AsyncStorage.getItem('auth');
        if (stored) {
          const parsed = JSON.parse(stored);
          authToken = parsed.token || null;
        }
      } catch {}

      const url = new URL('/api/mobile/ai/chat/stream', getApiUrl()).toString();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const response = await expoFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: trimmed, context }),
      });

      if (!response.ok) {
        throw new Error(`${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let firstChunkReceived = false;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.content) {
              accumulated += parsed.content;
              const updatedContent = accumulated;
              if (!firstChunkReceived) {
                firstChunkReceived = true;
                setIsLoading(false);
              }
              setMessages(prev =>
                prev.map(m => m.id === aiMsgId ? { ...m, content: updatedContent } : m)
              );
            }
          } catch (parseErr: any) {
            if (parseErr.message === 'Streaming avbröts.') throw parseErr;
          }
        }
      }

      const finalContent = accumulated || 'Jag kunde inte bearbeta din förfrågan just nu.';
      setMessages(prev =>
        prev.map(m => m.id === aiMsgId ? { ...m, content: finalContent } : m)
      );
    } catch {
      const errorContent = accumulated || 'Något gick fel. Försök igen senare.';
      setMessages(prev =>
        prev.map(m => m.id === aiMsgId ? { ...m, content: errorContent } : m)
      );
    } finally {
      setIsLoading(false);
      setStreamingMsgId(null);
    }
  }

  async function handleMicPress() {
    if (isRecording) {
      stopRecording();
      return;
    }

    if (Platform.OS === 'web') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        chunksRef.current = [];
        mediaRecorder.ondataavailable = (e: any) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1];
            try {
              const result = await apiRequest('POST', '/api/mobile/ai/transcribe', {
                audio: base64,
              });
              if (result.text) {
                sendMessage(result.text);
              }
            } catch {
              const errorMsg: Message = {
                id: Date.now().toString(),
                role: 'assistant',
                content: 'Kunde inte transkribera ljudet. Försök igen.',
                timestamp: new Date(),
              };
              setMessages(prev => [...prev, errorMsg]);
            }
          };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;
        setIsRecording(true);
      } catch {
        const errorMsg: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: 'Kunde inte starta mikrofonen. Kontrollera dina inställningar.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    } else {
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          const errorMsg: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: 'Mikrofontillstånd krävs för röstinmatning.',
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, errorMsg]);
          return;
        }
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await recording.startAsync();
        mediaRecorderRef.current = recording;
        setIsRecording(true);
      } catch {
        const errorMsg: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: 'Kunde inte starta inspelning.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    }
  }

  async function stopRecording() {
    setIsRecording(false);

    if (Platform.OS === 'web') {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
    } else {
      try {
        const recording = mediaRecorderRef.current;
        if (recording) {
          await recording.stopAndUnloadAsync();
          const uri = recording.getURI();
          mediaRecorderRef.current = null;
          if (uri) {
            const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
            try {
              const result = await apiRequest('POST', '/api/mobile/ai/transcribe', {
                audio: base64,
              });
              if (result.text) {
                sendMessage(result.text);
              }
            } catch {
              const errorMsg: Message = {
                id: Date.now().toString(),
                role: 'assistant',
                content: 'Kunde inte transkribera ljudet. Försök igen.',
                timestamp: new Date(),
              };
              setMessages(prev => [...prev, errorMsg]);
            }
          }
        }
      } catch {
        const errorMsg: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: 'Kunde inte stoppa inspelningen.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    }
  }

  const hasText = inputText.trim().length > 0;

  const reversedMessages = messages.slice().reverse();

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const originalIndex = messages.length - 1 - index;
    return <MessageBubble msg={item} index={originalIndex} formatTime={formatTime} isStreamingMsg={item.id === streamingMsgId} />;
  }, [messages.length, formatTime, streamingMsgId]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const EmptyState = useCallback(() => {
    return isOnlyWelcome ? (
      <SuggestionCards onSend={sendMessage} />
    ) : null;
  }, [isOnlyWelcome]);

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        inverted={messages.length > 0}
        data={reversedMessages}
        renderItem={renderMessage}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.messagesContent,
          { paddingTop: Spacing.md, paddingBottom: Spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={EmptyState}
      />

      <View style={[styles.bottomArea, { paddingBottom: tabBarHeight + Spacing.sm }]}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickActionsScroll}
          contentContainerStyle={styles.quickActions}
          data={QUICK_ACTIONS}
          keyExtractor={(item) => item.id}
          renderItem={({ item: action }) => (
            <Pressable
              style={styles.quickChip}
              onPress={() => sendMessage(action.message)}
              testID={`button-quick-${action.id}`}
            >
              <Feather name={action.icon} size={13} color={action.color} />
              <ThemedText variant="caption" color={action.color} style={styles.quickChipText}>
                {action.label}
              </ThemedText>
            </Pressable>
          )}
        />

        <View style={styles.inputRow}>
          <Pressable
            style={[styles.micButton, isRecording ? styles.micButtonRecording : null]}
            onPress={handleMicPress}
            testID="button-mic"
          >
            <Feather
              name={isRecording ? 'square' : 'mic'}
              size={18}
              color={isRecording ? Colors.textInverse : Colors.primary}
            />
          </Pressable>
          <TextInput
            style={styles.textInput}
            placeholder="Skriv ett meddelande..."
            placeholderTextColor={Colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            testID="input-ai-message"
            onSubmitEditing={() => sendMessage(inputText)}
            blurOnSubmit
          />
          <Pressable
            style={[styles.sendButton, !hasText ? styles.sendButtonDisabled : null]}
            onPress={() => sendMessage(inputText)}
            disabled={isLoading || !!streamingMsgId || !hasText}
            testID="button-send-ai"
          >
            <Feather name="arrow-up" size={20} color={hasText ? Colors.textInverse : Colors.textMuted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  messagesContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  messageBubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    maxWidth: '85%',
  },
  userRow: {
    alignSelf: 'flex-end',
  },
  assistantRow: {
    alignSelf: 'flex-start',
  },
  avatarContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  messageBubble: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    maxWidth: '100%',
    flexShrink: 1,
  },
  userBubble: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  messageText: {
    lineHeight: 21,
    fontSize: 15,
  },
  timestamp: {
    marginTop: 4,
    fontSize: 10,
    alignSelf: 'flex-end',
  },
  typingContainer: {
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.textMuted,
  },
  suggestionsContainer: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  suggestionCard: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
  },
  suggestionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: Colors.text,
  },
  suggestionDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  bottomArea: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  quickActionsScroll: {
    marginBottom: Spacing.sm,
  },
  quickActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 1,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  quickChipText: {
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  textInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  micButtonRecording: {
    backgroundColor: Colors.danger,
    borderColor: Colors.danger,
  },
});
