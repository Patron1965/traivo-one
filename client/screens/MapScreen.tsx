import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, Platform, Text, ActivityIndicator } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
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

interface RouteData {
  waypoints: { location: [number, number]; waypointIndex: number }[];
  trips: { geometry: { type: string; coordinates: number[][] }; distance: number; duration: number }[];
}

function formatRouteDistance(meters: number): string {
  const km = meters / 1000;
  if (km < 1) return `${Math.round(meters)} m`;
  return `${km.toFixed(1)} km`;
}

function formatRouteDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function MapScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const mapRef = useRef<any>(null);

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const activeOrders = useMemo(
    () => (orders?.filter(o => o.status !== 'cancelled') || []).sort((a, b) => a.sortOrder - b.sortOrder),
    [orders]
  );

  const coordsParam = useMemo(() => {
    if (activeOrders.length < 2) return null;
    return activeOrders.map(o => `${o.longitude},${o.latitude}`).join(';');
  }, [activeOrders]);

  const { data: routeData, isLoading: routeLoading } = useQuery<RouteData>({
    queryKey: ['/api/mobile/route', coordsParam],
    queryFn: async () => {
      if (!coordsParam) throw new Error('No coords');
      return apiRequest('GET', `/api/mobile/route?coords=${coordsParam}`);
    },
    enabled: !!coordsParam,
    staleTime: 300000,
    retry: 1,
  });

  const roadPolyline = useMemo(() => {
    if (!routeData?.trips?.[0]?.geometry?.coordinates) return null;
    return routeData.trips[0].geometry.coordinates.map((c: number[]) => ({
      latitude: c[1],
      longitude: c[0],
    }));
  }, [routeData]);

  const optimizedOrders = useMemo(() => {
    if (!routeData?.waypoints || routeData.waypoints.length !== activeOrders.length) return activeOrders;
    const result = new Array<Order>(activeOrders.length);
    routeData.waypoints.forEach((wp, inputIdx) => {
      if (inputIdx < activeOrders.length && wp.waypointIndex < activeOrders.length) {
        result[wp.waypointIndex] = activeOrders[inputIdx];
      }
    });
    if (result.some(o => !o)) return activeOrders;
    return result;
  }, [activeOrders, routeData]);

  const fallbackCoordinates = useMemo(
    () => activeOrders.map(o => ({ latitude: o.latitude, longitude: o.longitude })),
    [activeOrders]
  );

  const totalDistance = routeData?.trips?.[0]?.distance;
  const totalDuration = routeData?.trips?.[0]?.duration;

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
            bottom: tabBarHeight + 80,
            left: 40,
          },
          animated: true,
        });
      }, 500);
    }
  }, [activeOrders.length]);

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
          {(routeData ? optimizedOrders : activeOrders).map((order, idx) => (
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
          {totalDistance != null && totalDuration != null ? (
            <View style={styles.webRouteSummary}>
              <Feather name="navigation" size={16} color={Colors.secondary} />
              <ThemedText variant="caption" color={Colors.textSecondary}>
                {formatRouteDistance(totalDistance)} - {formatRouteDuration(totalDuration)}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  const displayOrders = routeData ? optimizedOrders : activeOrders;

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
        {roadPolyline ? (
          <Polyline
            coordinates={roadPolyline}
            strokeColor={Colors.primary}
            strokeWidth={4}
          />
        ) : fallbackCoordinates.length > 1 ? (
          <Polyline
            coordinates={fallbackCoordinates}
            strokeColor={Colors.primaryLight}
            strokeWidth={3}
            lineDashPattern={[10, 5]}
          />
        ) : null}
        {displayOrders.map((order, idx) => (
          <Marker
            key={order.id}
            coordinate={{
              latitude: order.latitude,
              longitude: order.longitude,
            }}
            title={`${idx + 1}. ${order.customerName}`}
            description={order.address}
            pinColor={getMarkerColor(order)}
            onCalloutPress={() =>
              navigation.navigate('OrderDetail', { orderId: order.id })
            }
          />
        ))}
      </MapView>

      <View style={[styles.legend, { bottom: tabBarHeight + Spacing.lg }]}>
        {routeLoading ? (
          <View style={styles.legendRow}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.textSecondary}>
              Beräknar rutt...
            </ThemedText>
          </View>
        ) : totalDistance != null && totalDuration != null ? (
          <View style={styles.legendContent}>
            <View style={styles.legendRow}>
              <Feather name="navigation" size={16} color={Colors.secondary} />
              <ThemedText variant="body" style={styles.legendMainText}>
                {formatRouteDistance(totalDistance)}
              </ThemedText>
              <View style={styles.legendDivider} />
              <Feather name="clock" size={16} color={Colors.secondary} />
              <ThemedText variant="body" style={styles.legendMainText}>
                {formatRouteDuration(totalDuration)}
              </ThemedText>
            </View>
            <ThemedText variant="caption" color={Colors.textSecondary}>
              {displayOrders.length} stopp - optimerad rutt
            </ThemedText>
          </View>
        ) : (
          <ThemedText variant="caption" color={Colors.textSecondary}>
            {activeOrders.length} stopp på rutten
          </ThemedText>
        )}
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
  legendContent: {
    alignItems: 'center',
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  legendMainText: {
    fontFamily: 'Inter_700Bold',
  },
  legendDivider: {
    width: 1,
    height: 16,
    backgroundColor: Colors.borderLight,
    marginHorizontal: Spacing.xs,
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
  webRouteSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
});
