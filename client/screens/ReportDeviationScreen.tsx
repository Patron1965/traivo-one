import React, { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator, Platform, Image } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
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
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

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

  async function handleTakePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setPhotoUri(asset.uri);
        if (asset.base64) {
          setPhotoBase64(asset.base64);
        }
      }
    } catch {}
  }

  async function handlePickPhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setPhotoUri(asset.uri);
        if (asset.base64) {
          setPhotoBase64(asset.base64);
        }
      }
    } catch {}
  }

  async function handleAiAnalyze() {
    if (!photoBase64) return;
    setIsAnalyzing(true);
    setAiSuggestion(null);
    try {
      const result = await apiRequest('POST', '/api/mobile/ai/analyze-image', {
        image: photoBase64,
        context: `Avvikelserapport för order ${orderId}`,
      });
      if (result.suggestedCategory && result.suggestedCategory in DEVIATION_CATEGORIES) {
        setCategory(result.suggestedCategory as DeviationCategory);
      }
      if (result.suggestedDescription) {
        setDescription(result.suggestedDescription);
      }
      setAiSuggestion(result.description || null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setAiSuggestion('Kunde inte analysera bilden. Fyll i manuellt.');
    } finally {
      setIsAnalyzing(false);
    }
  }

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

      <Card style={styles.photoSection}>
        <ThemedText variant="label" style={styles.sectionLabel}>Foto (valfritt)</ThemedText>
        {photoUri ? (
          <View>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <View style={styles.photoActions}>
              <Pressable
                style={styles.aiAnalyzeButton}
                onPress={handleAiAnalyze}
                disabled={isAnalyzing || !photoBase64}
                testID="button-ai-analyze"
              >
                {isAnalyzing ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <>
                    <Feather name="cpu" size={16} color={Colors.textInverse} />
                    <ThemedText variant="caption" color={Colors.textInverse}>
                      AI-analys
                    </ThemedText>
                  </>
                )}
              </Pressable>
              <Pressable
                style={styles.removePhotoButton}
                onPress={() => {
                  setPhotoUri(null);
                  setPhotoBase64(null);
                  setAiSuggestion(null);
                }}
                testID="button-remove-photo"
              >
                <Feather name="x" size={16} color={Colors.danger} />
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.photoButtons}>
            <Pressable style={styles.photoButton} onPress={handleTakePhoto} testID="button-take-photo">
              <Feather name="camera" size={20} color={Colors.primary} />
              <ThemedText variant="caption" color={Colors.primary}>Ta foto</ThemedText>
            </Pressable>
            <Pressable style={styles.photoButton} onPress={handlePickPhoto} testID="button-pick-photo">
              <Feather name="image" size={20} color={Colors.primary} />
              <ThemedText variant="caption" color={Colors.primary}>Välj bild</ThemedText>
            </Pressable>
          </View>
        )}
        {aiSuggestion ? (
          <View style={styles.aiSuggestionBox}>
            <View style={styles.aiSuggestionHeader}>
              <Feather name="cpu" size={14} color={Colors.secondary} />
              <ThemedText variant="caption" color={Colors.secondary}>
                AI-analys
              </ThemedText>
            </View>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.aiSuggestionText}>
              {aiSuggestion}
            </ThemedText>
          </View>
        ) : null}
      </Card>

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
  photoSection: {
    marginBottom: Spacing.xl,
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    marginBottom: Spacing.sm,
  },
  photoActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'flex-end',
  },
  aiAnalyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.secondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  removePhotoButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  photoButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xl,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
  },
  aiSuggestionBox: {
    marginTop: Spacing.md,
    backgroundColor: Colors.infoLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  aiSuggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  aiSuggestionText: {
    lineHeight: 20,
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
