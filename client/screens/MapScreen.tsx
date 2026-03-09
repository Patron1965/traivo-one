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
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useAuth } from '../context/AuthContext';
import type { Order } from '../types';

let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;
let Callout: any = null;

try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
  Callout = maps.Callout;
} catch (e) {}

interface RouteStep {
  geometry: { type: string; coordinates: number[][] };
  distance: number;
  duration: number;
}

interface RouteLeg {
  distance: number;
  duration: number;
  steps?: RouteStep[];
}

interface RouteData {
  waypoints: { location: [number, number]; waypointIndex: number }[];
  trips: { geometry: { type: string; coordinates: number[][] }; distance: number; duration: number; legs?: RouteLeg[] }[];
  fallback?: boolean;
  optimized?: boolean;
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

function getMarkerColor(order: Order): string {
  if (order.status === 'completed') return Colors.success;
  if (order.status === 'in_progress' || order.status === 'on_site') return Colors.secondary;
  if (order.status === 'dispatched') return Colors.warning;
  if (order.status === 'failed') return Colors.danger;
  if (order.priority === 'urgent') return Colors.danger;
  return Colors.primary;
}

function CustomMarker({ order, index, onDetailPress }: { order: Order; index: number; onDetailPress: () => void }) {
  const color = getMarkerColor(order);
  return (
    <Marker
      coordinate={{ latitude: order.latitude, longitude: order.longitude }}
      anchor={{ x: 0.5, y: 1 }}
    >
      <View style={styles.customMarkerContainer}>
        <View style={[styles.markerCircle, { backgroundColor: color }]}>
          <Text style={styles.markerNumber}>{index + 1}</Text>
        </View>
        <View style={styles.markerTriangle}>
          <View style={[styles.markerArrow, { borderTopColor: color }]} />
        </View>
        <View style={styles.markerLabel}>
          <Text style={styles.markerLabelText} numberOfLines={1}>{order.customerName}</Text>
        </View>
      </View>
      {Callout ? (
        <Callout tooltip onPress={onDetailPress}>
          <View style={styles.calloutContainer}>
            <View style={styles.calloutHeader}>
              <View style={[styles.calloutIndex, { backgroundColor: color }]}>
                <Text style={styles.calloutIndexText}>{index + 1}</Text>
              </View>
              <View style={styles.calloutHeaderText}>
                <Text style={styles.calloutTitle}>{order.customerName}</Text>
                <Text style={styles.calloutOrderNum}>{order.orderNumber}</Text>
              </View>
            </View>
            <View style={styles.calloutDivider} />
            <View style={styles.calloutRow}>
              <Feather name="map-pin" size={12} color={Colors.textSecondary} />
              <Text style={styles.calloutDetail}>{order.address}, {order.city}</Text>
            </View>
            {order.scheduledTimeStart ? (
              <View style={styles.calloutRow}>
                <Feather name="clock" size={12} color={Colors.textSecondary} />
                <Text style={styles.calloutDetail}>{order.scheduledTimeStart} ({order.estimatedDuration} min)</Text>
              </View>
            ) : null}
            <View style={styles.calloutAction}>
              <Text style={styles.calloutActionText}>Visa detaljer</Text>
              <Feather name="chevron-right" size={14} color={Colors.primary} />
            </View>
          </View>
        </Callout>
      ) : null}
    </Marker>
  );
}

export function MapScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const mapRef = useRef<any>(null);
  const [legendExpanded, setLegendExpanded] = useState(false);
  const { currentPosition } = useGpsTracking();
  const { startPosition } = useAuth();

  const routeOrigin = useMemo(() => {
    if (startPosition) {
      return { latitude: startPosition.latitude, longitude: startPosition.longitude, isStartOfDay: true };
    }
    if (currentPosition?.latitude && currentPosition?.longitude) {
      return { latitude: currentPosition.latitude, longitude: currentPosition.longitude, isStartOfDay: false };
    }
    return null;
  }, [startPosition, currentPosition?.latitude, currentPosition?.longitude]);

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const activeOrders = useMemo(
    () => (orders?.filter(o => o.status !== 'cancelled') || []).sort((a, b) => a.sortOrder - b.sortOrder),
    [orders]
  );

  const coordsParam = useMemo(() => {
    if (activeOrders.length === 0) return null;
    const parts: string[] = [];
    if (routeOrigin && routeOrigin.latitude && routeOrigin.longitude) {
      parts.push(`${routeOrigin.longitude},${routeOrigin.latitude}`);
    }
    activeOrders.forEach(o => {
      if (o.latitude && o.longitude && o.latitude !== 0 && o.longitude !== 0) {
        parts.push(`${o.longitude},${o.latitude}`);
      }
    });
    if (parts.length < 2) return null;
    const result = parts.join(';');
    return result.length > 0 ? result : null;
  }, [activeOrders, routeOrigin]);

  const hasDriverStart = !!routeOrigin;

  const { data: routeData, isLoading: routeLoading, isError: routeError } = useQuery<RouteData>({
    queryKey: ['/api/mobile/route', coordsParam],
    queryFn: async () => {
      if (!coordsParam) throw new Error('No coords');
      return apiRequest('GET', `/api/mobile/route?coords=${encodeURIComponent(coordsParam)}`);
    },
    enabled: !!coordsParam,
    staleTime: 300000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  const roadPolyline = useMemo(() => {
    if (!routeData?.trips?.[0]) return null;
    const trip = routeData.trips[0];
    if (trip.geometry?.coordinates && trip.geometry.coordinates.length > 1) {
      return trip.geometry.coordinates.map((c: number[]) => ({
        latitude: c[1],
        longitude: c[0],
      }));
    }
    return null;
  }, [routeData]);

  const optimizedOrders = useMemo(() => {
    if (!routeData?.waypoints || routeData.waypoints.length < 1) return activeOrders;
    const driverOffset = hasDriverStart ? 1 : 0;
    const orderWaypoints = routeData.waypoints.slice(driverOffset);
    if (orderWaypoints.length !== activeOrders.length) return activeOrders;
    const result = new Array<Order>(activeOrders.length);
    orderWaypoints.forEach((wp, inputIdx) => {
      const targetIdx = wp.waypointIndex - driverOffset;
      if (inputIdx < activeOrders.length && targetIdx >= 0 && targetIdx < activeOrders.length) {
        result[targetIdx] = activeOrders[inputIdx];
      }
    });
    if (result.some(o => !o)) return activeOrders;
    return result;
  }, [activeOrders, routeData, hasDriverStart]);

  const legTimes = useMemo(() => {
    if (!routeData?.trips?.[0]?.legs) return null;
    return routeData.trips[0].legs.map(leg => ({
      distance: leg.distance,
      duration: leg.duration,
    }));
  }, [routeData]);

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
      if (routeOrigin) {
        coords.push({ latitude: routeOrigin.latitude, longitude: routeOrigin.longitude });
      }
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: {
            top: headerHeight + 60,
            right: 40,
            bottom: tabBarHeight + 120,
            left: 40,
          },
          animated: true,
        });
      }, 500);
    }
  }, [activeOrders.length, routeOrigin?.latitude, routeOrigin?.longitude]);

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
          <>
            <Polyline
              coordinates={roadPolyline}
              strokeColor="rgba(234, 88, 12, 0.2)"
              strokeWidth={10}
              geodesic
            />
            <Polyline
              coordinates={roadPolyline}
              strokeColor={Colors.primary}
              strokeWidth={4}
              geodesic
            />
          </>
        ) : fallbackCoordinates.length > 1 ? (
          <Polyline
            coordinates={fallbackCoordinates}
            strokeColor={Colors.primaryLight}
            strokeWidth={3}
            lineDashPattern={[10, 5]}
            geodesic
          />
        ) : null}

        {routeOrigin ? (
          <Marker
            coordinate={{ latitude: routeOrigin.latitude, longitude: routeOrigin.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.startMarkerContainer}>
              <View style={[styles.startMarkerCircle, routeOrigin.isStartOfDay ? styles.startOfDayCircle : null]}>
                <Feather name={routeOrigin.isStartOfDay ? 'flag' : 'navigation'} size={14} color="#fff" />
              </View>
              <Text style={styles.startMarkerLabel}>{routeOrigin.isStartOfDay ? 'Dagstart' : 'Start'}</Text>
            </View>
          </Marker>
        ) : null}

        {displayOrders.map((order, idx) => (
          <CustomMarker
            key={order.id}
            order={order}
            index={idx}
            onDetailPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
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
        ) : routeError && coordsParam ? (
          <View style={styles.legendRow}>
            <Feather name="alert-circle" size={16} color={Colors.warning} />
            <ThemedText variant="caption" color={Colors.textSecondary}>
              Rutten kunde inte beräknas just nu
            </ThemedText>
          </View>
        ) : routeData?.fallback ? (
          <View style={styles.legendRow}>
            <Feather name="map-pin" size={16} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.textSecondary}>
              Visar ungefärlig rutt
            </ThemedText>
          </View>
        ) : totalDistance != null && totalDuration != null ? (
          <Pressable onPress={() => setLegendExpanded(!legendExpanded)}>
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
                <Feather name={legendExpanded ? 'chevron-down' : 'chevron-up'} size={16} color={Colors.textMuted} style={{ marginLeft: 4 }} />
              </View>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                {displayOrders.length} stopp - optimerad rutt
              </ThemedText>

              {legendExpanded && legTimes ? (
                <View style={styles.legList}>
                  {displayOrders.map((order, idx) => {
                    const legOffset = hasDriverStart ? idx + 1 : idx;
                    const leg = legTimes[legOffset - 1] || (idx === 0 && hasDriverStart ? legTimes[0] : null);
                    return (
                      <View key={order.id} style={styles.legItem}>
                        <View style={[styles.legDot, { backgroundColor: getMarkerColor(order) }]}>
                          <Text style={styles.legDotText}>{idx + 1}</Text>
                        </View>
                        <View style={styles.legInfo}>
                          <Text style={styles.legName} numberOfLines={1}>{order.customerName}</Text>
                          <Text style={styles.legTime}>{order.scheduledTimeStart || '--:--'}</Text>
                        </View>
                        {leg ? (
                          <View style={styles.legDuration}>
                            <Feather name="truck" size={10} color={Colors.textMuted} />
                            <Text style={styles.legDurationText}>{formatRouteDuration(leg.duration)}</Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          </Pressable>
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
  customMarkerContainer: {
    alignItems: 'center',
  },
  markerCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  markerNumber: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  markerTriangle: {
    marginTop: -2,
  },
  markerArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  markerLabel: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginTop: 1,
    maxWidth: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1,
    elevation: 2,
  },
  markerLabelText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
  },
  startMarkerContainer: {
    alignItems: 'center',
  },
  startMarkerCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#27AE60',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  startOfDayCircle: {
    backgroundColor: Colors.primary,
    elevation: 4,
  },
  startMarkerLabel: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#27AE60',
    marginTop: 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  calloutContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    minWidth: 220,
    maxWidth: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  calloutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calloutIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calloutIndexText: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  calloutHeaderText: {
    flex: 1,
  },
  calloutTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: Colors.text,
  },
  calloutOrderNum: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
  },
  calloutDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 8,
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  calloutDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  calloutAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  calloutActionText: {
    fontSize: 13,
    color: Colors.primary,
    fontFamily: 'Inter_600SemiBold',
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
    maxHeight: 300,
  },
  legendContent: {
    alignItems: 'center',
    gap: 4,
    width: '100%',
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
  legList: {
    width: '100%',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 6,
  },
  legItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  legDotText: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
  },
  legInfo: {
    flex: 1,
  },
  legName: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  legTime: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
  },
  legDuration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legDurationText: {
    fontSize: 10,
    color: Colors.textMuted,
    fontFamily: 'Inter_400Regular',
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
