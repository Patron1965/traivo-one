import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { submitRouteFeedback } from '../api/sync';
import { colors, spacing, fontSize, borderRadius } from '../theme';

const REASON_CATEGORIES = [
  { value: 'felaktig_ordning', label: 'Felaktig ordning' },
  { value: 'orimliga_kortider', label: 'Orimliga körtider' },
  { value: 'vagarbete_hinder', label: 'Vägarbete/hinder' },
  { value: 'for_manga_stopp', label: 'För många stopp' },
  { value: 'saknad_info', label: 'Saknad information' },
  { value: 'trafik', label: 'Trafikproblem' },
  { value: 'optimal', label: 'Optimal rutt' },
  { value: 'ovrigt', label: 'Övrigt' },
];

export function RouteFeedbackScreen() {
  const navigation = useNavigation();
  const [rating, setRating] = useState(0);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      submitRouteFeedback({
        date: new Date().toISOString().split('T')[0],
        rating,
        reasonCategory: reason || undefined,
        freeText: comment || undefined,
      }),
    onSuccess: () => {
      Alert.alert('Tack!', 'Ditt ruttbetyg har sparats');
      navigation.goBack();
    },
    onError: () => {
      Alert.alert('Fel', 'Kunde inte spara betyget');
    },
  });

  const handleSubmit = () => {
    if (rating === 0) {
      Alert.alert('Fel', 'Ge ett betyg');
      return;
    }
    if (rating <= 2 && !reason) {
      Alert.alert('Fel', 'Välj en orsak för lågt betyg');
      return;
    }
    mutation.mutate();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Betygsätt dagens rutt</Text>
      <Text style={styles.subtitle}>Hjälp oss förbättra ruttplaneringen</Text>

      <View style={styles.ratingRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            style={[styles.starButton, rating >= star && styles.starSelected]}
            onPress={() => setRating(star)}
            data-testid={`button-rating-${star}`}
          >
            <Text style={[styles.starText, rating >= star && styles.starTextSelected]}>
              {rating >= star ? '★' : '☆'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {rating > 0 && rating <= 2 && (
        <>
          <Text style={styles.sectionTitle}>Orsak</Text>
          <View style={styles.reasonGrid}>
            {REASON_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                style={[styles.reasonCard, reason === cat.value && styles.reasonCardSelected]}
                onPress={() => setReason(cat.value)}
                data-testid={`button-reason-${cat.value}`}
              >
                <Text style={[styles.reasonText, reason === cat.value && styles.reasonTextSelected]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Kommentar (valfritt)</Text>
      <TextInput
        style={styles.commentInput}
        value={comment}
        onChangeText={setComment}
        placeholder="Berätta mer..."
        placeholderTextColor={colors.mountainGray}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        data-testid="input-route-comment"
      />

      <TouchableOpacity
        style={[styles.submitButton, rating === 0 && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={mutation.isPending || rating === 0}
        data-testid="button-submit-feedback"
      >
        {mutation.isPending ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.submitButtonText}>Skicka betyg</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
    marginBottom: spacing.xxl,
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  starButton: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  starSelected: {
    backgroundColor: colors.warning + '20',
    borderColor: colors.warning,
  },
  starText: {
    fontSize: 28,
    color: colors.mountainGray,
  },
  starTextSelected: {
    color: colors.warning,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.mountainGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  reasonCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  reasonCardSelected: {
    borderColor: colors.northernTeal,
    backgroundColor: colors.northernTeal + '10',
  },
  reasonText: {
    fontSize: fontSize.sm,
    color: colors.midnightNavy,
  },
  reasonTextSelected: {
    color: colors.northernTeal,
    fontWeight: '600',
  },
  commentInput: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: colors.midnightNavy,
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xxl,
  },
  submitButton: {
    backgroundColor: colors.northernTeal,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
