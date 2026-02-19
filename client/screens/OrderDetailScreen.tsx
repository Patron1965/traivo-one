import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert, Linking, Platform } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import type { Order, OrderStatus, ORDER_STATUS_SEQUENCE } from '../types';

const STATUS_SEQUENCE: OrderStatus[] = [
  'planned', 'en_route', 'arrived', 'in_progress', 'completed',
];

export function OrderDetailScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: order, isLoading } = useQuery<Order>({
    queryKey: [`/api/mobile/orders/${orderId}`],
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: OrderStatus) =>
      apiRequest('PATCH', `/api/mobile/orders/${orderId}/status`, { status: newStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  function getNextStatus(current: OrderStatus): OrderStatus | null {
    const idx = STATUS_SEQUENCE.indexOf(current);
    if (idx === -1 || idx >= STATUS_SEQUENCE.length - 1) return null;
    return STATUS_SEQUENCE[idx + 1];
  }

  function getNextStatusLabel(status: OrderStatus): string {
    const labels: Partial<Record<OrderStatus, string>> = {
      planned: 'Starta k\u00f6rning',
      en_route: 'Markera framme',
      arrived: 'Starta arbete',
      in_progress: 'Slutf\u00f6r',
    };
    return labels[status] || 'N\u00e4sta steg';
  }

  function getNextStatusIcon(status: OrderStatus): string {
    const icons: Partial<Record<OrderStatus, string>> = {
      planned: 'navigation',
      en_route: 'map-pin',
      arrived: 'play',
      in_progress: 'check-circle',
    };
    return icons[status] || 'arrow-right';
  }

  function handleAdvanceStatus() {
    if (!order) return;
    const next = getNextStatus(order.status);
    if (next) {
      statusMutation.mutate(next);
    }
  }

  function handleDefer() {
    statusMutation.mutate('deferred');
  }

  function openNavigation() {
    if (!order) return;
    const url = Platform.select({
      ios: `maps:0,0?q=${order.latitude},${order.longitude}`,
      android: `geo:0,0?q=${order.latitude},${order.longitude}(${order.address})`,
      default: `https://www.google.com/maps/search/?api=1&query=${order.latitude},${order.longitude}`,
    });
    if (url) Linking.openURL(url);
  }

  function callContact(phone: string) {
    Linking.openURL(`tel:${phone.replace(/[\s-]/g, '')}`);
  }

  if (isLoading || !order) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <ThemedText variant="body" color={Colors.textMuted} style={styles.loading}>
          Laddar...
        </ThemedText>
      </View>
    );
  }

  const nextStatus = getNextStatus(order.status);
  const isFinished = order.status === 'completed' || order.status === 'cancelled' || order.status === 'deferred';

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: isFinished ? insets.bottom + Spacing.xl : 120 },
        ]}
      >
        <View style={styles.headerSection}>
          <ThemedText variant="label">{order.orderNumber}</ThemedText>
          <ThemedText variant="heading">{order.customerName}</ThemedText>
          <StatusBadge status={order.status} />
        </View>

        {order.priority === 'urgent' ? (
          <Card style={[styles.urgentCard]}>
            <View style={styles.urgentRow}>
              <Feather name="alert-circle" size={20} color={Colors.danger} />
              <ThemedText variant="body" color={Colors.danger}>
                Br\u00e5dskande uppdrag
              </ThemedText>
            </View>
          </Card>
        ) : null}

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Plats</ThemedText>
          <View style={styles.infoRow}>
            <Feather name="map-pin" size={16} color={Colors.primary} />
            <View style={styles.infoContent}>
              <ThemedText variant="body">{order.address}</ThemedText>
              <ThemedText variant="caption">{order.postalCode} {order.city}</ThemedText>
            </View>
          </View>
          {order.what3words ? (
            <View style={styles.infoRow}>
              <Feather name="grid" size={16} color={Colors.primary} />
              <ThemedText variant="body" color={Colors.primaryLight}>
                ///{order.what3words}
              </ThemedText>
            </View>
          ) : null}
          <Pressable style={styles.navButton} onPress={openNavigation} testID="button-navigate">
            <Feather name="navigation" size={16} color={Colors.textInverse} />
            <ThemedText variant="body" color={Colors.textInverse}>
              Navigera hit
            </ThemedText>
          </Pressable>
        </Card>

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Uppdraget</ThemedText>
          <ThemedText variant="body">{order.description}</ThemedText>
          {order.notes ? (
            <View style={styles.notesBox}>
              <Feather name="info" size={14} color={Colors.info} />
              <ThemedText variant="body" color={Colors.textSecondary}>
                {order.notes}
              </ThemedText>
            </View>
          ) : null}
          {order.scheduledTimeStart ? (
            <View style={styles.infoRow}>
              <Feather name="clock" size={16} color={Colors.primary} />
              <ThemedText variant="body">
                {order.scheduledTimeStart} - {order.scheduledTimeEnd} ({order.estimatedDuration} min)
              </ThemedText>
            </View>
          ) : null}
        </Card>

        {order.articles.length > 0 ? (
          <Card>
            <ThemedText variant="label" style={styles.sectionLabel}>Artiklar</ThemedText>
            {order.articles.map(article => (
              <View key={article.id} style={styles.articleRow}>
                <View style={styles.articleDot} />
                <ThemedText variant="body" style={styles.articleName}>
                  {article.name}
                </ThemedText>
                <ThemedText variant="body" color={Colors.textSecondary}>
                  {article.quantity} {article.unit}
                </ThemedText>
              </View>
            ))}
          </Card>
        ) : null}

        {order.contacts.length > 0 ? (
          <Card>
            <ThemedText variant="label" style={styles.sectionLabel}>Kontakter</ThemedText>
            {order.contacts.map(contact => (
              <View key={contact.id} style={styles.contactRow}>
                <View style={styles.contactInfo}>
                  <ThemedText variant="body">{contact.name}</ThemedText>
                  <ThemedText variant="caption">{contact.role}</ThemedText>
                </View>
                <Pressable
                  style={styles.callButton}
                  onPress={() => callContact(contact.phone)}
                  testID={`button-call-${contact.id}`}
                >
                  <Feather name="phone" size={16} color={Colors.secondary} />
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('ReportDeviation', { orderId: order.id })}
            testID="button-report-deviation"
          >
            <Feather name="alert-triangle" size={18} color={Colors.warning} />
            <ThemedText variant="caption" color={Colors.warning}>
              Avvikelse
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('MaterialLog', { orderId: order.id, articles: order.articles })}
            testID="button-material-log"
          >
            <Feather name="package" size={18} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>
              Material
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('CameraCapture', { orderId: order.id })}
            testID="button-camera"
          >
            <Feather name="camera" size={18} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>
              Foto
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('Signature', { orderId: order.id })}
            testID="button-signature"
          >
            <Feather name="edit-3" size={18} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>
              Signatur
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      {!isFinished ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
          {order.status !== 'new' && order.status !== 'completed' ? (
            <Pressable
              style={styles.deferButton}
              onPress={handleDefer}
              testID="button-defer"
            >
              <Feather name="x-circle" size={20} color={Colors.danger} />
            </Pressable>
          ) : null}
          {nextStatus ? (
            <Pressable
              style={styles.advanceButton}
              onPress={handleAdvanceStatus}
              disabled={statusMutation.isPending}
              testID="button-advance-status"
            >
              <Feather name={getNextStatusIcon(order.status) as any} size={20} color={Colors.textInverse} />
              <ThemedText variant="subheading" color={Colors.textInverse} style={{ fontSize: FontSize.lg }}>
                {getNextStatusLabel(order.status)}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  loading: {
    textAlign: 'center',
    paddingTop: Spacing.xxxl,
  },
  headerSection: {
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  urgentCard: {
    backgroundColor: Colors.dangerLight,
    borderColor: Colors.danger,
  },
  urgentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sectionLabel: {
    marginBottom: Spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  infoContent: {
    flex: 1,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
  },
  notesBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.infoLight,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  articleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.secondary,
  },
  articleName: {
    flex: 1,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  contactInfo: {
    flex: 1,
  },
  callButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.successLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: Spacing.sm,
  },
  secondaryAction: {
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  deferButton: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.dangerLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  advanceButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 56,
    backgroundColor: Colors.secondary,
    borderRadius: BorderRadius.lg,
  },
});
