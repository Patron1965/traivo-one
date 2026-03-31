import React from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Colors } from '../../constants/theme';
import { openMapNavigation } from '../../lib/navigation-links';
import styles from '../../screens/HomeScreen.styles';
import type { Order } from '../../types';
import type { DistanceResult } from '../../lib/travel-time';

interface NextOrderCardProps {
  nextOrder: Order | undefined;
  nextOrderDistance: DistanceResult | null | undefined;
  navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void };
  ordersLoading: boolean;
  activeOrdersLength: number;
}

export function NextOrderCard({ nextOrder, nextOrderDistance, navigation, ordersLoading, activeOrdersLength }: NextOrderCardProps) {
  if (ordersLoading || activeOrdersLength === 0 || !nextOrder) return null;

  return (
    <View>
      <Pressable
        style={styles.nextOrderButton}
        onPress={() => navigation.navigate('OrderDetail', { orderId: nextOrder.id })}
        testID="button-next-order"
      >
        <View style={styles.nextOrderLeft}>
          <View style={styles.nextOrderIconCircle}>
            <Feather name="arrow-right-circle" size={28} color={Colors.textInverse} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText variant="subheading" color={Colors.textInverse}>
              Nästa uppdrag
            </ThemedText>
            <ThemedText variant="caption" color="rgba(255,255,255,0.8)">
              {nextOrder.customerName}
            </ThemedText>
            {nextOrder.address ? (
              <ThemedText variant="caption" color="rgba(255,255,255,0.6)" numberOfLines={1}>
                {nextOrder.address}
              </ThemedText>
            ) : null}
          </View>
        </View>
        <Feather name="chevron-right" size={24} color={Colors.textInverse} />
      </Pressable>
      {nextOrder.taskLatitude && nextOrder.taskLongitude ? (
        <View style={styles.nextOrderActions}>
          <Pressable
            style={styles.nextOrderNavButton}
            onPress={() => {
              const lat = nextOrder.taskLatitude;
              const lng = nextOrder.taskLongitude;
              if (lat && lng) {
                openMapNavigation(lat, lng, nextOrder.customerName || 'Destination');
              }
            }}
            testID="button-navigate-next"
          >
            <Feather name="navigation" size={14} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>Navigera</ThemedText>
          </Pressable>
          {nextOrderDistance?.durationMin ? (
            <View style={styles.nextOrderEta}>
              <Feather name="clock" size={12} color={Colors.textMuted} />
              <ThemedText variant="caption" color={Colors.textMuted}>
                ca {nextOrderDistance.durationMin} min ({nextOrderDistance.distanceKm} km)
              </ThemedText>
            </View>
          ) : nextOrder.estimatedMinutes ? (
            <View style={styles.nextOrderEta}>
              <Feather name="clock" size={12} color={Colors.textMuted} />
              <ThemedText variant="caption" color={Colors.textMuted}>
                ca {nextOrder.estimatedMinutes} min
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
