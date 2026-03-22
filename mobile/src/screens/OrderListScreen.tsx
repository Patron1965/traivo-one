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
import { useAuth } from '../context/AuthContext';
import type { WorkOrder } from '../types';
import type { RootStackParamList } from '../navigation';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'OrderList'>;

function getStatusColor(status: string): string {
  switch (status) {
    case 'planerad_resurs':
    case 'planerad_las':
    case 'planerad_pre':
      return '#2563eb';
    case 'utford':
      return '#10b981';
    case 'avbruten':
      return '#ef4444';
    case 'skapad':
      return '#6b7280';
    case 'fakturerad':
      return '#8b5cf6';
    case 'omojlig':
      return '#dc2626';
    default:
      return '#6b7280';
  }
}

function getStatusText(status: string): string {
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
    case 'omojlig':
      return 'Omöjlig';
    default:
      return status;
  }
}

function OrderCard({ order, onPress }: { order: WorkOrder; onPress: () => void }) {
  const statusColor = getStatusColor(order.orderStatus);
  
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {order.title}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>{getStatusText(order.orderStatus)}</Text>
        </View>
      </View>
      
      <View style={styles.cardBody}>
        <Text style={styles.addressText} numberOfLines={2}>
          {order.objectAddress || 'Ingen adress'}
        </Text>
        {order.objectName && (
          <Text style={styles.objectName}>{order.objectName}</Text>
        )}
      </View>
      
      <View style={styles.cardFooter}>
        <Text style={styles.durationText}>
          {order.estimatedDuration} min
        </Text>
        {order.scheduledStartTime && (
          <Text style={styles.timeText}>{order.scheduledStartTime}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function OrderListScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { resource, logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const { data, isLoading, refetch, error } = useQuery({
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
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Laddar uppdrag...</Text>
      </View>
    );
  }

  const orders = data?.orders || [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hej, {resource?.name}</Text>
          <Text style={styles.dateText}>
            {new Date().toLocaleDateString('sv-SE', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Text>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutButton}>
          <Text style={styles.logoutText}>Logga ut</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {orders.length} uppdrag idag
        </Text>
      </View>

      {orders.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Inga uppdrag idag</Text>
          <Text style={styles.emptySubtitle}>
            Dra nedåt för att uppdatera
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  greeting: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  dateText: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  logoutText: {
    fontSize: 14,
    color: '#ef4444',
    fontWeight: '500',
  },
  summary: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  cardBody: {
    marginBottom: 12,
  },
  addressText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  objectName: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  durationText: {
    fontSize: 13,
    color: '#666',
  },
  timeText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#2563eb',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});
