import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';

type Period = 'week' | 'month';

interface DailyBreakdown {
  date: string;
  dayLabel: string;
  travel: number;
  onSite: number;
  working: number;
}

interface PeriodData {
  totalOrders: number;
  completedOrders: number;
  failedOrders: number;
  ordersWithDeviations: number;
  ordersWithSignoff: number;
  avgTimePerOrder: number;
  avgTravelTime: number;
  avgOnSiteTime: number;
}

interface TrendData {
  orders: number;
  avgTimePerOrder: number;
  avgTravelTime: number;
  deviations: number;
  signoffs: number;
}

interface StatisticsResponse {
  currentPeriod: PeriodData;
  previousPeriod: PeriodData;
  dailyBreakdown: DailyBreakdown[];
  trends: TrendData;
  periodLabel: string;
}

export default function StatisticsScreen() {
  const styles = useThemedStyles(createStatsStyles);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>('week');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isError } = useQuery<StatisticsResponse>({
    queryKey: [`/api/mobile/statistics?period=${period}&offset=${offset}`],
  });

  const maxBarValue = React.useMemo(() => {
    if (!data?.dailyBreakdown) return 1;
    let max = 0;
    for (const day of data.dailyBreakdown) {
      const total = day.travel + day.onSite + day.working;
      if (total > max) max = total;
    }
    return max || 1;
  }, [data?.dailyBreakdown]);

  const formatMinutes = (minutes: number): string => {
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const renderTrend = (value: number) => {
    if (value === 0) return null;
    const isPositive = value > 0;
    const color = isPositive ? Colors.success : Colors.danger;
    const icon = isPositive ? 'trending-up' : 'trending-down';
    return (
      <View style={styles.trendContainer}>
        <Feather name={icon} size={14} color={color} />
        <ThemedText style={[styles.trendText, { color }]}>
          {isPositive ? '+' : ''}{Math.round(value)}%
        </ThemedText>
      </View>
    );
  };

  const renderBarChart = () => {
    if (!data?.dailyBreakdown || data.dailyBreakdown.length === 0) return null;
    const barMaxHeight = 120;

    return (
      <Card style={styles.chartCard}>
        <ThemedText variant="subheading" style={styles.sectionTitle}>
          Arbetstid per dag
        </ThemedText>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Colors.info }]} />
            <ThemedText variant="caption">Resa</ThemedText>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Colors.accent }]} />
            <ThemedText variant="caption">På plats</ThemedText>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Colors.success }]} />
            <ThemedText variant="caption">Arbete</ThemedText>
          </View>
        </View>
        <View style={styles.chartContainer}>
          {data.dailyBreakdown.map((day, index) => {
            const total = day.travel + day.onSite + day.working;
            const travelH = total > 0 ? (day.travel / maxBarValue) * barMaxHeight : 0;
            const onSiteH = total > 0 ? (day.onSite / maxBarValue) * barMaxHeight : 0;
            const workingH = total > 0 ? (day.working / maxBarValue) * barMaxHeight : 0;

            return (
              <View key={index} style={styles.barColumn}>
                <View style={[styles.barStack, { height: barMaxHeight }]}>
                  <View style={{ flex: 1 }} />
                  {workingH > 0 ? (
                    <View
                      style={[
                        styles.barSegment,
                        {
                          height: workingH,
                          backgroundColor: Colors.success,
                          borderTopLeftRadius: onSiteH === 0 && travelH === 0 ? 4 : 0,
                          borderTopRightRadius: onSiteH === 0 && travelH === 0 ? 4 : 0,
                        },
                      ]}
                    />
                  ) : null}
                  {onSiteH > 0 ? (
                    <View
                      style={[
                        styles.barSegment,
                        {
                          height: onSiteH,
                          backgroundColor: Colors.accent,
                          borderTopLeftRadius: travelH === 0 ? 4 : 0,
                          borderTopRightRadius: travelH === 0 ? 4 : 0,
                        },
                      ]}
                    />
                  ) : null}
                  {travelH > 0 ? (
                    <View
                      style={[
                        styles.barSegment,
                        {
                          height: travelH,
                          backgroundColor: Colors.info,
                          borderTopLeftRadius: 4,
                          borderTopRightRadius: 4,
                        },
                      ]}
                    />
                  ) : null}
                </View>
                <ThemedText variant="caption" style={styles.barLabel}>
                  {day.dayLabel}
                </ThemedText>
              </View>
            );
          })}
        </View>
      </Card>
    );
  };

  const cp = data?.currentPeriod;

  return (
    <View style={styles.flex} testID="screen-Statistics">
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <View style={styles.periodToggle}>
          <Pressable
            style={[
              styles.toggleButton,
              period === 'week' ? styles.toggleActive : null,
            ]}
            onPress={() => { setPeriod('week'); setOffset(0); }}
            testID="toggle-week"
          >
            <ThemedText
              style={period === 'week' ? { ...styles.toggleText, ...styles.toggleTextActive } : styles.toggleText}
            >
              Vecka
            </ThemedText>
          </Pressable>
          <Pressable
            style={[
              styles.toggleButton,
              period === 'month' ? styles.toggleActive : null,
            ]}
            onPress={() => { setPeriod('month'); setOffset(0); }}
            testID="toggle-month"
          >
            <ThemedText
              style={period === 'month' ? { ...styles.toggleText, ...styles.toggleTextActive } : styles.toggleText}
            >
              Månad
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.periodNav}>
          <Pressable
            onPress={() => setOffset((o) => o + 1)}
            style={styles.navButton}
            testID="button-prev-period"
          >
            <Feather name="chevron-left" size={22} color={Colors.text} />
          </Pressable>
          <ThemedText variant="subheading" testID="text-period-label">
            {data?.periodLabel || (period === 'week' ? 'Denna vecka' : 'Denna månad')}
          </ThemedText>
          <Pressable
            onPress={() => setOffset((o) => Math.max(0, o - 1))}
            style={[styles.navButton, offset === 0 ? styles.navDisabled : null]}
            disabled={offset === 0}
            testID="button-next-period"
          >
            <Feather
              name="chevron-right"
              size={22}
              color={offset === 0 ? Colors.textMuted : Colors.text}
            />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : isError ? (
          <Card style={styles.errorCard}>
            <Feather name="alert-circle" size={24} color={Colors.danger} />
            <ThemedText style={styles.errorText}>
              Kunde inte ladda statistik
            </ThemedText>
          </Card>
        ) : cp ? (
          <>
            {renderBarChart()}

            <View style={styles.cardsGrid}>
              <Card style={styles.statCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: Colors.infoLight }]}>
                    <Feather name="clipboard" size={18} color={Colors.info} />
                  </View>
                  {renderTrend(data?.trends?.orders ?? 0)}
                </View>
                <ThemedText variant="caption" style={styles.cardLabel}>
                  Ordrar
                </ThemedText>
                <ThemedText variant="heading" testID="text-orders-count">
                  {cp.completedOrders}/{cp.totalOrders}
                </ThemedText>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${cp.totalOrders > 0 ? Math.round((cp.completedOrders / cp.totalOrders) * 100) : 0}%`,
                        backgroundColor: Colors.success,
                      },
                    ]}
                  />
                </View>
                <ThemedText variant="caption">
                  {cp.totalOrders > 0
                    ? `${Math.round((cp.completedOrders / cp.totalOrders) * 100)}% slutförda`
                    : 'Inga ordrar'}
                </ThemedText>
              </Card>

              <Card style={styles.statCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: Colors.successLight }]}>
                    <Feather name="clock" size={18} color={Colors.success} />
                  </View>
                  {renderTrend(data?.trends?.avgTimePerOrder ?? 0)}
                </View>
                <ThemedText variant="caption" style={styles.cardLabel}>
                  Effektivitet
                </ThemedText>
                <ThemedText variant="heading" testID="text-avg-time">
                  {formatMinutes(cp.avgTimePerOrder)}
                </ThemedText>
                <ThemedText variant="caption">per order</ThemedText>
                <View style={styles.metricRow}>
                  <Feather name="navigation" size={12} color={Colors.info} />
                  <ThemedText variant="caption" style={styles.metricText}>
                    {formatMinutes(cp.avgTravelTime)} resa
                  </ThemedText>
                </View>
              </Card>

              <Card style={styles.statCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: Colors.warningLight }]}>
                    <Feather name="alert-triangle" size={18} color={Colors.warning} />
                  </View>
                  {renderTrend(data?.trends?.deviations ?? 0)}
                </View>
                <ThemedText variant="caption" style={styles.cardLabel}>
                  Avvikelser
                </ThemedText>
                <ThemedText variant="heading" testID="text-deviations-count">
                  {cp.ordersWithDeviations}
                </ThemedText>
                <ThemedText variant="caption">
                  {cp.totalOrders > 0
                    ? `${Math.round((cp.ordersWithDeviations / cp.totalOrders) * 100)}% av ordrar`
                    : ''}
                </ThemedText>
              </Card>

              <Card style={styles.statCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: '#EDE9FE' }]}>
                    <Feather name="edit-3" size={18} color="#7C3AED" />
                  </View>
                  {renderTrend(data?.trends?.signoffs ?? 0)}
                </View>
                <ThemedText variant="caption" style={styles.cardLabel}>
                  Kundkvitteringar
                </ThemedText>
                <ThemedText variant="heading" testID="text-signoffs-count">
                  {cp.ordersWithSignoff}/{cp.totalOrders}
                </ThemedText>
                <ThemedText variant="caption">
                  {cp.totalOrders > 0
                    ? `${Math.round((cp.ordersWithSignoff / cp.totalOrders) * 100)}% signerade`
                    : ''}
                </ThemedText>
              </Card>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const createStatsStyles = () => StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  periodToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.cardElevated,
    borderRadius: BorderRadius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  toggleActive: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  toggleText: {
    fontSize: FontSize.md,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  toggleTextActive: {
    color: Colors.primary,
  },
  periodNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    padding: Spacing.sm,
  },
  navDisabled: {
    opacity: 0.3,
  },
  loadingContainer: {
    paddingVertical: Spacing.xxxl,
    alignItems: 'center',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  errorText: {
    color: Colors.danger,
  },
  chartCard: {
    gap: Spacing.md,
  },
  sectionTitle: {
    marginBottom: Spacing.xs,
  },
  legendRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barStack: {
    width: '80%',
    justifyContent: 'flex-end',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barSegment: {
    width: '100%',
    minHeight: 2,
  },
  barLabel: {
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  statCard: {
    width: '47%',
    flexGrow: 1,
    gap: Spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    marginTop: Spacing.xs,
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  trendText: {
    fontSize: FontSize.xs,
    fontFamily: 'Inter_600SemiBold',
  },
  progressBar: {
    height: 6,
    backgroundColor: Colors.cardElevated,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  metricText: {
    marginLeft: 2,
  },
});
