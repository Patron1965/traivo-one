import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, TextInput, Pressable, StyleSheet, Platform, Animated, ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useFocusEffect } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';
import { hapticLight, hapticSuccess } from '../utils/haptics';
import { apiRequest } from '../lib/query-client';

const STORAGE_KEY = 'plannix_go_personal_todos';

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

async function loadTodos(): Promise<TodoItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveTodos(items: TodoItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export async function getUncompletedTodoCount(): Promise<number> {
  const todos = await loadTodos();
  return todos.filter(t => !t.completed).length;
}

export function TodoScreen() {
  const s = useThemedStyles(createTodoStyles);
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useFocusEffect(
    useCallback(() => {
      loadTodos().then(setTodos);
    }, [])
  );

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, pulseAnim]);

  const persist = useCallback(async (items: TodoItem[]) => {
    setTodos(items);
    await saveTodos(items);
  }, []);

  const addTodoFromText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    hapticSuccess();
    const item: TodoItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    setTodos(prev => {
      const updated = [item, ...prev];
      saveTodos(updated);
      return updated;
    });
  }, []);

  const addTodo = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    hapticLight();
    const item: TodoItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    persist([item, ...todos]);
    setInputText('');
  }, [inputText, todos, persist]);

  const startRecording = useCallback(async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      hapticLight();
    } catch {
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    const recording = recordingRef.current;
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      if (!uri) return;
      setIsTranscribing(true);
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const result = await apiRequest('POST', '/api/mobile/ai/transcribe', { audio: base64 });
      if (result.text) {
        addTodoFromText(result.text);
      }
    } catch {
    } finally {
      setIsTranscribing(false);
    }
  }, [addTodoFromText]);

  const handleMicPress = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const toggleTodo = useCallback((id: string) => {
    hapticLight();
    const updated = todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
    persist(updated);
  }, [todos, persist]);

  const deleteTodo = useCallback((id: string) => {
    hapticLight();
    persist(todos.filter(t => t.id !== id));
  }, [todos, persist]);

  const clearCompleted = useCallback(() => {
    const completedCount = todos.filter(t => t.completed).length;
    if (completedCount === 0) return;
    hapticSuccess();
    persist(todos.filter(t => !t.completed));
  }, [todos, persist]);

  const pending = todos.filter(t => !t.completed);
  const completed = todos.filter(t => t.completed);

  const renderItem = useCallback(({ item }: { item: TodoItem | { type: 'divider'; count: number } }) => {
    if ('type' in item && item.type === 'divider') {
      return (
        <View style={s.divider}>
          <View style={s.dividerLine} />
          <ThemedText variant="caption" color={Colors.textMuted} style={s.dividerText}>
            Klara ({item.count})
          </ThemedText>
          <View style={s.dividerLine} />
        </View>
      );
    }
    const todo = item as TodoItem;
    return (
      <Card style={[s.todoCard, todo.completed ? s.todoCardCompleted : null]}>
        <View style={s.todoRow}>
          <Pressable
            onPress={() => toggleTodo(todo.id)}
            style={s.checkBtn}
            testID={`button-toggle-${todo.id}`}
          >
            <Feather
              name={todo.completed ? 'check-circle' : 'circle'}
              size={24}
              color={todo.completed ? '#22C55E' : Colors.primary}
            />
          </Pressable>
          <ThemedText
            variant="body"
            color={todo.completed ? Colors.textMuted : Colors.text}
            style={[s.todoText, todo.completed ? s.todoTextCompleted : null]}
            numberOfLines={3}
          >
            {todo.text}
          </ThemedText>
          <Pressable
            onPress={() => deleteTodo(todo.id)}
            style={s.deleteBtn}
            testID={`button-delete-${todo.id}`}
          >
            <Feather name="trash-2" size={18} color={Colors.textMuted} />
          </Pressable>
        </View>
      </Card>
    );
  }, [toggleTodo, deleteTodo]);

  const listData: (TodoItem | { type: 'divider'; count: number })[] = [
    ...pending,
    ...(completed.length > 0 ? [{ type: 'divider' as const, count: completed.length }] : []),
    ...completed,
  ];

  return (
    <View style={s.container} testID="screen-Todo">
      <View style={[s.inputRow, { marginTop: headerHeight + Spacing.sm }]}>
        <TextInput
          style={s.input}
          placeholder={isRecording ? 'Lyssnar...' : isTranscribing ? 'Bearbetar...' : 'Ny uppgift...'}
          placeholderTextColor={isRecording ? '#EF4444' : Colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={addTodo}
          returnKeyType="done"
          editable={!isRecording && !isTranscribing}
          testID="input-todo"
        />
        {isTranscribing ? (
          <View style={s.addBtn}>
            <ActivityIndicator size="small" color="#FFFFFF" />
          </View>
        ) : (
          <Animated.View style={{ transform: [{ scale: isRecording ? pulseAnim : 1 }] }}>
            <Pressable
              style={[s.micBtn, isRecording ? s.micBtnRecording : null]}
              onPress={handleMicPress}
              testID="button-mic-todo"
            >
              <Feather name={isRecording ? 'mic-off' : 'mic'} size={22} color="#FFFFFF" />
            </Pressable>
          </Animated.View>
        )}
        {inputText.trim() ? (
          <Pressable
            style={s.addBtn}
            onPress={addTodo}
            testID="button-add-todo"
          >
            <Feather name="plus" size={22} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>

      {isRecording ? (
        <View style={s.recordingHint}>
          <View style={s.recordingDot} />
          <ThemedText variant="caption" color="#EF4444">
            Tala in din uppgift — tryck igen för att stoppa
          </ThemedText>
        </View>
      ) : null}

      {completed.length > 0 ? (
        <Pressable style={s.clearBtn} onPress={clearCompleted} testID="button-clear-completed">
          <Feather name="trash-2" size={14} color={Colors.primary} />
          <ThemedText variant="caption" color={Colors.primary}>Rensa klara</ThemedText>
        </Pressable>
      ) : null}

      {listData.length === 0 ? (
        <View style={s.emptyContainer}>
          <Feather name="list" size={48} color={Colors.textMuted} />
          <ThemedText variant="body" color={Colors.textMuted} style={s.emptyText}>
            Tomt här!
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textMuted}>
            Lägg till din första uppgift ovan
          </ThemedText>
        </View>
      ) : (
        <FlashList
          data={listData}
          renderItem={renderItem}
          estimatedItemSize={64}
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: tabBarHeight + Spacing.xl }}
          keyExtractor={(item) => 'type' in item ? 'divider' : (item as TodoItem).id}
        />
      )}
    </View>
  );
}

const createTodoStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  inputRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? Spacing.md : Spacing.sm,
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnRecording: {
    backgroundColor: '#EF4444',
  },
  recordingHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  addBtnDisabled: {
    opacity: 0.4,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  todoCard: {
    marginBottom: Spacing.sm,
  },
  todoCardCompleted: {
    opacity: 0.6,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  checkBtn: {
    padding: Spacing.xs,
  },
  todoText: {
    flex: 1,
  },
  todoTextCompleted: {
    textDecorationLine: 'line-through',
  },
  deleteBtn: {
    padding: Spacing.xs,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingBottom: 100,
  },
  emptyText: {
    fontWeight: '600',
  },
});
