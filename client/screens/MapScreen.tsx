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
import { formatDuration } from '../lib/format';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useTeam } from '../hooks/useTeam';
import { useAuth } from '../context/AuthContext';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { useRouteOptimization } from '../hooks/useRouteOptimization';
import { useWebSocket } from '../hooks/useWebSocket';
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
  durationWithoutTraffic?: number;
  steps?: RouteStep[];
}

interface RouteData {
  waypoints: { location: [number, number]; waypointIndex: number }[];
  trips: { geometry: { type: string; coordinates: number[][] }; distance: number; duration: number; durationWithoutTraffic?: number; legs?: RouteLeg[] }[];
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

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatMapDateLabel(dateStr: string): string {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = shiftDate(today, -1);
  if (dateStr === today) return 'Idag';
  if (dateStr === yesterday) return 'Igår';
  const d = new Date(dateStr + 'T12:00:00');
  const weekday = d.toLocaleDateString('sv-SE', { weekday: 'short' });
  const day = d.getDate();
  const month = d.toLocaleDateString('sv-SE', { month: 'short' });
  return `${weekday} ${day} ${month}`;
}

function getMarkerColor(order: Order): string {
  if (order.status === 'completed' || order.status === 'utford' || order.status === 'avslutad') return Colors.success;
  if (order.status === 'in_progress' || order.status === 'on_site' || order.status === 'paborjad') return Colors.secondary;
  if (order.status === 'dispatched' || order.status === 'en_route') return Colors.warning;
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
                <Text style={styles.calloutDetail}>{order.scheduledTimeStart} ({formatDuration(order.estimatedDuration)})</Text>
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
  const [mapReady, setMapReady] = useState(false);
  const [displayPolyline, setDisplayPolyline] = useState<{latitude: number; longitude: number}[] | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [cachedRouteData, setCachedRouteData] = useState<RouteData | null>(null);
  const [cachedOrders, setCachedOrders] = useState<Order[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const todayStr = new Date().toISOString().split('T')[0];
  const maxDate = shiftDate(todayStr, 7);
  const isAtMaxDate = selectedDate >= maxDate;
  const { currentPosition } = useGpsTracking();
  const { partner } = useTeam();
  const { startPosition } = useAuth();

  const { data: breakConfig } = useQuery<{ enabled: boolean; durationMinutes: number; earliestSeconds: number; latestSeconds: number }>({
    queryKey: ['/api/mobile/break-config'],
  });
  const { cacheRouteData, getCachedRouteData, cacheOrderData, getCachedOrderData } = useOfflineSync();
  const { status: optStatus, progress: optProgress, isOptimizing, submitOptimization } = useRouteOptimization();
  const { user } = useAuth();
  const hasFittedForOptRef = useRef(false);
  const { addHandler } = useWebSocket(user?.id, user?.tenantId);

  useEffect(() => {
    const removeHandler = addHandler((event) => {
      if (event.type === 'route:optimized') {
        hasFittedForOptRef.current = false;
      }
    });
    return removeHandler;
  }, [addHandler]);

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
    queryKey: ['/api/mobile/my-orders', selectedDate],
    queryFn: () => apiRequest('GET', `/api/mobile/my-orders?date=${selectedDate}`),
  });

  const liveActiveOrders = useMemo(
    () => (orders?.filter(o => o.status !== 'cancelled') || []).sort((a, b) => {
      if (a.scheduledStartTime && b.scheduledStartTime) {
        return a.scheduledStartTime.localeCompare(b.scheduledStartTime);
      }
      return a.sortOrder - b.sortOrder;
    }),
    [orders]
  );

  const coordsParam = useMemo(() => {
    if (liveActiveOrders.length === 0) return null;
    const parts: string[] = [];
    if (routeOrigin && routeOrigin.latitude && routeOrigin.longitude) {
      parts.push(`${routeOrigin.longitude},${routeOrigin.latitude}`);
    }
    liveActiveOrders.forEach(o => {
      const lat = Number(o.latitude);
      const lng = Number(o.longitude);
      if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        parts.push(`${lng},${lat}`);
      }
    });
    if (parts.length < 2) return null;
    const result = parts.join(';');
    return result.length > 0 ? result : null;
  }, [liveActiveOrders, routeOrigin]);

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

  useEffect(() => {
    if (orders && orders.length > 0) {
      cacheOrderData(orders);
    }
  }, [orders, cacheOrderData]);

  useEffect(() => {
    if (routeData && !routeData.fallback) {
      cacheRouteData(routeData);
      if (usingCachedData) {
        setUsingCachedData(false);
        setCachedRouteData(null);
        setCachedOrders(null);
      }
    }
  }, [routeData, cacheRouteData]);

  useEffect(() => {
    const needsFallback = (routeError && !routeData) || (!orders && !routeData);
    if (needsFallback) {
      (async () => {
        const cached = await getCachedRouteData();
        const cachedOrd = await getCachedOrderData();
        if (cached || cachedOrd) {
          setUsingCachedData(true);
          if (cached) setCachedRouteData(cached);
          if (cachedOrd) setCachedOrders(cachedOrd);
        }
      })();
    }
  }, [routeError, routeData, orders, getCachedRouteData, getCachedOrderData]);

  const effectiveRouteData = routeData || (usingCachedData ? cachedRouteData : null);
  const effectiveOrders = orders || (usingCachedData ? cachedOrders : null);

  const activeOrders = useMemo(
    () => {
      const source = effectiveOrders || [];
      return source
        .filter((o: Order) => o.status !== 'cancelled')
        .filter((o: Order) => {
          const lat = Number(o.latitude);
          const lng = Number(o.longitude);
          return isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        })
        .sort((a: Order, b: Order) => a.sortOrder - b.sortOrder);
    },
    [effectiveOrders]
  );

  const roadPolyline = useMemo(() => {
    if (!effectiveRouteData?.trips?.[0]) return null;
    if (effectiveRouteData.fallback) return null;
    const trip = effectiveRouteData.trips[0];
    if (trip.geometry?.coordinates && trip.geometry.coordinates.length > 10) {
      return trip.geometry.coordinates.map((c: number[]) => ({
        latitude: c[1],
        longitude: c[0],
      }));
    }
    return null;
  }, [effectiveRouteData]);

  useEffect(() => {
    if (mapReady && roadPolyline && roadPolyline.length > 1) {
      const timer = setTimeout(() => {
        setDisplayPolyline(roadPolyline);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setDisplayPolyline(null);
    }
  }, [mapReady, roadPolyline]);

  const optimizedOrders = useMemo(() => {
    if (!effectiveRouteData?.waypoints || effectiveRouteData.waypoints.length < 1) return activeOrders;
    const driverOffset = hasDriverStart ? 1 : 0;
    const orderWaypoints = effectiveRouteData.waypoints.slice(driverOffset);
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
  }, [activeOrders, effectiveRouteData, hasDriverStart]);

  const legTimes = useMemo(() => {
    if (!effectiveRouteData?.trips?.[0]?.legs) return null;
    return effectiveRouteData.trips[0].legs.map(leg => ({
      distance: leg.distance,
      duration: leg.duration,
    }));
  }, [effectiveRouteData]);

  const fallbackCoordinates = useMemo(
    () => activeOrders.map(o => ({ latitude: o.latitude, longitude: o.longitude })),
    [activeOrders]
  );

  const totalDistance = effectiveRouteData?.trips?.[0]?.distance;
  const totalDuration = effectiveRouteData?.trips?.[0]?.duration;
  const totalDurationWithoutTraffic = effectiveRouteData?.trips?.[0]?.durationWithoutTraffic;

  const trafficDelayMinutes = useMemo(() => {
    if (totalDuration == null || totalDurationWithoutTraffic == null || totalDurationWithoutTraffic === 0) return 0;
    const delaySeconds = totalDuration - totalDurationWithoutTraffic;
    return Math.round(delaySeconds / 60);
  }, [totalDuration, totalDurationWithoutTraffic]);

  const hasSignificantTraffic = useMemo(() => {
    if (totalDuration == null || totalDurationWithoutTraffic == null || totalDurationWithoutTraffic === 0) return false;
    return totalDuration > totalDurationWithoutTraffic * 1.15;
  }, [totalDuration, totalDurationWithoutTraffic]);

  const hasFittedRef = useRef(false);

  useEffect(() => {
    if (mapRef.current && activeOrders.length > 0 && mapReady && !hasFittedRef.current) {
      hasFittedRef.current = true;
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
  }, [activeOrders.length, routeOrigin?.latitude, routeOrigin?.longitude, mapReady]);

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
          {(effectiveRouteData ? optimizedOrders : activeOrders).map((order, idx) => (
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
                {trafficDelayMinutes > 0 ? ` (ber. trafik: +${trafficDelayMinutes} min)` : ''}
              </ThemedText>
            </View>
          ) : null}
          {hasSignificantTraffic ? (
            <View style={styles.webTrafficWarning}>
              <Feather name="alert-triangle" size={14} color="#92400E" />
              <ThemedText variant="caption" color="#92400E">
                Trafikstörningar längs rutten, +{trafficDelayMinutes} min
              </ThemedText>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  const displayOrders = effectiveRouteData ? optimizedOrders : activeOrders;

  return (
    <View style={styles.container}>
      <View style={styles.mapWrapper}>
      <MapView
        ref={mapRef}
        style={styles.map}
        onMapReady={() => setMapReady(true)}
        zoomEnabled={true}
        zoomTapEnabled={true}
        zoomControlEnabled={true}
        scrollEnabled={true}
        rotateEnabled={true}
        pitchEnabled={true}
        initialRegion={{
          latitude: 59.1950,
          longitude: 17.6260,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }}
      >
        {Polyline && displayPolyline && displayPolyline.length > 1 ? (
          <Polyline
            coordinates={displayPolyline}
            strokeColor="rgba(234, 88, 12, 0.15)"
            strokeWidth={8}
            zIndex={1}
          />
        ) : null}
        {Polyline && displayPolyline && displayPolyline.length > 1 ? (
          <Polyline
            coordinates={displayPolyline}
            strokeColor="#EA580C"
            strokeWidth={3}
            zIndex={2}
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

        {partner && partner.latitude && partner.longitude && Marker ? (
          <Marker
            coordinate={{ latitude: partner.latitude, longitude: partner.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.partnerMarkerContainer}>
              <View style={styles.partnerMarkerCircle}>
                <Feather name="user" size={14} color="#fff" />
              </View>
              <Text style={styles.partnerMarkerLabel}>{partner.name?.split(' ')[0] || 'Kollega'}</Text>
            </View>
          </Marker>
        ) : null}
      </MapView>

      <View style={[styles.dateNavBar, { top: headerHeight + Spacing.sm }]}>
        <Pressable onPress={() => setSelectedDate(shiftDate(selectedDate, -1))} style={styles.dateNavBtn} testID="button-map-prev-date">
          <Feather name="chevron-left" size={20} color={Colors.primary} />
        </Pressable>
        <Pressable onPress={() => setSelectedDate(new Date().toISOString().split('T')[0])} style={styles.dateNavLabel}>
          <ThemedText variant="subheading" color={Colors.text} style={styles.dateNavText}>
            {formatMapDateLabel(selectedDate)}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => { if (!isAtMaxDate) setSelectedDate(shiftDate(selectedDate, 1)); }}
          style={[styles.dateNavBtn, isAtMaxDate ? styles.dateNavBtnDisabled : null]}
          testID="button-map-next-date"
        >
          <Feather name="chevron-right" size={20} color={isAtMaxDate ? Colors.textMuted : Colors.primary} />
        </Pressable>
      </View>

      {usingCachedData ? (
        <View style={[styles.offlineBadge, { top: headerHeight + Spacing.md + 48 }]}>
          <Feather name="wifi-off" size={12} color={Colors.textInverse} />
          <Text style={styles.offlineBadgeText}>Offline - visar cachad data</Text>
        </View>
      ) : null}

      {isOptimizing ? (
        <View style={[styles.offlineBadge, { top: headerHeight + Spacing.md + (usingCachedData ? 36 : 0), backgroundColor: Colors.secondary }]}>
          <ActivityIndicator size="small" color={Colors.textInverse} />
          <Text style={styles.offlineBadgeText}>
            Optimerar rutt...{optProgress > 0 ? ` ${optProgress}%` : ''}
          </Text>
        </View>
      ) : null}

      {!isOptimizing && activeOrders.length >= 2 ? (
        <Pressable
          testID="button-optimize-route"
          style={[styles.optimizeButton, { top: headerHeight + 8 + (usingCachedData ? 36 : 0) }]}
          onPress={() => {
            const orderIds = activeOrders.map(o => String(o.id));
            submitOptimization({
              resourceId: String(user?.id || ''),
              date: new Date().toISOString().split('T')[0],
              orderIds,
              startLat: routeOrigin?.latitude,
              startLng: routeOrigin?.longitude,
            });
          }}
        >
          <Feather name="zap" size={14} color={Colors.textInverse} />
          <Text style={styles.optimizeButtonText}>Optimera rutt</Text>
        </Pressable>
      ) : null}

      <View style={[styles.legend, { bottom: 40 }]} pointerEvents="box-none">
        {routeLoading ? (
          <View style={styles.legendRow}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.textSecondary}>
              Beräknar rutt...
            </ThemedText>
          </View>
        ) : routeError && coordsParam && !usingCachedData ? (
          <View style={styles.legendRow}>
            <Feather name="alert-circle" size={16} color={Colors.warning} />
            <ThemedText variant="caption" color={Colors.textSecondary}>
              Rutten kunde inte beräknas just nu
            </ThemedText>
          </View>
        ) : effectiveRouteData?.fallback ? (
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
                {trafficDelayMinutes > 0 ? ` (ber. trafik: +${trafficDelayMinutes} min)` : ''}
              </ThemedText>

              {legendExpanded && legTimes ? (
                <View style={styles.legList}>
                  {displayOrders.map((order, idx) => {
                    const legOffset = hasDriverStart ? idx + 1 : idx;
                    const leg = legTimes[legOffset - 1] || (idx === 0 && hasDriverStart ? legTimes[0] : null);
                    const items: React.ReactNode[] = [];

                    if (breakConfig?.enabled && idx > 0) {
                      let arrivalSec = 0;
                      for (let i = 0; i < legOffset; i++) {
                        arrivalSec += (legTimes[i]?.duration || 0) + ((displayOrders[i]?.estimatedDuration || 10) * 60);
                      }
                      const earliest = breakConfig.earliestSeconds;
                      const latest = breakConfig.latestSeconds;
                      let prevArrivalSec = 0;
                      for (let i = 0; i < legOffset - 1; i++) {
                        prevArrivalSec += (legTimes[i]?.duration || 0) + ((displayOrders[i]?.estimatedDuration || 10) * 60);
                      }
                      if (prevArrivalSec <= earliest && arrivalSec >= earliest && arrivalSec <= latest + 1800) {
                        items.push(
                          <View key={`break-${idx}`} style={styles.legItem}>
                            <View style={[styles.legDot, { backgroundColor: Colors.warning }]}>
                              <Feather name="coffee" size={10} color="#fff" />
                            </View>
                            <View style={styles.legInfo}>
                              <Text style={styles.legName}>Rast</Text>
                              <Text style={styles.legTime}>{breakConfig.durationMinutes} min</Text>
                            </View>
                          </View>
                        );
                      }
                    }

                    items.push(
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
                    return items;
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  mapWrapper: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
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
  partnerMarkerContainer: {
    alignItems: 'center',
  },
  partnerMarkerCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  partnerMarkerLabel: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: Colors.secondary,
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
    left: Spacing.md,
    right: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    maxHeight: 260,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  legendContent: {
    alignItems: 'center',
    gap: 2,
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
  webTrafficWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    width: '100%',
    marginTop: Spacing.sm,
  },
  trafficBanner: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
    zIndex: 10,
  },
  trafficBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#92400E',
  },
  dateNavBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  dateNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNavBtnDisabled: {
    opacity: 0.3,
  },
  dateNavLabel: {
    paddingHorizontal: Spacing.md,
  },
  dateNavText: {
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
  offlineBadge: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.danger,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    zIndex: 10,
  },
  offlineBadgeText: {
    color: Colors.textInverse,
    fontSize: FontSize.xs,
    fontFamily: 'Inter_600SemiBold',
  },
  optimizeButton: {
    position: 'absolute',
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.secondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  optimizeButtonText: {
    color: Colors.textInverse,
    fontSize: FontSize.xs,
    fontFamily: 'Inter_600SemiBold',
  },
});
