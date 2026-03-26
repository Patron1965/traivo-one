import React from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Card } from '../Card';
import { StatusBadge } from '../StatusBadge';
import { Colors } from '../../constants/theme';
import { estimateTravelMinutes, formatTravelTime } from '../../lib/travel-time';
import styles from '../../screens/HomeScreen.styles';
import type { Order, OrderStatus } from '../../types';

function getStatusBorderColor(status: OrderStatus): string {
  switch (status) {
    case 'ny': return Colors.statusNy;
    case 'planerad': return Colors.statusPlanerad;
    case 'planerad_resurs': return Colors.statusPlaneradResurs;
    case 'paborjad': return Colors.statusPaborjad;
    case 'utford': return Colors.statusUtford;
    case 'avslutad': return Colors.statusAvslutad;
    case 'planned': return Colors.statusPlanned;
    case 'dispatched': return Colors.statusDispatched;
    case 'en_route': return Colors.statusEnRoute;
    case 'on_site': return Colors.statusOnSite;
    case 'in_progress': return Colors.statusInProgress;
    case 'completed': return Colors.statusCompleted;
    case 'failed': return Colors.statusFailed;
    case 'cancelled': return Colors.statusCancelled;
    default: return Colors.statusPlanned;
  }
}

interface OrderPreviewListProps {
  orders: Order[];
  ordersLoading: boolean;
  navigation: any;
  currentPosition: { latitude: number; longitude: number } | null | undefined;
}

export function OrderPreviewList({ orders, ordersLoading, navigation, currentPosition }: OrderPreviewListProps) {
  return (
    <>
      <View style={styles.sectionHeader}>
        <ThemedText variant="subheading">
          Kommande uppdrag
        </ThemedText>
        <Pressable
          onPress={() => navigation.navigate('OrdersTab')}
          testID="button-view-all-orders"
        >
          <ThemedText variant="body" color={Colors.primaryLight}>
            Visa alla
          </ThemedText>
        </Pressable>
      </View>

      {ordersLoading ? (
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      ) : (
        orders.slice(0, 3).map((order) => (
          <Pressable
            key={order.id}
            onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
            testID={`card-order-${order.id}`}
          >
            <Card style={[styles.orderCard, order.isLocked ? styles.lockedCard : null]}>
              <View style={[styles.statusStripe, { backgroundColor: getStatusBorderColor(order.status) }]} />
              <View style={styles.orderInner}>
                <View style={styles.orderHeader}>
                  <View style={styles.orderInfo}>
                    <View style={styles.orderNumberRow}>
                      <ThemedText variant="label">{order.orderNumber}</ThemedText>
                      {order.executionCodes && order.executionCodes.length > 0 ? (
                        <View style={styles.execCodesRow}>
                          {order.executionCodes.map(ec => (
                            <View key={ec.id} style={styles.execCodeBadge}>
                              <ThemedText variant="caption" color={Colors.primaryLight} style={styles.execCodeText}>
                                {ec.code}
                              </ThemedText>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                    <ThemedText variant="subheading" numberOfLines={1}>
                      {order.customerName}
                    </ThemedText>
                  </View>
                  <View style={styles.statusColumn}>
                    <StatusBadge status={order.status} size="sm" />
                    {order.isLocked ? (
                      <Feather name="lock" size={14} color={Colors.danger} />
                    ) : null}
                  </View>
                </View>
                <View style={styles.orderDetails}>
                  <View style={styles.orderDetailRow}>
                    <Feather name="map-pin" size={14} color={Colors.textSecondary} />
                    <ThemedText variant="body" color={Colors.textSecondary} numberOfLines={1} style={{ flex: 1 }}>
                      {order.address}, {order.city}
                    </ThemedText>
                    {(() => {
                      const travelMin = estimateTravelMinutes(
                        currentPosition?.latitude, currentPosition?.longitude,
                        order.latitude, order.longitude
                      );
                      const travelStr = formatTravelTime(travelMin);
                      return travelStr ? (
                        <View style={styles.travelBadge}>
                          <Feather name="navigation" size={10} color={Colors.primary} />
                          <ThemedText variant="caption" color={Colors.primary} style={styles.travelText}>
                            {travelStr}
                          </ThemedText>
                        </View>
                      ) : null;
                    })()}
                  </View>
                  {order.scheduledTimeStart ? (
                    <View style={styles.orderDetailRow}>
                      <Feather name="clock" size={14} color={Colors.textSecondary} />
                      <ThemedText variant="body" color={Colors.textSecondary}>
                        {order.scheduledTimeStart} - {order.scheduledTimeEnd}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>

                {order.subSteps && order.subSteps.length > 0 ? (
                  <View style={styles.progressSection}>
                    <View style={styles.progressBarSmBg}>
                      <View style={[styles.progressBarSmFill, {
                        width: `${order.subSteps.length > 0 ? (order.subSteps.filter(s => s.completed).length / order.subSteps.length) * 100 : 0}%`
                      }]} />
                    </View>
                    <ThemedText variant="caption" color={Colors.secondary} style={styles.progressSmText}>
                      {order.subSteps.filter(s => s.completed).length}/{order.subSteps.length}
                    </ThemedText>
                  </View>
                ) : null}

                <View style={styles.badgeRow}>
                  {order.priority === 'urgent' ? (
                    <View style={styles.urgentBadge}>
                      <Feather name="alert-circle" size={12} color={Colors.danger} />
                      <ThemedText variant="caption" color={Colors.danger}>Br\u00e5dskande</ThemedText>
                    </View>
                  ) : order.priority === 'high' ? (
                    <View style={styles.highBadge}>
                      <Feather name="arrow-up" size={12} color={Colors.warning} />
                      <ThemedText variant="caption" color={Colors.warning}>H\u00f6g prioritet</ThemedText>
                    </View>
                  ) : null}

                  {order.dependencies && order.dependencies.length > 0 ? (
                    <View style={styles.dependencyBadge}>
                      <Feather name="link" size={12} color={Colors.info} />
                      <ThemedText variant="caption" color={Colors.info}>
                        {order.dependencies.length} beroende
                      </ThemedText>
                    </View>
                  ) : null}

                  {order.timeRestrictions && order.timeRestrictions.filter(r => r.isActive).length > 0 ? (
                    <View style={styles.restrictionBadge}>
                      <Feather name="clock" size={12} color={Colors.danger} />
                      <ThemedText variant="caption" color={Colors.danger}>
                        Tidsbegr\u00e4nsning
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </>
  );
}
