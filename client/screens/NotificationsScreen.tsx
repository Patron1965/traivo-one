import React, { useCallback, useMemo } from 'react';
import { View, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { triggerNotification, NotificationFeedbackType } from '../lib/haptics';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import { NOTIFICATION_TYPE_CONFIG, type AppNotification, type NotificationType } from '../types';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just nu';
  if (mins < 60) return `${mins} min sedan`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} tim sedan`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Igår';
  if (days < 7) return `${days} dagar sedan`;
  return new Date(dateStr).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function getDateGroup(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (itemDate.getTime() >= today.getTime()) return 'Idag';
  if (itemDate.getTime() >= yesterday.getTime()) return 'Igår';
  return 'Tidigare';
}

interface NotificationGroup {
  title: string;
  data: AppNotification[];
}

export function NotificationsScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<{ notifications: AppNotification[]; unreadCount: number }>({
    queryKey: ['/api/mobile/notifications'],
  });

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  const groups = useMemo((): NotificationGroup[] => {
    const grouped: Record<string, AppNotification[]> = {};
    for (const n of notifications) {
      const group = getDateGroup(n.createdAt);
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(n);
    }
    const order = ['Idag', 'Igår', 'Tidigare'];
    return order.filter(g => grouped[g]).map(g => ({ title: g, data: grouped[g] }));
  }, [notifications]);

  const markReadMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/mobile/notifications/${id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications'] }),
    onError: () => triggerNotification(NotificationFeedbackType.Error),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/mobile/notifications/read-all', {}),
    onSuccess: () => {
      triggerNotification(NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications'] });
    },
    onError: () => triggerNotification(NotificationFeedbackType.Error),
  });

  const handleTap = useCallback((item: AppNotification) => {
    if (!item.read) {
      markReadMutation.mutate(item.id);
    }
    if (item.type === 'schedule_send_failed') {
      navigation.navigate('Profile');
      return;
    }
    if (item.relatedOrderId) {
      navigation.navigate('OrderDetail', { orderId: item.relatedOrderId });
    } else if (item.type === 'team_invite') {
      navigation.navigate('Team');
    }
  }, [markReadMutation, navigation]);

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        unreadCount > 0 ? (
          <Pressable
            onPress={() => markAllReadMutation.mutate()}
            style={styles.headerBtn}
            hitSlop={8}
            testID="button-mark-all-read"
          >
            {markAllReadMutation.isPending ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <ThemedText variant="caption" color={Colors.primary}>Markera alla</ThemedText>
            )}
          </Pressable>
        ) : null,
    });
  }, [navigation, unreadCount, markAllReadMutation]);

  const renderItem = useCallback(({ item }: { item: AppNotification }) => {
    const config = NOTIFICATION_TYPE_CONFIG[item.type] || NOTIFICATION_TYPE_CONFIG.system;
    const isUnread = !item.read;
    return (
      <Pressable
        style={[styles.notifItem, isUnread ? styles.notifUnread : null]}
        onPress={() => handleTap(item)}
        testID={`notification-${item.id}`}
      >
        <View style={[styles.notifIcon, { backgroundColor: config.color + '25' }]}>
          <Feather name={config.icon as any} size={20} color={config.color} />
        </View>
        <View style={styles.notifContent}>
          <View style={styles.notifHeader}>
            <ThemedText variant="label" numberOfLines={1} style={{ flex: 1, color: '#1a2a3a' }}>
              {item.title}
            </ThemedText>
            <ThemedText variant="caption" color={Colors.textSecondary} style={styles.notifTime}>
              {timeAgo(item.createdAt)}
            </ThemedText>
          </View>
          <ThemedText variant="body" color="#3d4f5f" numberOfLines={2} style={styles.notifBody}>
            {item.body}
          </ThemedText>
          <View style={styles.notifMeta}>
            <View style={[styles.typeBadge, { backgroundColor: config.color + '28' }]}>
              <ThemedText variant="caption" color={config.color} style={{ fontSize: 10, fontWeight: '600' }}>
                {config.label}
              </ThemedText>
            </View>
            {isUnread ? <View style={styles.unreadDot} /> : null}
          </View>
        </View>
        {item.relatedOrderId || item.type === 'team_invite' || item.type === 'schedule_send_failed' ? (
          <Feather name="chevron-right" size={16} color={Colors.textMuted} style={styles.chevron} />
        ) : null}
      </Pressable>
    );
  }, [handleTap]);

  const allItems = useMemo(() => {
    const result: (AppNotification | { type: 'header'; title: string })[] = [];
    for (const group of groups) {
      result.push({ type: 'header', title: group.title } as any);
      result.push(...group.data);
    }
    return result;
  }, [groups]);

  const renderListItem = useCallback(({ item }: { item: any }) => {
    if (item.type === 'header' && typeof item.title === 'string' && !item.id) {
      return (
        <ThemedText variant="label" color={Colors.textMuted} style={styles.sectionHeader}>
          {item.title}
        </ThemedText>
      );
    }
    return renderItem({ item });
  }, [renderItem]);

  if (isLoading) {
    return (
      <View style={[styles.center, { paddingTop: headerHeight + Spacing.xl }]}>
        <ActivityIndicator size="large" color={Colors.secondary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.center, { paddingTop: headerHeight + Spacing.xl }]}>
        <Feather name="wifi-off" size={48} color={Colors.textMuted} />
        <ThemedText variant="subheading" color={Colors.textMuted} style={{ marginTop: Spacing.md }}>
          Kunde inte hämta aviseringar
        </ThemedText>
        <Pressable
          style={styles.retryBtn}
          onPress={() => refetch()}
          testID="button-retry"
        >
          <Feather name="refresh-cw" size={16} color={Colors.textInverse} />
          <ThemedText variant="label" color={Colors.textInverse}>Försök igen</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {unreadCount > 0 ? (
        <View style={[styles.unreadBanner, { marginTop: headerHeight + Spacing.md }]}>
          <Feather name="bell" size={16} color={Colors.primary} />
          <ThemedText variant="label" color={Colors.primary}>
            {unreadCount} olästa aviseringar
          </ThemedText>
        </View>
      ) : null}
      <FlatList
        data={allItems}
        keyExtractor={(item: any) => item.id ? `notif-${item.id}` : `header-${item.title}`}
        renderItem={renderListItem}
        contentContainerStyle={{
          paddingTop: unreadCount > 0 ? Spacing.md : headerHeight + Spacing.md,
          paddingBottom: insets.bottom + Spacing.xl,
          paddingHorizontal: Spacing.md,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="bell-off" size={48} color={Colors.textMuted} />
            <ThemedText variant="subheading" color={Colors.textMuted} style={{ marginTop: Spacing.md }}>
              Inga aviseringar
            </ThemedText>
            <ThemedText variant="body" color={Colors.textMuted} style={{ textAlign: 'center' }}>
              Du har inga aviseringar just nu. Nya aviseringar visas här.
            </ThemedText>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  headerBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  unreadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.primary + '10',
  },
  sectionHeader: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    marginTop: Spacing.sm,
    fontSize: FontSize.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#2C3E50',
    fontWeight: '700',
  },
  notifItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  notifUnread: {
    backgroundColor: '#EBF2F8',
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifContent: {
    flex: 1,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 2,
  },
  notifTime: {
    fontSize: 11,
  },
  notifBody: {
    fontSize: FontSize.sm,
    lineHeight: 18,
    marginBottom: Spacing.xs,
  },
  notifMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  chevron: {
    marginTop: Spacing.sm,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.round,
    marginTop: Spacing.lg,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
});
