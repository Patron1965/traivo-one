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
import type { Order, OrderStatus, TimeRestriction, SubStep, OrderNote, ImpossibleReason } from '../types';
import { TIME_RESTRICTION_LABELS, ORDER_STATUS_SEQUENCE, IMPOSSIBLE_REASONS } from '../types';

const KINAB_STATUS_SEQUENCE: OrderStatus[] = ORDER_STATUS_SEQUENCE;

const DRIVER_STATUS_SEQUENCE: OrderStatus[] = [
  'planned',
  'dispatched',
  'on_site',
  'in_progress',
  'completed',
];

function isDriverFlow(status: OrderStatus): boolean {
  return DRIVER_STATUS_SEQUENCE.includes(status);
}

export function OrderDetailScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState('');
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [aiTipLoading, setAiTipLoading] = useState(false);
  const [showAiTip, setShowAiTip] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'complete' | 'failed' | null>(null);
  const [showImpossibleModal, setShowImpossibleModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState<ImpossibleReason | null>(null);
  const [impossibleText, setImpossibleText] = useState('');

  const { data: order, isLoading } = useQuery<Order>({
    queryKey: [`/api/mobile/orders/${orderId}`],
  });

  const statusMutation = useMutation({
    mutationFn: (params: { status: OrderStatus; impossibleReason?: string }) =>
      apiRequest('PATCH', `/api/mobile/orders/${orderId}/status`, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
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
    if (isDriverFlow(current)) {
      const idx = DRIVER_STATUS_SEQUENCE.indexOf(current);
      if (idx === -1 || idx >= DRIVER_STATUS_SEQUENCE.length - 1) return null;
      return DRIVER_STATUS_SEQUENCE[idx + 1];
    }
    const idx = KINAB_STATUS_SEQUENCE.indexOf(current);
    if (idx === -1 || idx >= KINAB_STATUS_SEQUENCE.length - 1) return null;
    return KINAB_STATUS_SEQUENCE[idx + 1];
  }

  function getNextStatusLabel(status: OrderStatus): string {
    const labels: Record<string, string> = {
      skapad: 'Förplanera',
      planerad_pre: 'Tilldela resurs',
      planerad_resurs: 'Lasta in',
      planerad_las: 'Slutför',
      planned: 'Starta körning',
      dispatched: 'På plats',
      on_site: 'Utför',
      in_progress: 'Slutför',
    };
    return labels[status] || 'Nästa steg';
  }

  function getNextStatusSubLabel(status: OrderStatus): string | null {
    const subLabels: Record<string, string> = {
      planned: 'Navigera till uppdraget',
      dispatched: 'Tidsregistrering börjar när du anländer',
      on_site: 'Gör jobbet, logga material och anteckningar',
      in_progress: 'Markera uppdraget som klart',
    };
    return subLabels[status] || null;
  }

  function getNextStatusIcon(status: OrderStatus): string {
    const icons: Record<string, string> = {
      skapad: 'clipboard',
      planerad_pre: 'user-check',
      planerad_resurs: 'truck',
      planerad_las: 'check-circle',
      planned: 'navigation',
      dispatched: 'map-pin',
      on_site: 'play',
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
    if (!next) return;
    if (next === 'utford' || next === 'fakturerad' || next === 'completed') {
      setConfirmAction('complete');
    } else {
      statusMutation.mutate({ status: next });
    }
  }

  function handleImpossible() {
    setShowImpossibleModal(true);
    setSelectedReason(null);
    setImpossibleText('');
  }

  function handleConfirmImpossible() {
    if (!selectedReason) return;
    const reason = selectedReason === 'other'
      ? impossibleText.trim() || IMPOSSIBLE_REASONS[selectedReason]
      : IMPOSSIBLE_REASONS[selectedReason];
    statusMutation.mutate({ status: 'impossible' as OrderStatus, impossibleReason: reason });
    setShowImpossibleModal(false);
    setSelectedReason(null);
    setImpossibleText('');
  }

  function handleConfirmAction() {
    if (confirmAction === 'complete') {
      const next = order ? getNextStatus(order.status) : null;
      statusMutation.mutate({ status: next || ('utford' as OrderStatus) });
    }
    setConfirmAction(null);
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
  const isFinished = order.status === 'completed' || order.status === 'cancelled' || order.status === 'failed'
    || order.status === 'utford' || order.status === 'fakturerad' || order.status === 'impossible';
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
                  Uppdraget är låst
                </ThemedText>
                <ThemedText variant="caption" color={Colors.textSecondary}>
                  Beroende uppdrag måste slutföras först
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
                Brådskande uppdrag
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {activeRestrictions.length > 0 ? (
          <Card style={styles.restrictionCard}>
            <View style={styles.alertRow}>
              <Feather name="alert-triangle" size={20} color={Colors.warning} />
              <ThemedText variant="subheading" color={Colors.warning}>
                Tidsbegränsningar
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
                    Måste vara: {dep.dependsOnStatus === 'completed' ? 'Slutförd' : dep.dependsOnStatus}
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
                onPress={() => subStepMutation.mutate({ stepId: Number(step.id), completed: !step.completed })}
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
              Inga anteckningar ännu
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

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Åtgärder</ThemedText>
          <View style={styles.actionGrid}>
            <Pressable
              style={styles.actionGridItem}
              onPress={() => navigation.navigate('ReportDeviation', { orderId: order.id })}
              testID="button-report-deviation"
            >
              <View style={[styles.actionIconBox, { backgroundColor: Colors.warningLight }]}>
                <Feather name="alert-triangle" size={24} color={Colors.warning} />
              </View>
              <ThemedText variant="caption" style={styles.actionLabel}>Avvikelse</ThemedText>
            </Pressable>
            <Pressable
              style={styles.actionGridItem}
              onPress={() => navigation.navigate('MaterialLog', { orderId: order.id, articles: order.articles })}
              testID="button-material-log"
            >
              <View style={[styles.actionIconBox, { backgroundColor: Colors.infoLight }]}>
                <Feather name="package" size={24} color={Colors.primary} />
              </View>
              <ThemedText variant="caption" style={styles.actionLabel}>Material</ThemedText>
            </Pressable>
            <Pressable
              style={styles.actionGridItem}
              onPress={() => navigation.navigate('Inspection', { orderId: order.id })}
              testID="button-inspection"
            >
              <View style={[styles.actionIconBox, { backgroundColor: Colors.successLight }]}>
                <Feather name="clipboard" size={24} color={Colors.secondary} />
              </View>
              <ThemedText variant="caption" style={styles.actionLabel}>Inspektion</ThemedText>
            </Pressable>
            <Pressable
              style={styles.actionGridItem}
              onPress={() => navigation.navigate('CameraCapture', { orderId: order.id })}
              testID="button-camera"
            >
              <View style={[styles.actionIconBox, { backgroundColor: Colors.infoLight }]}>
                <Feather name="camera" size={24} color={Colors.primaryLight} />
              </View>
              <ThemedText variant="caption" style={styles.actionLabel}>Foto</ThemedText>
            </Pressable>
            <Pressable
              style={styles.actionGridItem}
              onPress={() => navigation.navigate('Signature', { orderId: order.id })}
              testID="button-signature"
            >
              <View style={[styles.actionIconBox, { backgroundColor: Colors.infoLight }]}>
                <Feather name="edit-3" size={24} color={Colors.primary} />
              </View>
              <ThemedText variant="caption" style={styles.actionLabel}>Signatur</ThemedText>
            </Pressable>
            <Pressable
              style={styles.actionGridItem}
              onPress={handleAiTip}
              testID="button-ai-tip"
            >
              <View style={[styles.actionIconBox, { backgroundColor: Colors.successLight }]}>
                <Feather name="cpu" size={24} color={Colors.secondary} />
              </View>
              <ThemedText variant="caption" style={styles.actionLabel}>AI Tips</ThemedText>
            </Pressable>
          </View>
        </Card>
      </ScrollView>

      {!isFinished && !order.isLocked ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
          <Pressable
            style={styles.deferButton}
            onPress={handleImpossible}
            testID="button-impossible"
          >
            <Feather name="alert-octagon" size={22} color={Colors.danger} />
            <ThemedText variant="caption" color={Colors.danger} style={styles.deferLabel}>
              Omöjlig
            </ThemedText>
          </Pressable>
          {nextStatus ? (
            <Pressable
              style={styles.advanceButton}
              onPress={handleAdvanceStatus}
              disabled={statusMutation.isPending}
              testID="button-advance-status"
            >
              <Feather name={getNextStatusIcon(order.status) as any} size={24} color={Colors.textInverse} />
              <View style={styles.advanceLabelContainer}>
                <ThemedText variant="subheading" color={Colors.textInverse} style={styles.advanceLabel}>
                  {getNextStatusLabel(order.status)}
                </ThemedText>
                {getNextStatusSubLabel(order.status) ? (
                  <ThemedText variant="caption" color="rgba(255,255,255,0.75)" style={styles.advanceSubLabel}>
                    {getNextStatusSubLabel(order.status)}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {order.isLocked ? (
        <View style={[styles.bottomBar, styles.lockedBottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
          <Feather name="lock" size={18} color={Colors.danger} />
          <ThemedText variant="body" color={Colors.danger}>
            Låst - beroende ej uppfyllt
          </ThemedText>
        </View>
      ) : null}

      <Modal
        visible={confirmAction !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmAction(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setConfirmAction(null)}>
          <Pressable style={styles.confirmContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.confirmIconCircle}>
              <Feather name="check-circle" size={40} color={Colors.secondary} />
            </View>
            <ThemedText variant="subheading" style={styles.confirmTitle}>
              Markera som utförd?
            </ThemedText>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.confirmDesc}>
              Uppdraget markeras som utfört.
            </ThemedText>
            <View style={styles.confirmButtons}>
              <Pressable
                style={styles.confirmCancel}
                onPress={() => setConfirmAction(null)}
                testID="button-confirm-cancel"
              >
                <ThemedText variant="body" color={Colors.textSecondary}>Avbryt</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.confirmOk, { backgroundColor: Colors.secondary }]}
                onPress={handleConfirmAction}
                testID="button-confirm-ok"
              >
                <ThemedText variant="body" color={Colors.textInverse} style={styles.confirmOkText}>
                  Ja, slutför
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showImpossibleModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowImpossibleModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowImpossibleModal(false)}>
          <Pressable style={styles.impossibleContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Feather name="alert-octagon" size={20} color={Colors.danger} />
                <ThemedText variant="subheading">Markera som omöjlig</ThemedText>
              </View>
              <Pressable
                style={styles.modalCloseButton}
                onPress={() => setShowImpossibleModal(false)}
              >
                <Feather name="x" size={24} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.impossibleDesc}>
              Välj orsak till varför uppdraget inte kan utföras:
            </ThemedText>
            <ScrollView style={styles.reasonsList}>
              {(Object.keys(IMPOSSIBLE_REASONS) as ImpossibleReason[]).map(key => (
                <Pressable
                  key={key}
                  style={[
                    styles.reasonItem,
                    selectedReason === key ? styles.reasonItemSelected : null,
                  ]}
                  onPress={() => setSelectedReason(key)}
                  testID={`button-reason-${key}`}
                >
                  <View style={[
                    styles.reasonRadio,
                    selectedReason === key ? styles.reasonRadioSelected : null,
                  ]}>
                    {selectedReason === key ? (
                      <View style={styles.reasonRadioDot} />
                    ) : null}
                  </View>
                  <ThemedText variant="body">{IMPOSSIBLE_REASONS[key]}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
            {selectedReason === 'other' ? (
              <TextInput
                style={styles.impossibleInput}
                placeholder="Beskriv orsaken..."
                placeholderTextColor={Colors.textMuted}
                value={impossibleText}
                onChangeText={setImpossibleText}
                multiline
                testID="input-impossible-reason"
              />
            ) : null}
            <View style={styles.confirmButtons}>
              <Pressable
                style={styles.confirmCancel}
                onPress={() => setShowImpossibleModal(false)}
              >
                <ThemedText variant="body" color={Colors.textSecondary}>Avbryt</ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.confirmOk,
                  { backgroundColor: selectedReason ? Colors.danger : Colors.textMuted },
                ]}
                onPress={handleConfirmImpossible}
                disabled={!selectedReason}
                testID="button-confirm-impossible"
              >
                <ThemedText variant="body" color={Colors.textInverse} style={styles.confirmOkText}>
                  Bekräfta
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showAiTip}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAiTip(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowAiTip(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Feather name="cpu" size={20} color={Colors.secondary} />
                <ThemedText variant="subheading">AI Tips</ThemedText>
              </View>
              <Pressable
                style={styles.modalCloseButton}
                onPress={() => setShowAiTip(false)}
                testID="button-close-ai-tip"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Feather name="x" size={24} color={Colors.textSecondary} />
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
              <>
                <ScrollView style={styles.modalScroll}>
                  <ThemedText variant="body" style={styles.modalText}>
                    {aiTip || ''}
                  </ThemedText>
                </ScrollView>
                <Pressable
                  style={styles.modalDismissButton}
                  onPress={() => setShowAiTip(false)}
                >
                  <ThemedText variant="body" color={Colors.textInverse} style={styles.modalDismissText}>
                    Stäng
                  </ThemedText>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
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
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  actionGridItem: {
    alignItems: 'center',
    gap: Spacing.xs,
    width: '28%',
    minWidth: 80,
  },
  actionIconBox: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: FontSize.xs,
    textAlign: 'center',
    color: Colors.text,
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
    width: 64,
    height: 64,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.dangerLight,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  deferLabel: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
  },
  advanceButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 64,
    backgroundColor: Colors.secondary,
    borderRadius: BorderRadius.lg,
  },
  advanceLabelContainer: {
    flexShrink: 1,
  },
  advanceLabel: {
    fontSize: FontSize.xl,
    fontFamily: 'Inter_700Bold',
  },
  advanceSubLabel: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  confirmContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '85%',
    alignItems: 'center',
  },
  confirmIconCircle: {
    marginBottom: Spacing.md,
  },
  confirmTitle: {
    textAlign: 'center',
    marginBottom: Spacing.sm,
    fontSize: FontSize.xl,
  },
  confirmDesc: {
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  confirmCancel: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOk: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOkText: {
    fontFamily: 'Inter_600SemiBold',
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
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalDismissButton: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  modalDismissText: {
    fontFamily: 'Inter_600SemiBold',
  },
  impossibleContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    maxHeight: '80%',
  },
  impossibleDesc: {
    marginBottom: Spacing.md,
    lineHeight: 22,
  },
  reasonsList: {
    maxHeight: 300,
    marginBottom: Spacing.md,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  reasonItemSelected: {
    backgroundColor: Colors.dangerLight,
  },
  reasonRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reasonRadioSelected: {
    borderColor: Colors.danger,
  },
  reasonRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.danger,
  },
  impossibleInput: {
    minHeight: 60,
    maxHeight: 100,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontFamily: 'Inter_400Regular',
    fontSize: FontSize.md,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
});
