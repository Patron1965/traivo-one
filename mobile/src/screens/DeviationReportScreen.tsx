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
import { reportDeviation } from '../api/sync';
import { addToQueue } from '../services/offlineQueue';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { RootStackParamList } from '../navigation';

const DEVIATION_TYPES = [
  { value: 'blocked_access', label: 'Blockerad åtkomst', icon: '🚫' },
  { value: 'damaged_container', label: 'Skadat kärl', icon: '💥' },
  { value: 'wrong_waste', label: 'Felaktigt avfall', icon: '⚠️' },
  { value: 'overloaded', label: 'Överlastat', icon: '📦' },
  { value: 'other', label: 'Övrigt', icon: '📝' },
];

type DeviationRouteProps = RouteProp<RootStackParamList, 'DeviationReport'>;
type DeviationNavProps = NativeStackNavigationProp<RootStackParamList>;

export function DeviationReportScreen() {
  const route = useRoute<DeviationRouteProps>();
  const navigation = useNavigation<DeviationNavProps>();
  const queryClient = useQueryClient();
  const { orderId } = route.params;

  const [type, setType] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () => reportDeviation(orderId, { type, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      Alert.alert('Klart', 'Avvikelsen har rapporterats');
      navigation.goBack();
    },
    onError: async () => {
      await addToQueue({
        type: 'deviation',
        payload: { orderId, type, description, category: type, severity: 'medium' },
      });
      Alert.alert('Sparad offline', 'Avvikelsen sparas lokalt och synkas när nät finns');
      navigation.goBack();
    },
  });

  const handleSubmit = () => {
    if (!type) {
      Alert.alert('Fel', 'Välj typ av avvikelse');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Fel', 'Beskriv avvikelsen');
      return;
    }
    mutation.mutate();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Typ av avvikelse</Text>
      <View style={styles.typeGrid}>
        {DEVIATION_TYPES.map((dt) => (
          <TouchableOpacity
            key={dt.value}
            style={[styles.typeCard, type === dt.value && styles.typeCardSelected]}
            onPress={() => setType(dt.value)}
            data-testid={`button-deviation-${dt.value}`}
          >
            <Text style={styles.typeIcon}>{dt.icon}</Text>
            <Text style={[styles.typeLabel, type === dt.value && styles.typeLabelSelected]}>
              {dt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Beskrivning</Text>
      <TextInput
        style={styles.textInput}
        value={description}
        onChangeText={setDescription}
        placeholder="Beskriv avvikelsen..."
        placeholderTextColor={colors.mountainGray}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        data-testid="input-deviation-description"
      />

      <TouchableOpacity
        style={[styles.submitButton, (!type || !description.trim()) && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={mutation.isPending || !type || !description.trim()}
        data-testid="button-submit-deviation"
      >
        {mutation.isPending ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.submitButtonText}>Rapportera avvikelse</Text>
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
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.mountainGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
    marginTop: spacing.lg,
  },
  typeGrid: {
    gap: spacing.md,
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeCardSelected: {
    borderColor: colors.northernTeal,
    backgroundColor: colors.northernTeal + '10',
  },
  typeIcon: {
    fontSize: 24,
    marginRight: spacing.md,
  },
  typeLabel: {
    fontSize: fontSize.md,
    color: colors.midnightNavy,
    fontWeight: '500',
  },
  typeLabelSelected: {
    color: colors.northernTeal,
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: colors.midnightNavy,
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  submitButton: {
    backgroundColor: colors.statusOrange,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xxl,
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
