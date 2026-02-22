import React, { useState, useRef, useEffect } from 'react';
import {
  View, ScrollView, Pressable, StyleSheet, TextInput,
  ActivityIndicator, Platform,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
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
  content: 'Hej! Jag är Unicorn Assist, din AI-assistent. Jag kan hjälpa dig med frågor om dina uppdrag, ge vägledning om procedurer, eller analysera bilder. Vad kan jag hjälpa dig med?',
  timestamp: new Date(),
};

export function AIAssistantScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<any[]>([]);

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
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

      const result = await apiRequest('POST', '/api/mobile/ai/chat', {
        message: trimmed,
        context,
      });

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.response || 'Jag kunde inte bearbeta din förfrågan just nu.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Något gick fel. Försök igen senare.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
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
        const { Audio } = require('expo-av');
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
            const { readAsStringAsync, EncodingType } = require('expo-file-system');
            const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
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

  function handleQuickTasks() {
    sendMessage('Kan du ge mig en sammanfattning av mina uppdrag idag?');
  }

  function handleQuickHelp() {
    sendMessage('Jag behöver hjälp. Vad kan du hjälpa mig med?');
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  const hasText = inputText.trim().length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.messagesContainer}
        contentContainerStyle={[
          styles.messagesContent,
          { paddingTop: Spacing.lg, paddingBottom: Spacing.md },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((msg, index) => (
          <View
            key={msg.id}
            style={[
              styles.messageBubbleRow,
              msg.role === 'user' ? styles.userRow : styles.assistantRow,
            ]}
          >
            {msg.role === 'assistant' ? (
              <View style={styles.avatarContainer}>
                <Feather name="cpu" size={16} color={Colors.secondary} />
              </View>
            ) : null}
            <View
              style={[
                styles.messageBubble,
                msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <ThemedText
                variant="body"
                color={msg.role === 'user' ? Colors.textInverse : Colors.text}
                testID={`text-ai-message-${index}`}
                style={styles.messageText}
              >
                {msg.content}
              </ThemedText>
              <ThemedText
                variant="caption"
                color={msg.role === 'user' ? 'rgba(255,255,255,0.7)' : Colors.textMuted}
                style={styles.timestamp}
              >
                {formatTime(msg.timestamp)}
              </ThemedText>
            </View>
          </View>
        ))}

        {isLoading ? (
          <View style={[styles.messageBubbleRow, styles.assistantRow]}>
            <View style={styles.avatarContainer}>
              <Feather name="cpu" size={16} color={Colors.secondary} />
            </View>
            <View style={[styles.messageBubble, styles.assistantBubble]}>
              <ActivityIndicator size="small" color={Colors.secondary} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.bottomArea, { paddingBottom: tabBarHeight + Spacing.sm }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickActionsScroll}
          contentContainerStyle={styles.quickActions}
        >
          <Pressable
            style={styles.quickChip}
            onPress={handleQuickTasks}
            testID="button-quick-tasks"
          >
            <Feather name="clipboard" size={14} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>
              Mina uppdrag
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.quickChip}
            onPress={handleQuickHelp}
            testID="button-quick-help"
          >
            <Feather name="help-circle" size={14} color={Colors.secondary} />
            <ThemedText variant="caption" color={Colors.secondary}>
              Hjälp
            </ThemedText>
          </Pressable>
        </ScrollView>

        <View style={styles.inputRow}>
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
          {hasText ? (
            <Pressable
              style={styles.sendButton}
              onPress={() => sendMessage(inputText)}
              disabled={isLoading}
              testID="button-send-ai"
            >
              <Feather name="send" size={18} color={Colors.textInverse} />
            </Pressable>
          ) : (
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
          )}
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
  messagesContainer: {
    flex: 1,
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
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.secondaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  messageBubble: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    maxWidth: '100%',
    flexShrink: 1,
  },
  userBubble: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.sm,
  },
  assistantBubble: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderBottomLeftRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  messageText: {
    lineHeight: 22,
  },
  timestamp: {
    marginTop: Spacing.xs,
    fontSize: FontSize.xs,
    alignSelf: 'flex-end',
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
    gap: Spacing.sm,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
