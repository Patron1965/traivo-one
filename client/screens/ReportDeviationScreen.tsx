import React, { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import { DEVIATION_CATEGORIES, DeviationCategory } from '../types';

export function ReportDeviationScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<DeviationCategory | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      let latitude, longitude;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          latitude = loc.coords.latitude;
          longitude = loc.coords.longitude;
        }
      } catch {}
      return apiRequest('POST', `/api/mobile/orders/${orderId}/deviations`, {
        ...data,
        latitude,
        longitude,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    },
  });

  function handleSubmit() {
    if (!category) return;
    mutation.mutate({ category, description });
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
      ]}
    >
      <ThemedText variant="heading" style={styles.title}>
        Rapportera avvikelse
      </ThemedText>

      <ThemedText variant="label" style={styles.sectionLabel}>Kategori</ThemedText>
      <View style={styles.categoryGrid}>
        {(Object.entries(DEVIATION_CATEGORIES) as [DeviationCategory, string][]).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.categoryChip, category === key ? styles.categoryActive : null]}
            onPress={() => {
              setCategory(key);
              Haptics.selectionAsync();
            }}
            testID={`button-category-${key}`}
          >
            <ThemedText
              variant="body"
              color={category === key ? Colors.textInverse : Colors.text}
              style={styles.categoryText}
            >
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText variant="label" style={styles.sectionLabel}>Beskrivning</ThemedText>
      <TextInput
        style={styles.textArea}
        placeholder="Beskriv avvikelsen..."
        placeholderTextColor={Colors.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        testID="input-deviation-description"
      />

      <Pressable
        style={[styles.submitButton, !category ? styles.submitDisabled : null]}
        onPress={handleSubmit}
        disabled={!category || mutation.isPending}
        testID="button-submit-deviation"
      >
        {mutation.isPending ? (
          <ActivityIndicator color={Colors.textInverse} />
        ) : (
          <>
            <Feather name="send" size={18} color={Colors.textInverse} />
            <ThemedText variant="subheading" color={Colors.textInverse}>
              Skicka rapport
            </ThemedText>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xl,
  },
  sectionLabel: {
    marginBottom: Spacing.md,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  categoryChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  categoryActive: {
    backgroundColor: Colors.warning,
    borderColor: Colors.warning,
  },
  categoryText: {
    fontSize: FontSize.md,
  },
  textArea: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    minHeight: 120,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: Spacing.xl,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.warning,
    height: 56,
    borderRadius: BorderRadius.lg,
  },
  submitDisabled: {
    opacity: 0.5,
  },
});
