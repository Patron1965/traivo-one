import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getMyWorkOrders } from '../api/workOrders';
import type { WorkOrder } from '../types';
import type { RootStackParamList } from '../navigation';
import { colors, spacing, fontSize, borderRadius } from '../theme';

type FilterType = 'alla' | 'ej_startade' | 'pagaende' | 'klara';

const FILTERS: Array<{ value: FilterType; label: string }> = [
  { value: 'alla', label: 'Alla' },
  { value: 'ej_startade', label: 'Ej startade' },
  { value: 'pagaende', label: 'Pågående' },
  { value: 'klara', label: 'Klara' },
];

function getStatusColor(status: string): string {
  switch (status) {
    case 'planerad_resurs':
    case 'planerad_las':
    case 'planerad_pre':
      return colors.statusBlue;
    case 'utford':
      return colors.statusGreen;
    case 'avbruten':
      return colors.statusRed;
    case 'skapad':
      return colors.statusGray;
    case 'fakturerad':
      return colors.northernTeal;
    case 'omojlig':
      return colors.statusRed;
    default:
      return colors.statusGray;
  }
}

function getStatusText(status: string, execStatus?: string): string {
  if (execStatus === 'on_way') return 'På väg';
  if (execStatus === 'on_site') return 'På plats';
  if (execStatus === 'completed') return 'Utförd';
  switch (status) {
    case 'planerad_resurs':
    case 'planerad_las':
    case 'planerad_pre':
      return 'Planerad';
    case 'utford':
      return 'Utförd';
    case 'avbruten':
      return 'Ej utförd';
    case 'skapad':
      return 'Utkast';
    case 'fakturerad':
      return 'Fakturerad';
    default:
      return status;
  }
}

function filterOrders(orders: WorkOrder[], filter: FilterType): WorkOrder[] {
  switch (filter) {
    case 'ej_startade':
      return orders.filter(o =>
        !['utford', 'avbruten'].includes(o.orderStatus) &&
        !['on_way', 'on_site', 'completed'].includes(o.executionStatus || '')
      );
    case 'pagaende':
      return orders.filter(o =>
        ['on_way', 'on_site'].includes(o.executionStatus || '')
      );
    case 'klara':
      return orders.filter(o =>
        o.orderStatus === 'utford' || o.executionStatus === 'completed'
      );
    default:
      return orders;
  }
}

function OrderCard({ order, onPress }: { order: WorkOrder; onPress: () => void }) {
  const statusColor = getStatusColor(order.orderStatus);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} data-testid={`card-order-${order.id}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {order.title}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {getStatusText(order.orderStatus, order.executionStatus)}
          </Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.addressText} numberOfLines={2}>
          📍 {order.objectAddress || 'Ingen adress'}
        </Text>
        {order.objectName && (
          <Text style={styles.objectName}>{order.objectName}</Text>
        )}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.durationText}>
          ⏱ {order.estimatedDuration} min
        </Text>
        {order.scheduledStartTime && (
          <Text style={styles.timeText}>{order.scheduledStartTime}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function OrderListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('alla');

  const today = new Date().toISOString().split('T')[0];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['myOrders', today],
    queryFn: () => getMyWorkOrders(today),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleOrderPress = (order: WorkOrder) => {
    navigation.navigate('OrderDetails', { orderId: order.id });
  };

  if (isLoading && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.deepOceanBlue} />
        <Text style={styles.loadingText}>Laddar uppdrag...</Text>
      </View>
    );
  }

  const allOrders = data?.orders || [];
  const orders = filterOrders(allOrders, filter);

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterButton, filter === f.value && styles.filterButtonActive]}
            onPress={() => setFilter(f.value)}
            data-testid={`filter-${f.value}`}
          >
            <Text style={[styles.filterText, filter === f.value && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {orders.length} uppdrag {filter !== 'alla' ? `(${FILTERS.find(f => f.value === filter)?.label})` : 'idag'}
        </Text>
      </View>

      {orders.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Inga uppdrag</Text>
          <Text style={styles.emptySubtitle}>
            {filter !== 'alla' ? 'Inga uppdrag matchar filtret' : 'Dra nedåt för att uppdatera'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <OrderCard order={item} onPress={() => handleOrderPress(item)} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.deepOceanBlue} />
          }
        />
      )}
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
    backgroundColor: colors.arcticIce,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: colors.mountainGray,
  },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.arcticIce,
  },
  filterButtonActive: {
    backgroundColor: colors.deepOceanBlue,
  },
  filterText: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    fontWeight: '500',
  },
  filterTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
  summaryBar: {
    backgroundColor: colors.deepOceanBlue,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  summaryText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.white,
  },
  list: {
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.midnightNavy,
    flex: 1,
    marginRight: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  cardBody: {
    marginBottom: spacing.md,
  },
  addressText: {
    fontSize: fontSize.sm,
    color: colors.midnightNavy,
    lineHeight: 20,
  },
  objectName: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    marginTop: spacing.xs,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  durationText: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
  },
  timeText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.deepOceanBlue,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
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
    textAlign: 'center',
  },
});
