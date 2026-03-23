import { useState, useEffect } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrderChecklist, submitChecklist } from '../api/sync';
import { addToQueue } from '../services/offlineQueue';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { RootStackParamList } from '../navigation';

type RouteProps = RouteProp<RootStackParamList, 'Checklist'>;
type NavProps = NativeStackNavigationProp<RootStackParamList>;

interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  checked: boolean;
  comment: string;
}

export function ChecklistScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavProps>();
  const queryClient = useQueryClient();
  const { orderId } = route.params;

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const { data: serverChecklist, isLoading } = useQuery({
    queryKey: ['checklist', orderId],
    queryFn: () => getOrderChecklist(orderId),
  });

  useEffect(() => {
    if (serverChecklist) {
      const checklists = (serverChecklist as { checklists?: Array<{ templateId: string; name: string; questions: Array<{ id?: string; text: string; required?: boolean }> }> }).checklists;
      if (Array.isArray(checklists) && checklists.length > 0) {
        const questions = checklists.flatMap(cl =>
          (cl.questions || []).map((q: { id?: string; text: string; required?: boolean }) => ({
            id: q.id || String(Math.random()),
            label: q.text || q.id || '',
            required: q.required || false,
            checked: false,
            comment: '',
          }))
        );
        if (questions.length > 0) {
          setItems(questions);
          return;
        }
      }
    }
    if (!isLoading && items.length === 0) {
      setItems([
        { id: '1', label: 'Säkerhetsutrustning kontrollerad', required: true, checked: false, comment: '' },
        { id: '2', label: 'Arbetsområde inspekterat', required: true, checked: false, comment: '' },
        { id: '3', label: 'Material och verktyg kontrollerade', required: true, checked: false, comment: '' },
        { id: '4', label: 'Kund informerad om arbetet', required: false, checked: false, comment: '' },
        { id: '5', label: 'Städning efter arbete', required: true, checked: false, comment: '' },
        { id: '6', label: 'Slutkontroll utförd', required: true, checked: false, comment: '' },
      ]);
    }
  }, [serverChecklist, isLoading]);

  const toggleItem = (id: string) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, checked: !item.checked } : item
    ));
  };

  const updateComment = (id: string, comment: string) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, comment } : item
    ));
  };

  const allRequiredChecked = items.filter(i => i.required).every(i => i.checked);
  const completedCount = items.filter(i => i.checked).length;

  const handleSave = async () => {
    if (!allRequiredChecked) {
      Alert.alert('Obligatoriska punkter', 'Alla obligatoriska punkter måste bockas av');
      return;
    }
    setIsSaving(true);
    const checklistData = items.map(i => ({
      id: i.id,
      label: i.label,
      checked: i.checked,
      comment: i.comment || undefined,
    }));
    try {
      await submitChecklist(orderId, checklistData);
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['checklist', orderId] });
      Alert.alert('Klart', 'Checklistan sparad');
      navigation.goBack();
    } catch {
      await addToQueue({
        type: 'inspection',
        payload: { orderId, checklist: checklistData },
      });
      Alert.alert('Sparad offline', 'Checklistan sparas lokalt');
      navigation.goBack();
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.deepOceanBlue} />
        <Text style={styles.loadingText}>Laddar checklista...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Checklista</Text>
      <Text style={styles.subtitle}>
        {completedCount}/{items.length} punkter avklarade
      </Text>

      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(completedCount / Math.max(items.length, 1)) * 100}%` }]} />
      </View>

      <View style={styles.itemList}>
        {items.map((item) => (
          <View key={item.id} style={styles.checklistItem}>
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => toggleItem(item.id)}
              data-testid={`button-check-${item.id}`}
            >
              <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
                {item.checked && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <View style={styles.labelContainer}>
                <Text style={[styles.itemLabel, item.checked && styles.itemLabelChecked]}>
                  {item.label}
                </Text>
                {item.required && (
                  <Text style={styles.requiredBadge}>Obligatorisk</Text>
                )}
              </View>
            </TouchableOpacity>
            <TextInput
              style={styles.commentInput}
              value={item.comment}
              onChangeText={(text) => updateComment(item.id, text)}
              placeholder="Kommentar (valfritt)..."
              placeholderTextColor={colors.mountainGray}
              data-testid={`input-comment-${item.id}`}
            />
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.saveButton, !allRequiredChecked && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={isSaving || !allRequiredChecked}
        data-testid="button-save-checklist"
      >
        {isSaving ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.saveButtonText}>Spara checklista</Text>
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
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.arcticIce,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: colors.mountainGray,
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
    marginBottom: spacing.md,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.auroraGreen,
    borderRadius: 4,
  },
  itemList: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  checklistItem: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    minHeight: 44,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.sm,
    borderWidth: 2,
    borderColor: colors.mountainGray,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  checkboxChecked: {
    backgroundColor: colors.auroraGreen,
    borderColor: colors.auroraGreen,
  },
  checkmark: {
    color: colors.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  labelContainer: {
    flex: 1,
  },
  itemLabel: {
    fontSize: fontSize.md,
    color: colors.midnightNavy,
    fontWeight: '500',
  },
  itemLabelChecked: {
    textDecorationLine: 'line-through',
    color: colors.mountainGray,
  },
  requiredBadge: {
    fontSize: fontSize.xs,
    color: colors.error,
    fontWeight: '600',
    marginTop: 2,
  },
  commentInput: {
    backgroundColor: colors.arcticIce,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.midnightNavy,
    minHeight: 36,
  },
  saveButton: {
    backgroundColor: colors.northernTeal,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
