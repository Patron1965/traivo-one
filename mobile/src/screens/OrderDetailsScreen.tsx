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
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getWorkOrderDetails, updateOrderStatus, addOrderNote } from '../api/workOrders';
import { addToQueue } from '../services/offlineQueue';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { OrderStatusUpdate } from '../types';
import type { RootStackParamList } from '../navigation';

type RouteProps = RouteProp<RootStackParamList, 'OrderDetails'>;
type NavProps = NativeStackNavigationProp<RootStackParamList>;

export function OrderDetailsScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavProps>();
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
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      Alert.alert('Klart', 'Status uppdaterad');
      if (showNotesInput) {
        setShowNotesInput(false);
        setNotes('');
      }
    },
    onError: async (_, variables) => {
      await addToQueue({
        type: 'status_update',
        payload: { orderId, status: variables.status, notes: variables.notes },
      });
      Alert.alert('Sparad offline', 'Statusändringen sparas lokalt');
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
    onError: async (_, note) => {
      await addToQueue({
        type: 'note',
        payload: { orderId, text: note },
      });
      Alert.alert('Sparad offline', 'Anteckningen sparas lokalt');
      setShowGeneralNoteInput(false);
      setGeneralNote('');
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
        <ActivityIndicator size="large" color={colors.deepOceanBlue} />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Kunde inte ladda uppdraget</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryText}>Tillbaka</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const status = order.orderStatus;
  const execStatus = order.executionStatus;
  const canStart = (status === 'planerad_resurs' || status === 'planerad_las' || status === 'skapad') &&
    !['on_way', 'on_site', 'completed'].includes(execStatus || '');
  const canComplete = ['on_way', 'on_site'].includes(execStatus || '');
  const isCompleted = status === 'utford' || execStatus === 'completed';
  const isCancelled = status === 'avbruten';
  const isActive = ['on_way', 'on_site'].includes(execStatus || '') ||
    (status !== 'utford' && status !== 'avbruten');

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
          <Text style={styles.addressText}>📍 {order.objectAddress || 'Ingen adress'}</Text>
          {order.objectName && (
            <Text style={styles.objectName}>{order.objectName}</Text>
          )}
          {order.accessCode && (
            <Text style={styles.accessInfo}>🔑 Portkod: {order.accessCode}</Text>
          )}
          <TouchableOpacity style={styles.navButton} onPress={openMaps} data-testid="button-navigate">
            <Text style={styles.navButtonText}>🗺 Navigera hit</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Kund</Text>
        <View style={styles.infoCard}>
          <Text style={styles.customerName}>{order.customerName || 'Okänd kund'}</Text>
          {order.customerPhone && (
            <TouchableOpacity style={styles.phoneButton} onPress={callCustomer} data-testid="button-call-customer">
              <Text style={styles.phoneText}>📞 {order.customerPhone}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Detaljer</Text>
        <View style={styles.infoCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Beräknad tid</Text>
            <Text style={styles.detailValue}>{order.estimatedDuration} min</Text>
          </View>
          {order.scheduledStartTime && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Planerad start</Text>
              <Text style={styles.detailValue}>{order.scheduledStartTime}</Text>
            </View>
          )}
          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Typ</Text>
            <Text style={styles.detailValue}>{order.orderType}</Text>
          </View>
        </View>
      </View>

      {isActive && !isCompleted && !isCancelled && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Åtgärder</Text>
          <View style={styles.actionGrid}>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('DeviationReport', { orderId })}
              data-testid="button-deviation"
            >
              <Text style={styles.actionIcon}>⚠️</Text>
              <Text style={styles.actionLabel}>Avvikelse</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('MaterialLog', { orderId })}
              data-testid="button-material"
            >
              <Text style={styles.actionIcon}>📦</Text>
              <Text style={styles.actionLabel}>Material</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('Signature', { orderId })}
              data-testid="button-signature"
            >
              <Text style={styles.actionIcon}>✍️</Text>
              <Text style={styles.actionLabel}>Signatur</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('Inspection', { orderId })}
              data-testid="button-inspection"
            >
              <Text style={styles.actionIcon}>🔍</Text>
              <Text style={styles.actionLabel}>Inspektion</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('PhotoDocumentation', { orderId })}
              data-testid="button-photo"
            >
              <Text style={styles.actionIcon}>📸</Text>
              <Text style={styles.actionLabel}>Foto</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate('Checklist', { orderId })}
              data-testid="button-checklist"
            >
              <Text style={styles.actionIcon}>✅</Text>
              <Text style={styles.actionLabel}>Checklista</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Anteckningar</Text>
          {!showGeneralNoteInput && !isCompleted && !isCancelled && (
            <TouchableOpacity
              style={styles.addNoteButton}
              onPress={() => setShowGeneralNoteInput(true)}
              data-testid="button-add-note"
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
              placeholderTextColor={colors.mountainGray}
              multiline
              numberOfLines={3}
              data-testid="input-note"
            />
            <View style={styles.notesButtons}>
              <TouchableOpacity
                style={[styles.noteButton, styles.cancelButton]}
                onPress={() => { setShowGeneralNoteInput(false); setGeneralNote(''); }}
              >
                <Text style={styles.cancelButtonText}>Avbryt</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.noteButton, styles.submitButton]}
                onPress={handleAddNote}
                disabled={noteMutation.isPending}
                data-testid="button-save-note"
              >
                {noteMutation.isPending ? (
                  <ActivityIndicator color={colors.white} size="small" />
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
            placeholderTextColor={colors.mountainGray}
            multiline
            numberOfLines={3}
            data-testid="input-not-done-reason"
          />
          <View style={styles.notesButtons}>
            <TouchableOpacity
              style={[styles.noteButton, styles.cancelButton]}
              onPress={() => { setShowNotesInput(false); setNotes(''); }}
            >
              <Text style={styles.cancelButtonText}>Avbryt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.noteButton, styles.submitButton]}
              onPress={handleSubmitWithNotes}
              disabled={statusMutation.isPending}
              data-testid="button-submit-not-done"
            >
              {statusMutation.isPending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Spara</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!showNotesInput && (
        <View style={styles.statusActions}>
          {canStart && (
            <TouchableOpacity
              style={[styles.statusButton, styles.startButton]}
              onPress={() => handleStatusUpdate('paborjad')}
              disabled={statusMutation.isPending}
              data-testid="button-start-order"
            >
              {statusMutation.isPending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.statusButtonText}>▶ Starta uppdrag</Text>
              )}
            </TouchableOpacity>
          )}

          {canComplete && (
            <>
              <TouchableOpacity
                style={[styles.statusButton, styles.completeButton]}
                onPress={() => handleStatusUpdate('utford')}
                disabled={statusMutation.isPending}
                data-testid="button-complete-order"
              >
                {statusMutation.isPending ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.statusButtonText}>✅ Markera som klar</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusButton, styles.failButton]}
                onPress={() => handleStatusUpdate('ej_utford')}
                disabled={statusMutation.isPending}
                data-testid="button-not-done"
              >
                <Text style={styles.statusButtonText}>❌ Ej utförd</Text>
              </TouchableOpacity>
            </>
          )}

          {isCompleted && (
            <TouchableOpacity
              style={[styles.statusButton, { backgroundColor: colors.northernTeal + '20' }]}
              onPress={() => navigation.navigate('RouteFeedback')}
              data-testid="button-route-feedback"
            >
              <Text style={[styles.statusButtonText, { color: colors.northernTeal }]}>
                ⭐ Betygsätt rutt
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.arcticIce,
  },
  errorText: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
    marginBottom: spacing.lg,
  },
  retryButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.deepOceanBlue,
    borderRadius: borderRadius.sm,
  },
  retryText: {
    color: colors.white,
    fontWeight: '600',
  },
  section: {
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.mountainGray,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  addNoteButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.northernTeal,
    borderRadius: borderRadius.sm,
  },
  addNoteButtonText: {
    color: colors.white,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  infoCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
  },
  addressText: {
    fontSize: fontSize.md,
    color: colors.midnightNavy,
    marginBottom: spacing.xs,
  },
  objectName: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    marginBottom: spacing.md,
  },
  accessInfo: {
    fontSize: fontSize.sm,
    color: colors.deepOceanBlue,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  navButton: {
    backgroundColor: colors.deepOceanBlue,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  navButtonText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: fontSize.md,
  },
  customerName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.midnightNavy,
    marginBottom: spacing.sm,
  },
  phoneButton: {
    paddingVertical: spacing.xs,
  },
  phoneText: {
    fontSize: fontSize.md,
    color: colors.deepOceanBlue,
    fontWeight: '500',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.midnightNavy,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  actionCard: {
    width: '47%',
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
  },
  actionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.midnightNavy,
  },
  emptyNotesText: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    fontStyle: 'italic',
  },
  notesText: {
    fontSize: fontSize.sm,
    color: colors.midnightNavy,
    lineHeight: 20,
  },
  notesInput: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: colors.midnightNavy,
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
  },
  notesButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  noteButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: colors.border,
  },
  cancelButtonText: {
    color: colors.midnightNavy,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: colors.northernTeal,
  },
  submitButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  statusActions: {
    gap: spacing.md,
  },
  statusButton: {
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  startButton: {
    backgroundColor: colors.deepOceanBlue,
  },
  completeButton: {
    backgroundColor: colors.auroraGreen,
  },
  failButton: {
    backgroundColor: colors.statusRed,
  },
  statusButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
