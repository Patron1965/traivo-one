import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  TextInput,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { getWorkOrderDetails, updateOrderStatus, addOrderNote } from '../api/workOrders';
import type { RootStackParamList } from '../navigation';
import type { OrderStatusUpdate } from '../types';

type RouteProps = RouteProp<RootStackParamList, 'OrderDetails'>;

export function OrderDetailsScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { orderId } = route.params;
  
  const [notes, setNotes] = useState('');
  const [showNotesInput, setShowNotesInput] = useState(false);
  const [generalNote, setGeneralNote] = useState('');
  const [showGeneralNoteInput, setShowGeneralNoteInput] = useState(false);

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getWorkOrderDetails(orderId),
  });

  const statusMutation = useMutation({
    mutationFn: ({ status, notes }: { status: OrderStatusUpdate; notes?: string }) =>
      updateOrderStatus(orderId, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['myOrders'] });
      Alert.alert('Klart', 'Status uppdaterad');
      if (showNotesInput) {
        setShowNotesInput(false);
        setNotes('');
      }
    },
    onError: () => {
      Alert.alert('Fel', 'Kunde inte uppdatera status');
    },
  });

  const handleStatusUpdate = (status: OrderStatusUpdate) => {
    if (status === 'ej_utford') {
      setShowNotesInput(true);
    } else {
      statusMutation.mutate({ status });
    }
  };

  const handleSubmitWithNotes = () => {
    if (!notes.trim()) {
      Alert.alert('Fel', 'Ange en anledning');
      return;
    }
    statusMutation.mutate({ status: 'ej_utford', notes: notes.trim() });
  };

  const noteMutation = useMutation({
    mutationFn: (note: string) => addOrderNote(orderId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      Alert.alert('Klart', 'Anteckning sparad');
      setShowGeneralNoteInput(false);
      setGeneralNote('');
    },
    onError: () => {
      Alert.alert('Fel', 'Kunde inte spara anteckning');
    },
  });

  const handleAddNote = () => {
    if (!generalNote.trim()) {
      Alert.alert('Fel', 'Ange en anteckning');
      return;
    }
    noteMutation.mutate(generalNote.trim());
  };

  const openMaps = () => {
    if (!order?.objectAddress) return;

    const address = encodeURIComponent(order.objectAddress);
    const url = Platform.select({
      ios: `maps:0,0?q=${address}`,
      android: `geo:0,0?q=${address}`,
    });

    if (url) {
      Linking.openURL(url).catch(() => {
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${address}`);
      });
    }
  };

  const callCustomer = () => {
    if (!order?.customerPhone) {
      Alert.alert('Info', 'Inget telefonnummer tillgängligt');
      return;
    }
    Linking.openURL(`tel:${order.customerPhone}`);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Kunde inte ladda uppdraget</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.retryText}>Tillbaka</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const status = order.orderStatus;
  const execStatus = order.executionStatus;
  const canStart = (status === 'planerad_resurs' || status === 'planerad_las' || status === 'skapad') && execStatus !== 'started' && execStatus !== 'completed';
  const canComplete = execStatus === 'started' || status === 'planerad_resurs' || status === 'planerad_las';
  const isCompleted = status === 'utford' || execStatus === 'completed';
  const isCancelled = status === 'avbruten';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>{order.title}</Text>
        {order.description && (
          <Text style={styles.description}>{order.description}</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Plats</Text>
        <View style={styles.infoCard}>
          <Text style={styles.addressText}>{order.objectAddress || 'Ingen adress'}</Text>
          {order.objectName && (
            <Text style={styles.objectName}>{order.objectName}</Text>
          )}
          <TouchableOpacity style={styles.actionButton} onPress={openMaps}>
            <Text style={styles.actionButtonText}>Navigera hit</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Kund</Text>
        <View style={styles.infoCard}>
          <Text style={styles.customerName}>{order.customerName || 'Okänd kund'}</Text>
          {order.customerPhone && (
            <TouchableOpacity style={styles.phoneButton} onPress={callCustomer}>
              <Text style={styles.phoneText}>{order.customerPhone}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Detaljer</Text>
        <View style={styles.infoCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Beräknad tid</Text>
            <Text style={styles.detailValue}>{order.estimatedDuration} minuter</Text>
          </View>
          {order.scheduledStartTime && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Planerad start</Text>
              <Text style={styles.detailValue}>{order.scheduledStartTime}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Typ</Text>
            <Text style={styles.detailValue}>{order.orderType}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Anteckningar</Text>
          {!showGeneralNoteInput && !isCompleted && !isCancelled && (
            <TouchableOpacity
              style={styles.addNoteButton}
              onPress={() => setShowGeneralNoteInput(true)}
            >
              <Text style={styles.addNoteButtonText}>+ Lägg till</Text>
            </TouchableOpacity>
          )}
        </View>
        {order.notes ? (
          <View style={styles.infoCard}>
            <Text style={styles.notesText}>{order.notes}</Text>
          </View>
        ) : !showGeneralNoteInput ? (
          <View style={styles.infoCard}>
            <Text style={styles.emptyNotesText}>Inga anteckningar</Text>
          </View>
        ) : null}
        
        {showGeneralNoteInput && (
          <>
            <TextInput
              style={styles.notesInput}
              value={generalNote}
              onChangeText={setGeneralNote}
              placeholder="Skriv anteckning..."
              placeholderTextColor="#999"
              multiline
              numberOfLines={3}
            />
            <View style={styles.notesButtons}>
              <TouchableOpacity
                style={[styles.noteButton, styles.cancelButton]}
                onPress={() => {
                  setShowGeneralNoteInput(false);
                  setGeneralNote('');
                }}
              >
                <Text style={styles.cancelButtonText}>Avbryt</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.noteButton, styles.submitButton]}
                onPress={handleAddNote}
                disabled={noteMutation.isPending}
              >
                {noteMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitButtonText}>Spara</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {showNotesInput && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Anledning till ej utförd</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Ange anledning..."
            placeholderTextColor="#999"
            multiline
            numberOfLines={3}
          />
          <View style={styles.notesButtons}>
            <TouchableOpacity
              style={[styles.noteButton, styles.cancelButton]}
              onPress={() => {
                setShowNotesInput(false);
                setNotes('');
              }}
            >
              <Text style={styles.cancelButtonText}>Avbryt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.noteButton, styles.submitButton]}
              onPress={handleSubmitWithNotes}
              disabled={statusMutation.isPending}
            >
              {statusMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Spara</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!showNotesInput && (
        <View style={styles.actions}>
          {canStart && (
            <TouchableOpacity
              style={[styles.statusButton, styles.startButton]}
              onPress={() => handleStatusUpdate('paborjad')}
              disabled={statusMutation.isPending}
            >
              {statusMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.statusButtonText}>Starta uppdrag</Text>
              )}
            </TouchableOpacity>
          )}

          {canComplete && (
            <>
              <TouchableOpacity
                style={[styles.statusButton, styles.completeButton]}
                onPress={() => handleStatusUpdate('utford')}
                disabled={statusMutation.isPending}
              >
                {statusMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.statusButtonText}>Markera som klar</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusButton, styles.failButton]}
                onPress={() => handleStatusUpdate('ej_utford')}
                disabled={statusMutation.isPending}
              >
                <Text style={styles.statusButtonText}>Ej utförd</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#2563eb',
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '500',
  },
  section: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  addNoteButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#2563eb',
    borderRadius: 6,
  },
  addNoteButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyNotesText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  addressText: {
    fontSize: 16,
    color: '#1a1a1a',
    marginBottom: 4,
  },
  objectName: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  phoneButton: {
    paddingVertical: 4,
  },
  phoneText: {
    fontSize: 15,
    color: '#2563eb',
    fontWeight: '500',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  notesText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  notesInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: '#1a1a1a',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  notesButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  noteButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#e5e5e5',
  },
  cancelButtonText: {
    color: '#333',
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#2563eb',
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  actions: {
    gap: 12,
    marginTop: 16,
  },
  statusButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#f59e0b',
  },
  completeButton: {
    backgroundColor: '#10b981',
  },
  failButton: {
    backgroundColor: '#ef4444',
  },
  statusButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
