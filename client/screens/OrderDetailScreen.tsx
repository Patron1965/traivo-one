import React, { useState } from 'react';
import {
  View, ScrollView, Pressable, StyleSheet, Linking, Platform,
  TextInput, ActivityIndicator, Modal
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import type { Order, OrderStatus, TimeRestriction, SubStep, OrderNote } from '../types';
import { TIME_RESTRICTION_LABELS } from '../types';

const STATUS_SEQUENCE: OrderStatus[] = [
  'planned', 'en_route', 'arrived', 'in_progress', 'completed',
];

export function OrderDetailScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState('');
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [aiTipLoading, setAiTipLoading] = useState(false);
  const [showAiTip, setShowAiTip] = useState(false);

  const { data: order, isLoading } = useQuery<Order>({
    queryKey: [`/api/mobile/orders/${orderId}`],
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: OrderStatus) =>
      apiRequest('PATCH', `/api/mobile/orders/${orderId}/status`, { status: newStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const subStepMutation = useMutation({
    mutationFn: ({ stepId, completed }: { stepId: number; completed: boolean }) =>
      apiRequest('PATCH', `/api/mobile/orders/${orderId}/substeps/${stepId}`, { completed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  const noteMutation = useMutation({
    mutationFn: (text: string) =>
      apiRequest('POST', `/api/mobile/orders/${orderId}/notes`, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      setNoteText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  function getNextStatus(current: OrderStatus): OrderStatus | null {
    const idx = STATUS_SEQUENCE.indexOf(current);
    if (idx === -1 || idx >= STATUS_SEQUENCE.length - 1) return null;
    return STATUS_SEQUENCE[idx + 1];
  }

  function getNextStatusLabel(status: OrderStatus): string {
    const labels: Partial<Record<OrderStatus, string>> = {
      planned: 'Starta k\u00f6rning',
      en_route: 'Markera framme',
      arrived: 'Starta arbete',
      in_progress: 'Slutf\u00f6r',
    };
    return labels[status] || 'N\u00e4sta steg';
  }

  function getNextStatusIcon(status: OrderStatus): string {
    const icons: Partial<Record<OrderStatus, string>> = {
      planned: 'navigation',
      en_route: 'map-pin',
      arrived: 'play',
      in_progress: 'check-circle',
    };
    return icons[status] || 'arrow-right';
  }

  async function handleAiTip() {
    if (!order) return;
    setAiTipLoading(true);
    setShowAiTip(true);
    try {
      const result = await apiRequest('POST', '/api/mobile/ai/chat', {
        message: `Ge mig en kort sammanfattning och praktiska tips för detta uppdrag: ${order.orderNumber} hos ${order.customerName} på ${order.address}. Uppdraget: ${order.description}. ${order.notes ? 'Not: ' + order.notes : ''} ${order.priority === 'urgent' ? 'OBS: Brådskande!' : ''}`,
        context: { currentOrder: order },
      });
      setAiTip(result.response || 'Inga tips tillgängliga.');
    } catch {
      setAiTip('Kunde inte hämta AI-tips just nu. Försök igen senare.');
    } finally {
      setAiTipLoading(false);
    }
  }

  function handleAdvanceStatus() {
    if (!order) return;
    const next = getNextStatus(order.status);
    if (next) {
      statusMutation.mutate(next);
    }
  }

  function handleDefer() {
    statusMutation.mutate('deferred');
  }

  function openNavigation() {
    if (!order) return;
    const url = Platform.select({
      ios: `maps:0,0?q=${order.latitude},${order.longitude}`,
      android: `geo:0,0?q=${order.latitude},${order.longitude}(${order.address})`,
      default: `https://www.google.com/maps/search/?api=1&query=${order.latitude},${order.longitude}`,
    });
    if (url) Linking.openURL(url);
  }

  function callContact(phone: string) {
    Linking.openURL(`tel:${phone.replace(/[\s-]/g, '')}`);
  }

  function handleAddNote() {
    const trimmed = noteText.trim();
    if (trimmed.length > 0) {
      noteMutation.mutate(trimmed);
    }
  }

  function formatNoteDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  if (isLoading || !order) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <ThemedText variant="body" color={Colors.textMuted} style={styles.loading}>
          Laddar...
        </ThemedText>
      </View>
    );
  }

  const nextStatus = getNextStatus(order.status);
  const isFinished = order.status === 'completed' || order.status === 'cancelled' || order.status === 'deferred';
  const activeRestrictions = order.timeRestrictions?.filter(r => r.isActive) || [];
  const subSteps = order.subSteps || [];
  const completedSteps = subSteps.filter(s => s.completed).length;
  const notes = order.orderNotes || [];
  const deps = order.dependencies || [];
  const execCodes = order.executionCodes || [];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: isFinished ? insets.bottom + Spacing.xl : 140 },
        ]}
      >
        <View style={styles.headerSection}>
          <View style={styles.headerTopRow}>
            <ThemedText variant="label">{order.orderNumber}</ThemedText>
            {execCodes.length > 0 ? (
              <View style={styles.execCodesRow}>
                {execCodes.map(ec => (
                  <View key={ec.id} style={styles.execCodeBadge}>
                    <ThemedText variant="caption" color={Colors.primaryLight} style={styles.execCodeText}>
                      {ec.code}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <ThemedText variant="heading">{order.customerName}</ThemedText>
          <StatusBadge status={order.status} />
        </View>

        {order.isLocked ? (
          <Card style={styles.lockedCard}>
            <View style={styles.alertRow}>
              <Feather name="lock" size={20} color={Colors.danger} />
              <View style={styles.alertTextContainer}>
                <ThemedText variant="subheading" color={Colors.danger}>
                  Uppdraget \u00e4r l\u00e5st
                </ThemedText>
                <ThemedText variant="caption" color={Colors.textSecondary}>
                  Beroende uppdrag m\u00e5ste slutf\u00f6ras f\u00f6rst
                </ThemedText>
              </View>
            </View>
          </Card>
        ) : null}

        {order.priority === 'urgent' ? (
          <Card style={styles.urgentCard}>
            <View style={styles.alertRow}>
              <Feather name="alert-circle" size={20} color={Colors.danger} />
              <ThemedText variant="body" color={Colors.danger}>
                Br\u00e5dskande uppdrag
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {activeRestrictions.length > 0 ? (
          <Card style={styles.restrictionCard}>
            <View style={styles.alertRow}>
              <Feather name="alert-triangle" size={20} color={Colors.warning} />
              <ThemedText variant="subheading" color={Colors.warning}>
                Tidsbegr\u00e4nsningar
              </ThemedText>
            </View>
            {activeRestrictions.map(r => (
              <View key={r.id} style={styles.restrictionItem}>
                <View style={styles.restrictionTypeBadge}>
                  <ThemedText variant="caption" color={Colors.danger} style={styles.restrictionTypeText}>
                    {TIME_RESTRICTION_LABELS[r.type]}
                  </ThemedText>
                </View>
                <ThemedText variant="body" color={Colors.textSecondary} style={styles.restrictionDesc}>
                  {r.description}
                </ThemedText>
              </View>
            ))}
          </Card>
        ) : null}

        {deps.length > 0 ? (
          <Card>
            <ThemedText variant="label" style={styles.sectionLabel}>Beroenden</ThemedText>
            {deps.map(dep => (
              <View key={dep.id} style={styles.depRow}>
                <Feather
                  name={dep.isBlocking ? 'lock' : 'link'}
                  size={14}
                  color={dep.isBlocking ? Colors.danger : Colors.info}
                />
                <View style={styles.depInfo}>
                  <ThemedText variant="body">
                    {dep.dependsOnOrderNumber}
                  </ThemedText>
                  <ThemedText variant="caption" color={Colors.textMuted}>
                    M\u00e5ste vara: {dep.dependsOnStatus === 'completed' ? 'Slutf\u00f6rd' : dep.dependsOnStatus}
                    {dep.isBlocking ? ' (blockerande)' : ''}
                  </ThemedText>
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Plats</ThemedText>
          <View style={styles.infoRow}>
            <Feather name="map-pin" size={16} color={Colors.primary} />
            <View style={styles.infoContent}>
              <ThemedText variant="body">{order.address}</ThemedText>
              <ThemedText variant="caption">{order.postalCode} {order.city}</ThemedText>
            </View>
          </View>
          {order.what3words ? (
            <View style={styles.infoRow}>
              <Feather name="grid" size={16} color={Colors.primary} />
              <ThemedText variant="body" color={Colors.primaryLight}>
                ///{order.what3words}
              </ThemedText>
            </View>
          ) : null}
          <Pressable style={styles.navButton} onPress={openNavigation} testID="button-navigate">
            <Feather name="navigation" size={16} color={Colors.textInverse} />
            <ThemedText variant="body" color={Colors.textInverse}>
              Navigera hit
            </ThemedText>
          </Pressable>
        </Card>

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Uppdraget</ThemedText>
          <ThemedText variant="body">{order.description}</ThemedText>
          {order.notes ? (
            <View style={styles.notesBox}>
              <Feather name="info" size={14} color={Colors.info} />
              <ThemedText variant="body" color={Colors.textSecondary}>
                {order.notes}
              </ThemedText>
            </View>
          ) : null}
          {order.scheduledTimeStart ? (
            <View style={styles.infoRow}>
              <Feather name="clock" size={16} color={Colors.primary} />
              <ThemedText variant="body">
                {order.scheduledTimeStart} - {order.scheduledTimeEnd} ({order.estimatedDuration} min)
              </ThemedText>
            </View>
          ) : null}
        </Card>

        {subSteps.length > 0 ? (
          <Card>
            <View style={styles.subStepHeader}>
              <ThemedText variant="label">Delsteg</ThemedText>
              <View style={styles.subStepProgress}>
                <ThemedText variant="caption" color={Colors.secondary}>
                  {completedSteps}/{subSteps.length}
                </ThemedText>
                <View style={styles.subStepProgressBarBg}>
                  <View
                    style={[
                      styles.subStepProgressBarFill,
                      { width: `${subSteps.length > 0 ? (completedSteps / subSteps.length) * 100 : 0}%` },
                    ]}
                  />
                </View>
              </View>
            </View>
            {subSteps.sort((a, b) => a.sortOrder - b.sortOrder).map(step => (
              <Pressable
                key={step.id}
                style={styles.subStepRow}
                onPress={() => subStepMutation.mutate({ stepId: step.id, completed: !step.completed })}
                testID={`button-substep-${step.id}`}
              >
                <View style={[styles.checkBox, step.completed ? styles.checkBoxChecked : null]}>
                  {step.completed ? (
                    <Feather name="check" size={14} color={Colors.textInverse} />
                  ) : null}
                </View>
                <View style={styles.subStepInfo}>
                  <ThemedText
                    variant="body"
                    style={step.completed ? styles.completedText : undefined}
                  >
                    {step.name}
                  </ThemedText>
                  <ThemedText variant="caption" color={Colors.textMuted}>
                    {step.articleName}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {order.articles.length > 0 ? (
          <Card>
            <ThemedText variant="label" style={styles.sectionLabel}>Artiklar</ThemedText>
            {order.articles.map(article => (
              <View key={article.id} style={styles.articleRow}>
                <View style={styles.articleDot} />
                <ThemedText variant="body" style={styles.articleName}>
                  {article.name}
                </ThemedText>
                <ThemedText variant="body" color={Colors.textSecondary}>
                  {article.quantity} {article.unit}
                </ThemedText>
              </View>
            ))}
          </Card>
        ) : null}

        {order.contacts.length > 0 ? (
          <Card>
            <ThemedText variant="label" style={styles.sectionLabel}>Kontakter</ThemedText>
            {order.contacts.map(contact => (
              <View key={contact.id} style={styles.contactRow}>
                <View style={styles.contactInfo}>
                  <ThemedText variant="body">{contact.name}</ThemedText>
                  <ThemedText variant="caption">{contact.role}</ThemedText>
                </View>
                <Pressable
                  style={styles.callButton}
                  onPress={() => callContact(contact.phone)}
                  testID={`button-call-${contact.id}`}
                >
                  <Feather name="phone" size={16} color={Colors.secondary} />
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Anteckningar</ThemedText>
          {notes.length > 0 ? (
            notes.map(note => (
              <View key={note.id} style={styles.noteItem}>
                <View style={styles.noteHeader}>
                  <ThemedText variant="caption" color={Colors.primaryLight}>
                    {note.createdBy}
                  </ThemedText>
                  <ThemedText variant="caption" color={Colors.textMuted}>
                    {formatNoteDate(note.createdAt)}
                  </ThemedText>
                </View>
                <ThemedText variant="body">{note.text}</ThemedText>
              </View>
            ))
          ) : (
            <ThemedText variant="caption" color={Colors.textMuted}>
              Inga anteckningar \u00e4nnu
            </ThemedText>
          )}
          <View style={styles.noteInputRow}>
            <TextInput
              style={styles.noteInput}
              placeholder="Skriv en anteckning..."
              placeholderTextColor={Colors.textMuted}
              value={noteText}
              onChangeText={setNoteText}
              multiline
              testID="input-note"
            />
            <Pressable
              style={[styles.noteSendButton, noteText.trim().length === 0 ? styles.noteSendDisabled : null]}
              onPress={handleAddNote}
              disabled={noteText.trim().length === 0 || noteMutation.isPending}
              testID="button-send-note"
            >
              {noteMutation.isPending ? (
                <ActivityIndicator size="small" color={Colors.textInverse} />
              ) : (
                <Feather name="send" size={16} color={Colors.textInverse} />
              )}
            </Pressable>
          </View>
        </Card>

        <View style={styles.actionRow}>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('ReportDeviation', { orderId: order.id })}
            testID="button-report-deviation"
          >
            <Feather name="alert-triangle" size={18} color={Colors.warning} />
            <ThemedText variant="caption" color={Colors.warning}>
              Avvikelse
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('MaterialLog', { orderId: order.id, articles: order.articles })}
            testID="button-material-log"
          >
            <Feather name="package" size={18} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>
              Material
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('Inspection', { orderId: order.id })}
            testID="button-inspection"
          >
            <Feather name="clipboard" size={18} color={Colors.secondary} />
            <ThemedText variant="caption" color={Colors.secondary}>
              Inspektion
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('CameraCapture', { orderId: order.id })}
            testID="button-camera"
          >
            <Feather name="camera" size={18} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>
              Foto
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('Signature', { orderId: order.id })}
            testID="button-signature"
          >
            <Feather name="edit-3" size={18} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>
              Signatur
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={handleAiTip}
            testID="button-ai-tip"
          >
            <Feather name="cpu" size={18} color={Colors.secondary} />
            <ThemedText variant="caption" color={Colors.secondary}>
              AI Tips
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      {!isFinished && !order.isLocked ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
          {order.status !== 'new' && order.status !== 'completed' ? (
            <Pressable
              style={styles.deferButton}
              onPress={handleDefer}
              testID="button-defer"
            >
              <Feather name="x-circle" size={20} color={Colors.danger} />
            </Pressable>
          ) : null}
          {nextStatus ? (
            <Pressable
              style={styles.advanceButton}
              onPress={handleAdvanceStatus}
              disabled={statusMutation.isPending}
              testID="button-advance-status"
            >
              <Feather name={getNextStatusIcon(order.status) as any} size={20} color={Colors.textInverse} />
              <ThemedText variant="subheading" color={Colors.textInverse} style={{ fontSize: FontSize.lg }}>
                {getNextStatusLabel(order.status)}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {order.isLocked ? (
        <View style={[styles.bottomBar, styles.lockedBottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
          <Feather name="lock" size={18} color={Colors.danger} />
          <ThemedText variant="body" color={Colors.danger}>
            L\u00e5st - beroende ej uppfyllt
          </ThemedText>
        </View>
      ) : null}

      <Modal
        visible={showAiTip}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAiTip(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Feather name="cpu" size={20} color={Colors.secondary} />
                <ThemedText variant="subheading">AI Tips</ThemedText>
              </View>
              <Pressable onPress={() => setShowAiTip(false)} testID="button-close-ai-tip">
                <Feather name="x" size={24} color={Colors.textMuted} />
              </Pressable>
            </View>
            {aiTipLoading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={Colors.secondary} />
                <ThemedText variant="body" color={Colors.textMuted}>
                  Analyserar uppdraget...
                </ThemedText>
              </View>
            ) : (
              <ScrollView style={styles.modalScroll}>
                <ThemedText variant="body" style={styles.modalText}>
                  {aiTip || ''}
                </ThemedText>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  loading: {
    textAlign: 'center',
    paddingTop: Spacing.xxxl,
  },
  headerSection: {
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  execCodesRow: {
    flexDirection: 'row',
    gap: 4,
  },
  execCodeBadge: {
    backgroundColor: Colors.infoLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  execCodeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  lockedCard: {
    backgroundColor: Colors.dangerLight,
  },
  urgentCard: {
    backgroundColor: Colors.dangerLight,
  },
  restrictionCard: {
    backgroundColor: Colors.warningLight,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  alertTextContainer: {
    flex: 1,
  },
  restrictionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingLeft: Spacing.xxl,
  },
  restrictionTypeBadge: {
    backgroundColor: Colors.dangerLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  restrictionTypeText: {
    fontSize: FontSize.xs,
    fontFamily: 'Inter_600SemiBold',
  },
  restrictionDesc: {
    flex: 1,
  },
  depRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  depInfo: {
    flex: 1,
  },
  sectionLabel: {
    marginBottom: Spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  infoContent: {
    flex: 1,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
  },
  notesBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.infoLight,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  subStepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  subStepProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  subStepProgressBarBg: {
    width: 60,
    height: 4,
    backgroundColor: Colors.borderLight,
    borderRadius: 2,
    overflow: 'hidden',
  },
  subStepProgressBarFill: {
    height: '100%',
    backgroundColor: Colors.secondary,
    borderRadius: 2,
  },
  subStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkBoxChecked: {
    backgroundColor: Colors.secondary,
    borderColor: Colors.secondary,
  },
  subStepInfo: {
    flex: 1,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: Colors.textMuted,
  },
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  articleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.secondary,
  },
  articleName: {
    flex: 1,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  contactInfo: {
    flex: 1,
  },
  callButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.successLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noteItem: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  noteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  noteInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  noteInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 80,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontFamily: 'Inter_400Regular',
    fontSize: FontSize.md,
    color: Colors.text,
  },
  noteSendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noteSendDisabled: {
    backgroundColor: Colors.textMuted,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: Spacing.sm,
    flexWrap: 'wrap',
  },
  secondaryAction: {
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.sm,
    minWidth: 60,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  lockedBottomBar: {
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  deferButton: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.dangerLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  advanceButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 56,
    backgroundColor: Colors.secondary,
    borderRadius: BorderRadius.lg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  modalLoading: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xxxl,
  },
  modalScroll: {
    maxHeight: 400,
  },
  modalText: {
    lineHeight: 24,
  },
});
