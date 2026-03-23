import { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { sendChatMessage } from '../api/ai';
import { colors, spacing, fontSize, borderRadius } from '../theme';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function AIAssistantScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hej! Jag är din AI-assistent. Fråga mig om schema, kunder, ordrar eller annat.',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const chatMutation = useMutation({
    mutationFn: (message: string) => sendChatMessage(message),
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: data.response,
          timestamp: Date.now(),
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: 'Kunde inte nå AI-tjänsten. Försök igen senare.',
          timestamp: Date.now(),
        },
      ]);
    },
  });

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    chatMutation.mutate(text);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => (
    <View
      style={[
        styles.messageBubble,
        item.role === 'user' ? styles.userBubble : styles.assistantBubble,
      ]}
    >
      <Text
        style={[
          styles.messageText,
          item.role === 'user' ? styles.userText : styles.assistantText,
        ]}
      >
        {item.content}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

      {chatMutation.isPending && (
        <View style={styles.typingIndicator}>
          <ActivityIndicator size="small" color={colors.northernTeal} />
          <Text style={styles.typingText}>AI tänker...</Text>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ställ en fråga..."
          placeholderTextColor={colors.mountainGray}
          multiline
          maxLength={500}
          data-testid="input-ai-message"
        />
        <TouchableOpacity
          style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={chatMutation.isPending || !input.trim()}
          data-testid="button-send-ai"
        >
          <Text style={styles.sendButtonText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  messageList: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  userBubble: {
    backgroundColor: colors.deepOceanBlue,
    alignSelf: 'flex-end',
    borderBottomRightRadius: spacing.xs,
  },
  assistantBubble: {
    backgroundColor: colors.white,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: spacing.xs,
  },
  messageText: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  userText: {
    color: colors.white,
  },
  assistantText: {
    color: colors.midnightNavy,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  typingText: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.arcticIce,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: colors.midnightNavy,
    maxHeight: 100,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.northernTeal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: colors.white,
    fontSize: 20,
  },
});
