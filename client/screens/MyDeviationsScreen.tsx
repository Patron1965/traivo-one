import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Pressable } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';
import { DEVIATION_CATEGORIES, type DeviationWithOrder, type DeviationCategory } from '../types';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

const CATEGORY_ICONS: Record<string, string> = {
  blocked_access: 'slash', damaged_container: 'alert-triangle', wrong_waste: 'x-circle',
  overloaded: 'arrow-up-circle', broken_container: 'tool', wrong_address: 'map-pin',
  contamination: 'alert-octagon', overfilled: 'arrow-up', missing_container: 'search', other: 'more-horizontal',
};

export function MyDeviationsScreen({ navigation }: any) {
  const styles = useThemedStyles(createMyDeviationsStyles);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ items: DeviationWithOrder[]; total: number }>({
    queryKey: ['/api/mobile/deviations/mine'],
  });

  const deviations = data?.items || [];

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const categoryCounts: Record<string, number> = {};
  for (const d of deviations) {
    const cat = d.category || 'other';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl, paddingHorizontal: Spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <ThemedText variant="heading" color={Colors.primary}>{deviations.length}</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>Totalt</ThemedText>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <ThemedText variant="heading" color={Colors.warning}>
                {Object.keys(categoryCounts).length}
              </ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>Kategorier</ThemedText>
            </View>
          </View>
          {Object.keys(categoryCounts).length > 0 ? (
            <View style={styles.categoryTags}>
              {Object.entries(categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([cat, count]) => (
                  <View key={cat} style={styles.categoryTag}>
                    <ThemedText variant="caption" color={Colors.primary}>
                      {DEVIATION_CATEGORIES[cat as DeviationCategory] || cat} ({count})
                    </ThemedText>
                  </View>
                ))}
            </View>
          ) : null}
        </Card>

        {isLoading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : deviations.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Feather name="check-circle" size={32} color={Colors.success} />
            <ThemedText variant="body" color={Colors.textMuted} style={{ marginTop: Spacing.sm }}>
              Inga avvikelser rapporterade
            </ThemedText>
          </Card>
        ) : (
          deviations.map((deviation, index) => (
            <Pressable
              key={deviation.id || index}
              onPress={() => {
                if (deviation.orderId) {
                  navigation.navigate('OrderDetail', { orderId: deviation.orderId });
                }
              }}
              testID={`deviation-${deviation.id || index}`}
            >
              <Card style={styles.deviationCard}>
                <View style={styles.deviationHeader}>
                  <View style={styles.categoryRow}>
                    <View style={styles.categoryIconCircle}>
                      <Feather
                        name={(CATEGORY_ICONS[deviation.category] || 'alert-circle') as any}
                        size={14}
                        color={Colors.primary}
                      />
                    </View>
                    <ThemedText variant="label">
                      {DEVIATION_CATEGORIES[deviation.category as DeviationCategory] || deviation.category || 'Avvikelse'}
                    </ThemedText>
                  </View>
                  {deviation.orderNumber ? (
                    <View style={styles.orderBadge}>
                      <ThemedText variant="caption" color={Colors.info}>{deviation.orderNumber}</ThemedText>
                    </View>
                  ) : null}
                </View>

                <ThemedText variant="body" color={Colors.textSecondary} numberOfLines={2} style={styles.deviationDesc}>
                  {deviation.description}
                </ThemedText>

                <View style={styles.deviationMeta}>
                  {deviation.customerName ? (
                    <View style={styles.metaItem}>
                      <Feather name="briefcase" size={12} color={Colors.textMuted} />
                      <ThemedText variant="caption" color={Colors.textMuted}>{deviation.customerName}</ThemedText>
                    </View>
                  ) : null}
                  <View style={styles.metaItem}>
                    <Feather name="calendar" size={12} color={Colors.textMuted} />
                    <ThemedText variant="caption" color={Colors.textMuted}>
                      {formatDate(deviation.createdAt)} {formatTime(deviation.createdAt)}
                    </ThemedText>
                  </View>
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const createMyDeviationsStyles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summaryCard: { marginBottom: Spacing.lg },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xl },
  summaryItem: { alignItems: 'center' },
  summaryDivider: { width: 1, height: 40, backgroundColor: Colors.textMuted + '30' },
  categoryTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.md },
  categoryTag: {
    backgroundColor: Colors.primary + '15', paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  emptyCard: { alignItems: 'center', padding: Spacing.xl },
  deviationCard: { marginBottom: Spacing.sm },
  deviationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  categoryIconCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary + '15', justifyContent: 'center', alignItems: 'center',
  },
  orderBadge: {
    backgroundColor: Colors.info + '15', paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  deviationDesc: { marginBottom: Spacing.sm },
  deviationMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
