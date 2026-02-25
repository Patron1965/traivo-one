import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, FlatList, Pressable, StyleSheet, TextInput,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest, getApiUrl } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';

interface TeamMessage {
  id: number;
  sender_id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Idag';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Igår';
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

export function TeamChatScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<any>(null);

  const { data: messages = [], isLoading } = useQuery<TeamMessage[]>({
    queryKey: ['/api/mobile/team-chat'],
    refetchInterval: 15000,
  });

  const sendMutation = useMutation({
    mutationFn: (message: string) =>
      apiRequest('POST', '/api/mobile/team-chat', { message }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/team-chat'] });
      setText('');
    },
  });

  useEffect(() => {
    let socket: any = null;
    async function connectSocket() {
      try {
        const { io } = await import('socket.io-client');
        const apiUrl = getApiUrl();
        socket = io(apiUrl, {
          path: '/ws',
          transports: ['websocket', 'polling'],
          reconnection: true,
        });
        socket.on('team:message', () => {
          queryClient.invalidateQueries({ queryKey: ['/api/mobile/team-chat'] });
        });
        socketRef.current = socket;
      } catch {}
    }
    connectSocket();
    return () => {
      if (socket) socket.disconnect();
    };
  }, [queryClient]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length > 0 && !sendMutation.isPending) {
      sendMutation.mutate(trimmed);
    }
  }, [text, sendMutation]);

  const currentUserId = user?.resourceId || user?.id || '';

  const sortedMessages = [...messages].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const renderMessage = ({ item, index }: { item: TeamMessage; index: number }) => {
    const isMe = String(item.sender_id) === String(currentUserId);
    const nextItem = sortedMessages[index + 1];
    const showDateHeader = !nextItem ||
      new Date(item.created_at).toDateString() !== new Date(nextItem.created_at).toDateString();

    return (
      <View>
        {showDateHeader ? (
          <View style={styles.dateHeader}>
            <ThemedText variant="caption" color={Colors.textMuted} style={styles.dateHeaderText}>
              {formatDateHeader(item.created_at)}
            </ThemedText>
          </View>
        ) : null}
        <View style={[styles.messageBubbleRow, isMe ? styles.myRow : styles.otherRow]}>
          {!isMe ? (
            <View style={styles.avatarCircle}>
              <ThemedText variant="caption" color={Colors.textInverse} style={styles.avatarText}>
                {item.sender_name.charAt(0).toUpperCase()}
              </ThemedText>
            </View>
          ) : null}
          <View style={[styles.bubble, isMe ? styles.myBubble : styles.otherBubble]}>
            {!isMe ? (
              <ThemedText variant="caption" color={Colors.primaryLight} style={styles.senderName}>
                {item.sender_name}
              </ThemedText>
            ) : null}
            <ThemedText variant="body" color={isMe ? Colors.textInverse : Colors.text}>
              {item.message}
            </ThemedText>
            <ThemedText
              variant="caption"
              color={isMe ? 'rgba(255,255,255,0.6)' : Colors.textMuted}
              style={styles.timeText}
            >
              {formatTime(item.created_at)}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  };

  const EmptyState = () => (
    <View style={styles.emptyContainer}>
      <Feather name="message-circle" size={48} color={Colors.textMuted} />
      <ThemedText variant="subheading" color={Colors.textMuted} style={styles.emptyTitle}>
        Teamchat
      </ThemedText>
      <ThemedText variant="body" color={Colors.textMuted} style={styles.emptyDesc}>
        Skicka meddelanden till dina kollegor i teamet
      </ThemedText>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <FlatList
        ref={flatListRef}
        data={sortedMessages}
        renderItem={renderMessage}
        keyExtractor={(item) => String(item.id)}
        inverted={sortedMessages.length > 0}
        ListEmptyComponent={EmptyState}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: Spacing.md, paddingBottom: headerHeight + Spacing.md },
        ]}
        testID="team-chat-list"
      />
      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <TextInput
          style={styles.input}
          placeholder="Skriv ett meddelande..."
          placeholderTextColor={Colors.textMuted}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={500}
          testID="input-team-chat"
        />
        <Pressable
          style={[styles.sendButton, text.trim().length === 0 ? styles.sendDisabled : null]}
          onPress={handleSend}
          disabled={text.trim().length === 0 || sendMutation.isPending}
          testID="button-send-team-chat"
        >
          {sendMutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.textInverse} />
          ) : (
            <Feather name="send" size={20} color={Colors.textInverse} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
  },
  dateHeader: {
    alignItems: 'center',
    marginVertical: Spacing.sm,
  },
  dateHeaderText: {
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
    fontSize: FontSize.xs,
  },
  messageBubbleRow: {
    flexDirection: 'row',
    marginBottom: Spacing.xs,
    maxWidth: '85%',
  },
  myRow: {
    alignSelf: 'flex-end',
  },
  otherRow: {
    alignSelf: 'flex-start',
    alignItems: 'flex-end',
  },
  avatarCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.xs,
    marginBottom: 2,
  },
  avatarText: {
    fontSize: FontSize.xs,
    fontFamily: 'Inter_700Bold',
  },
  bubble: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    maxWidth: '100%',
  },
  myBubble: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 2,
  },
  timeText: {
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: 100,
  },
  emptyTitle: {
    marginTop: Spacing.sm,
  },
  emptyDesc: {
    textAlign: 'center',
    maxWidth: 250,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? Spacing.sm + 2 : Spacing.sm,
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  sendDisabled: {
    opacity: 0.4,
  },
});
