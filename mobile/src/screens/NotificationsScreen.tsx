import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../api/notifications';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { Notification } from '../types';

const typeIcons: Record<string, string> = {
  new_order: '📋',
  schedule_change: '🔄',
  message: '💬',
  system: '⚙️',
  job_updated: '🔔',
};

function NotificationCard({
  notification,
  onPress,
}: {
  notification: Notification;
  onPress: () => void;
}) {
  const icon = typeIcons[notification.type] || '🔔';
  const timeAgo = getTimeAgo(notification.createdAt);

  return (
    <TouchableOpacity
      style={[styles.card, !notification.read && styles.cardUnread]}
      onPress={onPress}
      data-testid={`notification-${notification.id}`}
    >
      <Text style={styles.icon}>{icon}</Text>
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, !notification.read && styles.cardTitleUnread]}>
          {notification.title}
        </Text>
        <Text style={styles.cardMessage} numberOfLines={2}>
          {notification.message}
        </Text>
        <Text style={styles.cardTime}>{timeAgo}</Text>
      </View>
      {!notification.read && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just nu';
  if (minutes < 60) return `${minutes} min sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h sedan`;
  const days = Math.floor(hours / 24);
  return `${days}d sedan`;
}

export function NotificationsScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications(),
  });

  const readMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unreadNotifications'] });
    },
  });

  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unreadNotifications'] });
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    setRefreshing(false);
  }, [queryClient]);

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.deepOceanBlue} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {unreadCount > 0 && (
        <TouchableOpacity
          style={styles.readAllButton}
          onPress={() => readAllMutation.mutate()}
          disabled={readAllMutation.isPending}
          data-testid="button-read-all"
        >
          <Text style={styles.readAllText}>
            Markera alla som lästa ({unreadCount})
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationCard
            notification={item}
            onPress={() => {
              if (!item.read) readMutation.mutate(item.id);
            }}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.deepOceanBlue} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyTitle}>Inga notifieringar</Text>
            <Text style={styles.emptySubtitle}>Du har inga aviseringar just nu</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  readAllButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  readAllText: {
    fontSize: fontSize.sm,
    color: colors.northernTeal,
    fontWeight: '600',
  },
  list: {
    padding: spacing.lg,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    alignItems: 'flex-start',
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: colors.northernTeal,
  },
  icon: {
    fontSize: 22,
    marginRight: spacing.md,
    marginTop: 2,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.midnightNavy,
    marginBottom: spacing.xs,
  },
  cardTitleUnread: {
    fontWeight: '700',
  },
  cardMessage: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  cardTime: {
    fontSize: fontSize.xs,
    color: colors.mountainGray,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.northernTeal,
    marginTop: spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl * 2,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.midnightNavy,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
  },
});
