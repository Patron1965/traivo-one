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
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitInspections } from '../api/sync';
import { addToQueue } from '../services/offlineQueue';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { InspectionItem } from '../types';
import type { RootStackParamList } from '../navigation';

const DEFAULT_POINTS = [
  'Allmänt skick',
  'Renhet',
  'Funktion',
  'Säkerhet',
  'Tillgänglighet',
];

const STATUS_OPTIONS: Array<{ value: InspectionItem['status']; label: string; color: string; icon: string }> = [
  { value: 'ok', label: 'OK', color: colors.auroraGreen, icon: '✅' },
  { value: 'warning', label: 'Varning', color: colors.warning, icon: '⚠️' },
  { value: 'fail', label: 'Underkänd', color: colors.error, icon: '❌' },
];

type InspectionRouteProps = RouteProp<RootStackParamList, 'Inspection'>;
type InspectionNavProps = NativeStackNavigationProp<RootStackParamList>;

export function InspectionScreen() {
  const route = useRoute<InspectionRouteProps>();
  const navigation = useNavigation<InspectionNavProps>();
  const queryClient = useQueryClient();
  const { orderId } = route.params;

  const [inspections, setInspections] = useState<InspectionItem[]>(
    DEFAULT_POINTS.map((cat) => ({ category: cat, status: 'ok' as const, comment: '' }))
  );

  const mutation = useMutation({
    mutationFn: () => submitInspections(orderId, inspections),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      Alert.alert('Klart', 'Inspektion sparad');
      navigation.goBack();
    },
    onError: async () => {
      await addToQueue({
        type: 'inspection',
        payload: { orderId, inspections },
      });
      Alert.alert('Sparad offline', 'Inspektion sparas lokalt');
      navigation.goBack();
    },
  });

  const updateInspection = (index: number, updates: Partial<InspectionItem>) => {
    setInspections((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Inspektionsformulär</Text>

      {inspections.map((item, index) => (
        <View key={index} style={styles.inspectionCard}>
          <Text style={styles.categoryName}>{item.category}</Text>

          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.statusButton,
                  item.status === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color },
                ]}
                onPress={() => updateInspection(index, { status: opt.value })}
                data-testid={`button-inspection-${index}-${opt.value}`}
              >
                <Text style={styles.statusIcon}>{opt.icon}</Text>
                <Text style={[styles.statusLabel, item.status === opt.value && { color: opt.color, fontWeight: '700' }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {item.status !== 'ok' && (
            <TextInput
              style={styles.commentInput}
              value={item.comment}
              onChangeText={(text) => updateInspection(index, { comment: text })}
              placeholder="Kommentar..."
              placeholderTextColor={colors.mountainGray}
              multiline
              data-testid={`input-inspection-comment-${index}`}
            />
          )}
        </View>
      ))}

      <TouchableOpacity
        style={styles.submitButton}
        onPress={() => mutation.mutate()}
        disabled={mutation.isPending}
        data-testid="button-submit-inspection"
      >
        {mutation.isPending ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.submitButtonText}>Spara inspektion</Text>
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
    marginBottom: spacing.xl,
  },
  inspectionCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  categoryName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.midnightNavy,
    marginBottom: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  statusIcon: {
    fontSize: 16,
  },
  statusLabel: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    fontWeight: '500',
  },
  commentInput: {
    backgroundColor: colors.arcticIce,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.midnightNavy,
    marginTop: spacing.md,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: colors.northernTeal,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    justifyContent: 'center',
  },
  submitButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
