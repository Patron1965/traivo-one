import React, { useState, useEffect, useRef } from 'react';
import { View, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator, Platform, Image, Animated } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { triggerNotification, triggerImpact, triggerSelection, NotificationFeedbackType, ImpactFeedbackStyle } from '../lib/haptics';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import { DEVIATION_CATEGORIES, DeviationCategory } from '../types';

type Severity = 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Låg',
  medium: 'Medel',
  high: 'Hög',
  critical: 'Kritisk',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  low: Colors.success,
  medium: Colors.warning,
  high: '#E67E22',
  critical: Colors.danger,
};

function SkeletonLine({ width, height = 14, style }: { width: number | string; height?: number; style?: any }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: BorderRadius.sm,
          backgroundColor: Colors.textMuted,
          opacity,
        },
        style,
      ]}
    />
  );
}

function AnalysisSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonHeader}>
        <ActivityIndicator size="small" color={Colors.secondary} />
        <ThemedText variant="caption" color={Colors.secondary}>
          AI analyserar bilden...
        </ThemedText>
      </View>
      <SkeletonLine width="90%" style={{ marginBottom: Spacing.sm }} />
      <SkeletonLine width="75%" style={{ marginBottom: Spacing.sm }} />
      <SkeletonLine width="60%" style={{ marginBottom: Spacing.md }} />
      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        <SkeletonLine width={80} height={28} />
        <SkeletonLine width={60} height={28} />
      </View>
    </View>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let color = Colors.danger;
  if (pct >= 80) color = Colors.success;
  else if (pct >= 60) color = Colors.warning;
  else if (pct >= 40) color = '#E67E22';

  return (
    <View style={[styles.confidenceBadge, { borderColor: color }]}>
      <Feather name="bar-chart-2" size={12} color={color} />
      <ThemedText variant="caption" color={color}>
        {pct}% säkerhet
      </ThemedText>
    </View>
  );
}

export function ReportDeviationScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<DeviationCategory | null>(null);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [aiAccepted, setAiAccepted] = useState(false);
  const hasAutoAnalyzed = useRef(false);

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
      triggerNotification(NotificationFeedbackType.Success);
      navigation.goBack();
    },
  });

  useEffect(() => {
    if (photoBase64 && !hasAutoAnalyzed.current) {
      hasAutoAnalyzed.current = true;
      handleAiAnalyze();
    }
  }, [photoBase64]);

  async function handleTakePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        return;
      }
      hasAutoAnalyzed.current = false;
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
      hasAutoAnalyzed.current = false;
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
    setAiConfidence(null);
    setAiAccepted(false);
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
      if (result.suggestedSeverity && result.suggestedSeverity in SEVERITY_LABELS) {
        setSeverity(result.suggestedSeverity as Severity);
      }
      if (typeof result.confidence === 'number') {
        setAiConfidence(result.confidence);
      }
      setAiSuggestion(result.description || null);
      triggerNotification(NotificationFeedbackType.Success);
    } catch {
      setAiSuggestion('Kunde inte analysera bilden. Fyll i manuellt.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleAcceptAi() {
    setAiAccepted(true);
    triggerImpact(ImpactFeedbackStyle.Light);
  }

  function handleSubmit() {
    if (!category) return;
    mutation.mutate({ category, description, severity });
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
        <ThemedText variant="label" style={styles.sectionLabel}>Foto</ThemedText>
        {photoUri ? (
          <View>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <View style={styles.photoActions}>
              <Pressable
                style={styles.retryAnalyzeButton}
                onPress={() => {
                  hasAutoAnalyzed.current = false;
                  handleAiAnalyze();
                }}
                disabled={isAnalyzing || !photoBase64}
                testID="button-ai-retry"
              >
                <Feather name="refresh-cw" size={14} color={Colors.secondary} />
                <ThemedText variant="caption" color={Colors.secondary}>
                  Analysera igen
                </ThemedText>
              </Pressable>
              <Pressable
                style={styles.removePhotoButton}
                onPress={() => {
                  setPhotoUri(null);
                  setPhotoBase64(null);
                  setAiSuggestion(null);
                  setAiConfidence(null);
                  setAiAccepted(false);
                  hasAutoAnalyzed.current = false;
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
        {isAnalyzing ? <AnalysisSkeleton /> : null}
        {aiSuggestion && !isAnalyzing ? (
          <View style={styles.aiSuggestionBox}>
            <View style={styles.aiSuggestionHeader}>
              <Feather name="cpu" size={14} color={Colors.secondary} />
              <ThemedText variant="caption" color={Colors.secondary}>
                AI-analys
              </ThemedText>
              {aiConfidence !== null ? <ConfidenceBadge confidence={aiConfidence} /> : null}
            </View>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.aiSuggestionText}>
              {aiSuggestion}
            </ThemedText>
            {!aiAccepted ? (
              <Pressable
                style={styles.acceptAiButton}
                onPress={handleAcceptAi}
                testID="button-accept-ai"
              >
                <Feather name="check-circle" size={16} color={Colors.textInverse} />
                <ThemedText variant="caption" color={Colors.textInverse}>
                  Acceptera AI-förslag
                </ThemedText>
              </Pressable>
            ) : (
              <View style={styles.acceptedBadge}>
                <Feather name="check" size={14} color={Colors.success} />
                <ThemedText variant="caption" color={Colors.success}>
                  AI-förslag accepterat
                </ThemedText>
              </View>
            )}
          </View>
        ) : null}
      </Card>

      <ThemedText variant="label" style={styles.sectionLabel}>Allvarlighetsgrad</ThemedText>
      <View style={styles.severityRow}>
        {(Object.entries(SEVERITY_LABELS) as [Severity, string][]).map(([key, label]) => (
          <Pressable
            key={key}
            style={[
              styles.severityChip,
              severity === key ? { backgroundColor: SEVERITY_COLORS[key], borderColor: SEVERITY_COLORS[key] } : null,
            ]}
            onPress={() => {
              setSeverity(key);
              triggerSelection();
            }}
            testID={`button-severity-${key}`}
          >
            <ThemedText
              variant="caption"
              color={severity === key ? Colors.textInverse : Colors.text}
            >
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText variant="label" style={styles.sectionLabel}>Kategori</ThemedText>
      <View style={styles.categoryGrid}>
        {(Object.entries(DEVIATION_CATEGORIES) as [DeviationCategory, string][]).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.categoryChip, category === key ? styles.categoryActive : null]}
            onPress={() => {
              setCategory(key);
              triggerSelection();
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
  retryAnalyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.secondary,
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
  skeletonContainer: {
    marginTop: Spacing.md,
    backgroundColor: Colors.infoLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
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
    flexWrap: 'wrap',
  },
  aiSuggestionText: {
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  confidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    marginLeft: 'auto',
  },
  acceptAiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.secondary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  acceptedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  severityRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  severityChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
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
