import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/query-client';

const REASON_OPTIONS = [
  { key: 'too_long', label: 'För lång rutt', icon: 'clock' },
  { key: 'too_short', label: 'För kort rutt', icon: 'minus-circle' },
  { key: 'logical', label: 'Logisk ordning', icon: 'check-circle' },
  { key: 'illogical', label: 'Ologisk ordning', icon: 'shuffle' },
  { key: 'good', label: 'Bra rutt', icon: 'thumbs-up' },
  { key: 'traffic', label: 'Mycket trafik', icon: 'alert-triangle' },
] as const;

export function RouteFeedbackScreen({ navigation }: any) {
  const { token } = useAuth();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [rating, setRating] = useState(0);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const toggleReason = (key: string) => {
    setSelectedReasons((prev) =>
      prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]
    );
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      if (Platform.OS === 'web') {
        alert('Välj ett betyg (1-5 stjärnor)');
      } else {
        Alert.alert('Betyg saknas', 'Välj ett betyg (1-5 stjärnor)');
      }
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('POST', '/api/mobile/route-feedback', {
        rating,
        reasons: selectedReasons,
        comment,
        date: new Date().toISOString().split('T')[0],
      }, token);
      setSubmitted(true);
    } catch (err: any) {
      const msg = err.message || 'Kunde inte spara ruttbetyg';
      if (Platform.OS === 'web') {
        alert(msg);
      } else {
        Alert.alert('Fel', msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <View style={[styles.centeredContainer, { paddingTop: headerHeight + Spacing.xl }]}>
        <Feather name="check-circle" size={64} color={Colors.accent} />
        <ThemedText variant="title" style={styles.thankYouTitle}>
          Tack!
        </ThemedText>
        <ThemedText variant="body" color={Colors.textSecondary} style={styles.thankYouText}>
          Ditt ruttbetyg har sparats. Det hjälper oss optimera framtida rutter.
        </ThemedText>
        <Pressable
          testID="button-close-feedback"
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
        >
          <ThemedText variant="body" color={Colors.textInverse}>Stäng</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
      ]}
    >
      <ThemedText variant="title" style={styles.heading}>
        Betygsätt dagens rutt
      </ThemedText>
      <ThemedText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        Hur upplevde du dagens körrutt? Ditt omdöme förbättrar framtida planering.
      </ThemedText>

      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable
            key={star}
            testID={`button-star-${star}`}
            onPress={() => setRating(star)}
            style={styles.starButton}
          >
            <Feather
              name="star"
              size={40}
              color={star <= rating ? Colors.warning : Colors.borderLight}
            />
          </Pressable>
        ))}
      </View>
      {rating > 0 ? (
        <ThemedText variant="caption" color={Colors.textSecondary} style={styles.ratingLabel}>
          {rating === 1 ? 'Dålig' : rating === 2 ? 'Okej' : rating === 3 ? 'Bra' : rating === 4 ? 'Mycket bra' : 'Utmärkt'}
        </ThemedText>
      ) : null}

      <ThemedText variant="subtitle" style={styles.sectionTitle}>
        Varför? (valfritt)
      </ThemedText>
      <View style={styles.reasonsGrid}>
        {REASON_OPTIONS.map((reason) => {
          const selected = selectedReasons.includes(reason.key);
          return (
            <Pressable
              key={reason.key}
              testID={`button-reason-${reason.key}`}
              style={[styles.reasonChip, selected ? styles.reasonChipSelected : null]}
              onPress={() => toggleReason(reason.key)}
            >
              <Feather
                name={reason.icon as any}
                size={16}
                color={selected ? Colors.textInverse : Colors.text}
              />
              <ThemedText
                variant="caption"
                color={selected ? Colors.textInverse : Colors.text}
                style={styles.reasonLabel}
              >
                {reason.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <ThemedText variant="subtitle" style={styles.sectionTitle}>
        Kommentar (valfritt)
      </ThemedText>
      <TextInput
        testID="input-feedback-comment"
        style={styles.commentInput}
        placeholder="Skriv en kommentar om dagens rutt..."
        placeholderTextColor={Colors.textMuted}
        value={comment}
        onChangeText={setComment}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />

      <Pressable
        testID="button-submit-feedback"
        style={[styles.submitButton, submitting ? styles.submitButtonDisabled : null]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        <Feather name="send" size={18} color={Colors.textInverse} />
        <ThemedText variant="body" color={Colors.textInverse} style={styles.submitLabel}>
          {submitting ? 'Skickar...' : 'Skicka betyg'}
        </ThemedText>
      </Pressable>

      <Pressable
        testID="button-skip-feedback"
        style={styles.skipButton}
        onPress={() => navigation.goBack()}
      >
        <ThemedText variant="body" color={Colors.textSecondary}>
          Hoppa över
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  heading: {
    marginBottom: Spacing.sm,
  },
  subtitle: {
    marginBottom: Spacing.xl,
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  starButton: {
    padding: Spacing.xs,
  },
  ratingLabel: {
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  reasonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  reasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  reasonChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  reasonLabel: {
    fontSize: FontSize.sm,
  },
  commentInput: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    minHeight: 80,
    marginBottom: Spacing.xl,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitLabel: {
    fontWeight: '600',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginBottom: Spacing.xl,
  },
  thankYouTitle: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  thankYouText: {
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },
  closeButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.md,
  },
});
