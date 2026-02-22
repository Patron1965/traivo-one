import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Pressable, Platform, Text } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import type { Order } from '../types';

let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;

try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
} catch (e) {}

export function MapScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const mapRef = useRef<any>(null);

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const activeOrders = orders?.filter(o => o.status !== 'cancelled') || [];

  useEffect(() => {
    if (mapRef.current && activeOrders.length > 0) {
      const coords = activeOrders.map(o => ({
        latitude: o.latitude,
        longitude: o.longitude,
      }));
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: {
            top: headerHeight + 60,
            right: 40,
            bottom: tabBarHeight + 60,
            left: 40,
          },
          animated: true,
        });
      }, 500);
    }
  }, [activeOrders.length]);

  const routeCoordinates = activeOrders
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(o => ({
      latitude: o.latitude,
      longitude: o.longitude,
    }));

  function getMarkerColor(order: Order): string {
    if (order.status === 'completed') return Colors.success;
    if (order.status === 'in_progress' || order.status === 'on_site') return Colors.secondary;
    if (order.status === 'dispatched') return Colors.warning;
    if (order.status === 'failed') return Colors.danger;
    if (order.priority === 'urgent') return Colors.danger;
    return Colors.primary;
  }

  if (!MapView || Platform.OS === 'web') {
    return (
      <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl }]}>
        <View style={styles.webFallback}>
          <Feather name="map" size={64} color={Colors.textMuted} />
          <ThemedText variant="heading" style={styles.fallbackTitle}>
            Kartvy
          </ThemedText>
          <ThemedText variant="body" color={Colors.textSecondary} style={styles.fallbackText}>
            Kartan visas i Expo Go på din telefon.
            {'\n'}Här är dagens rutt:
          </ThemedText>
          {activeOrders.sort((a, b) => a.sortOrder - b.sortOrder).map((order, idx) => (
            <Pressable
              key={order.id}
              style={styles.webOrderItem}
              onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
            >
              <View style={[styles.webOrderNumber, { backgroundColor: getMarkerColor(order) }]}>
                <Text style={styles.webOrderNumberText}>{idx + 1}</Text>
              </View>
              <View style={styles.webOrderInfo}>
                <ThemedText variant="body">{order.customerName}</ThemedText>
                <ThemedText variant="caption">{order.address}, {order.city}</ThemedText>
              </View>
              <StatusBadge status={order.status} size="sm" />
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: 57.7089,
          longitude: 11.9746,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }}
      >
        {routeCoordinates.length > 1 ? (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor={Colors.primaryLight}
            strokeWidth={3}
            lineDashPattern={[10, 5]}
          />
        ) : null}
        {activeOrders.map((order, idx) => (
          <Marker
            key={order.id}
            coordinate={{
              latitude: order.latitude,
              longitude: order.longitude,
            }}
            title={order.customerName}
            description={order.address}
            pinColor={getMarkerColor(order)}
            onCalloutPress={() =>
              navigation.navigate('OrderDetail', { orderId: order.id })
            }
          />
        ))}
      </MapView>

      <View style={[styles.legend, { bottom: tabBarHeight + Spacing.lg }]}>
        <ThemedText variant="caption" color={Colors.textSecondary}>
          {activeOrders.length} stopp på rutten
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  map: {
    flex: 1,
  },
  legend: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  webFallback: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  fallbackTitle: {
    marginTop: Spacing.lg,
  },
  fallbackText: {
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  webOrderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  webOrderNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webOrderNumberText: {
    color: Colors.textInverse,
    fontFamily: 'Inter_700Bold',
    fontSize: FontSize.sm,
  },
  webOrderInfo: {
    flex: 1,
  },
});
