import React, { useState, useMemo } from 'react';
import { View, ScrollView, Pressable, Share, StyleSheet } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';
import { formatDuration } from '../lib/format';
import type { Order } from '../types';

const FINISHED_STATUSES = ['utford', 'completed', 'avslutad', 'fakturerad'];
const IMPOSSIBLE_STATUSES = ['impossible', 'failed'];

function ProgressCircle({ percentage }: { percentage: number }) {
  const clamp = Math.min(100, Math.max(0, percentage));
  const color = clamp >= 80 ? '#22C55E' : clamp >= 50 ? '#F59E0B' : '#EF4444';
  return (
    <View style={[pc.circle, { borderColor: color + '30' }]}>
      <View style={[pc.fill, { backgroundColor: color + '20' }]}>
        <ThemedText variant="title" color={color} style={pc.text}>
          {clamp}%
        </ThemedText>
      </View>
    </View>
  );
}

const pc = StyleSheet.create({
  circle: { width: 100, height: 100, borderRadius: 50, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  fill: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '800', fontSize: 28 },
});

function StatBox({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={sb.box}>
      <Feather name={icon as any} size={18} color={color} />
      <ThemedText variant="caption" color={Colors.textSecondary}>{label}</ThemedText>
      <ThemedText variant="label" color={Colors.text} style={sb.value}>{value}</ThemedText>
    </View>
  );
}

const sb = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  value: { fontWeight: '700', fontSize: FontSize.md },
});

function CollapsibleSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={cs.card}>
      <Pressable style={cs.header} onPress={() => setOpen(!open)} testID={`button-section-${title}`}>
        <Feather name={icon as any} size={18} color={Colors.primary} />
        <ThemedText variant="label" color={Colors.text} style={cs.title}>{title}</ThemedText>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.textMuted} />
      </Pressable>
      {open ? <View style={cs.content}>{children}</View> : null}
    </Card>
  );
}

const cs = StyleSheet.create({
  card: { marginBottom: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, gap: Spacing.sm },
  title: { flex: 1, fontWeight: '600' },
  content: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
});

function statusIcon(status: string): { name: string; color: string } {
  if (FINISHED_STATUSES.includes(status)) return { name: 'check-circle', color: '#22C55E' };
  if (IMPOSSIBLE_STATUSES.includes(status)) return { name: 'alert-triangle', color: '#EF4444' };
  if (status === 'cancelled') return { name: 'x-circle', color: Colors.textMuted };
  return { name: 'circle', color: '#3B82F6' };
}

export function DayReportScreen() {
  const s = useThemedStyles(createDayReportStyles);
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const today = new Date().toISOString().split('T')[0];

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const stats = useMemo(() => {
    if (!orders || orders.length === 0) return null;
    const total = orders.length;
    const finished = orders.filter(o => FINISHED_STATUSES.includes(o.status));
    const impossible = orders.filter(o => IMPOSSIBLE_STATUSES.includes(o.status));
    const remaining = orders.filter(o => !FINISHED_STATUSES.includes(o.status) && !IMPOSSIBLE_STATUSES.includes(o.status) && o.status !== 'cancelled');

    const estimatedMin = orders.reduce((sum, o) => sum + (o.estimatedDuration || o.estimatedMinutes || 0), 0);
    const actualMin = orders.reduce((sum, o) => {
      if (o.actualDuration) return sum + Math.round(o.actualDuration / 60);
      if (FINISHED_STATUSES.includes(o.status) && o.actualStartTime && o.actualEndTime) {
        const diff = new Date(o.actualEndTime).getTime() - new Date(o.actualStartTime).getTime();
        return sum + Math.round(diff / 60000);
      }
      return sum;
    }, 0);

    const photos = orders.reduce((sum, o) => sum + (o.photos?.length || 0), 0);
    const signatures = orders.filter(o => o.signatureUrl).length;

    const typeMap: Record<string, number> = {};
    orders.forEach(o => {
      const type = o.objectType || 'Övrig';
      typeMap[type] = (typeMap[type] || 0) + 1;
    });

    const materials = orders.flatMap(o =>
      (o.articles || []).filter(a => a.quantity && a.quantity > 0).map(a => ({
        orderNumber: o.orderNumber,
        name: a.name,
        quantity: a.quantity || 0,
        unit: a.unit,
      }))
    );

    const percentage = total > 0 ? Math.round((finished.length / total) * 100) : 0;

    return { total, finished, impossible, remaining, estimatedMin, actualMin, photos, signatures, typeMap, materials, percentage, orders };
  }, [orders]);

  const shareReport = async () => {
    if (!stats) return;
    const lines = [
      `DAGSRAPPORT — ${new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}`,
      '',
      `Slutförda: ${stats.finished.length}/${stats.total} (${stats.percentage}%)`,
      stats.impossible.length > 0 ? `Omöjliga: ${stats.impossible.length}` : '',
      stats.remaining.length > 0 ? `Kvar: ${stats.remaining.length}` : '',
      '',
      `Beräknad tid: ${stats.estimatedMin > 0 ? `${stats.estimatedMin} min` : 'Ej angiven'}`,
      `Faktisk tid: ${stats.actualMin > 0 ? `${stats.actualMin} min` : 'Ej registrerad'}`,
      `Foton: ${stats.photos}`,
      `Signaturer: ${stats.signatures}`,
      '',
      '--- JOBB ---',
      ...stats.orders.map(o => {
        const si = statusIcon(o.status);
        const mark = si.name === 'check-circle' ? '\u2713' : si.name === 'alert-triangle' ? '\u2717' : '\u25CB';
        return `${mark} ${o.orderNumber} — ${o.customerName} — ${o.address}`;
      }),
    ].filter(Boolean);
    await Share.share({ message: lines.join('\n') });
  };

  const dateLabel = new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={{ paddingTop: headerHeight + Spacing.sm, paddingBottom: tabBarHeight + Spacing.xl, paddingHorizontal: Spacing.lg }}
      testID="screen-DayReport"
    >
      <View style={s.headerRow}>
        <View>
          <ThemedText variant="title" color={Colors.text}>Dagsrapport</ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>{dateLabel}</ThemedText>
        </View>
        <Pressable style={s.shareBtn} onPress={shareReport} testID="button-share-report">
          <Feather name="share-2" size={20} color={Colors.primary} />
        </Pressable>
      </View>

      {!stats ? (
        <View style={s.emptyContainer}>
          <Feather name="file-text" size={48} color={Colors.textMuted} />
          <ThemedText variant="body" color={Colors.textMuted}>Inga uppdrag idag</ThemedText>
        </View>
      ) : (
        <>
          <Card style={s.progressCard}>
            <View style={s.progressRow}>
              <ProgressCircle percentage={stats.percentage} />
              <View style={s.progressInfo}>
                <ThemedText variant="subtitle" color={Colors.text} style={{ fontWeight: '700' }}>
                  {stats.finished.length} av {stats.total}
                </ThemedText>
                <ThemedText variant="caption" color={Colors.textSecondary}>uppdrag slutförda</ThemedText>
                {stats.remaining.length > 0 ? (
                  <ThemedText variant="caption" color="#3B82F6">{stats.remaining.length} kvar</ThemedText>
                ) : null}
                {stats.impossible.length > 0 ? (
                  <ThemedText variant="caption" color="#EF4444">{stats.impossible.length} omöjliga</ThemedText>
                ) : null}
              </View>
            </View>
          </Card>

          <View style={s.statsGrid}>
            <StatBox icon="clock" label="Beräknad" value={stats.estimatedMin > 0 ? `${stats.estimatedMin} min` : '–'} color="#3B82F6" />
            <StatBox icon="activity" label="Faktisk" value={stats.actualMin > 0 ? `${stats.actualMin} min` : '–'} color="#22C55E" />
            <StatBox icon="camera" label="Foton" value={`${stats.photos}`} color="#8B5CF6" />
            <StatBox icon="edit-3" label="Signaturer" value={`${stats.signatures}`} color="#F59E0B" />
          </View>

          <CollapsibleSection title="Jobbtyper" icon="trending-up">
            {Object.entries(stats.typeMap).map(([type, count]) => (
              <View key={type} style={s.listRow}>
                <ThemedText variant="body" color={Colors.text} style={{ flex: 1 }}>{type}</ThemedText>
                <ThemedText variant="label" color={Colors.primary} style={{ fontWeight: '700' }}>{count}</ThemedText>
              </View>
            ))}
          </CollapsibleSection>

          {stats.materials.length > 0 ? (
            <CollapsibleSection title="Material" icon="package">
              {stats.materials.map((m, i) => (
                <View key={`${m.orderNumber}-${m.name}-${i}`} style={s.listRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="body" color={Colors.text}>{m.name}</ThemedText>
                    <ThemedText variant="caption" color={Colors.textMuted}>{m.orderNumber}</ThemedText>
                  </View>
                  <ThemedText variant="label" color={Colors.text}>{m.quantity} {m.unit}</ThemedText>
                </View>
              ))}
            </CollapsibleSection>
          ) : null}

          <CollapsibleSection title="Alla jobb" icon="file-text">
            {stats.orders.map(o => {
              const si = statusIcon(o.status);
              return (
                <View key={o.id} style={s.jobRow}>
                  <Feather name={si.name as any} size={18} color={si.color} />
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="body" color={Colors.text} numberOfLines={1}>
                      {o.orderNumber} — {o.customerName}
                    </ThemedText>
                    <ThemedText variant="caption" color={Colors.textMuted} numberOfLines={1}>{o.address}</ThemedText>
                  </View>
                  <View style={s.jobBadges}>
                    {o.photos?.length > 0 ? <Feather name="camera" size={12} color={Colors.textMuted} /> : null}
                    {o.signatureUrl ? <Feather name="edit-3" size={12} color={Colors.textMuted} /> : null}
                  </View>
                </View>
              );
            })}
          </CollapsibleSection>
        </>
      )}
    </ScrollView>
  );
}

const createDayReportStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  shareBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.xxxl * 2,
  },
  progressCard: {
    marginBottom: Spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  progressInfo: {
    flex: 1,
    gap: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  jobBadges: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
});
