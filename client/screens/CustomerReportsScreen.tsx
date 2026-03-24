import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput, Modal, ActivityIndicator, RefreshControl } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { triggerNotification, NotificationFeedbackType } from '../lib/haptics';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import {
  CHANGE_REQUEST_CATEGORIES, CHANGE_REQUEST_STATUS_LABELS,
  type ChangeRequestCategory, type ChangeRequestStatus, type CustomerChangeRequest,
} from '../types';

type Severity = 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Låg', medium: 'Medel', high: 'Hög', critical: 'Kritisk',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  low: Colors.success, medium: Colors.warning, high: '#E67E22', critical: Colors.danger,
};

const STATUS_COLORS: Record<ChangeRequestStatus, string> = {
  new: Colors.info, reviewed: Colors.warning, resolved: Colors.success, rejected: Colors.danger,
};

const CATEGORY_ICONS: Record<string, string> = {
  antal_karl_andrat: 'package', skadat_material: 'alert-triangle',
  tillganglighet: 'map-pin', skador: 'alert-circle',
  rengorings_behov: 'droplet', ovrigt: 'more-horizontal',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function CustomerReportsScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<CustomerChangeRequest | null>(null);
  const [category, setCategory] = useState<ChangeRequestCategory | null>(null);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [refreshing, setRefreshing] = useState(false);

  const { data: reportsData, isLoading, refetch } = useQuery<{ items: CustomerChangeRequest[]; total: number }>({
    queryKey: ['/api/mobile/customer-change-requests/mine'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', '/api/mobile/customer-change-requests', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/customer-change-requests/mine'] });
      triggerNotification(NotificationFeedbackType.Success);
      setShowCreateModal(false);
      setCategory(null);
      setDescription('');
      setSeverity('medium');
    },
  });

  const reports = reportsData?.items || [];

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleSubmit = () => {
    if (!category || !description.trim()) return;
    createMutation.mutate({ category, description: description.trim(), severity });
  };

  const statusCounts = {
    new: reports.filter(r => r.status === 'new').length,
    reviewed: reports.filter(r => r.status === 'reviewed').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
    rejected: reports.filter(r => r.status === 'rejected').length,
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl, paddingHorizontal: Spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        <View style={styles.kpiRow}>
          {(Object.entries(statusCounts) as [ChangeRequestStatus, number][]).map(([status, count]) => (
            <View key={status} style={[styles.kpiCard, { borderTopColor: STATUS_COLORS[status] }]}>
              <ThemedText variant="heading" color={STATUS_COLORS[status]}>{count}</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>{CHANGE_REQUEST_STATUS_LABELS[status]}</ThemedText>
            </View>
          ))}
        </View>

        <Pressable
          style={styles.createButton}
          onPress={() => setShowCreateModal(true)}
          testID="button-create-report"
        >
          <Feather name="plus-circle" size={20} color={Colors.textInverse} />
          <ThemedText variant="label" color={Colors.textInverse}>Ny kundrapport</ThemedText>
        </Pressable>

        {isLoading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : reports.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Feather name="file-text" size={32} color={Colors.textMuted} />
            <ThemedText variant="body" color={Colors.textMuted} style={{ marginTop: Spacing.sm }}>
              Inga kundrapporter ännu
            </ThemedText>
          </Card>
        ) : (
          reports.map(report => (
            <Pressable key={report.id} onPress={() => setSelectedReport(report)} testID={`report-${report.id}`}>
              <Card style={styles.reportCard}>
                <View style={styles.reportHeader}>
                  <View style={styles.reportCategoryRow}>
                    <Feather
                      name={(CATEGORY_ICONS[report.category] || 'file') as any}
                      size={16}
                      color={Colors.primary}
                    />
                    <ThemedText variant="label">
                      {CHANGE_REQUEST_CATEGORIES[report.category] || report.category}
                    </ThemedText>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[report.status] + '20' }]}>
                    <ThemedText variant="caption" color={STATUS_COLORS[report.status]}>
                      {CHANGE_REQUEST_STATUS_LABELS[report.status]}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText variant="body" color={Colors.textSecondary} numberOfLines={2} style={styles.reportDesc}>
                  {report.description}
                </ThemedText>
                <View style={styles.reportMeta}>
                  {report.customerName ? (
                    <View style={styles.metaItem}>
                      <Feather name="user" size={12} color={Colors.textMuted} />
                      <ThemedText variant="caption" color={Colors.textMuted}>{report.customerName}</ThemedText>
                    </View>
                  ) : null}
                  <View style={styles.metaItem}>
                    <Feather name="calendar" size={12} color={Colors.textMuted} />
                    <ThemedText variant="caption" color={Colors.textMuted}>{formatDate(report.createdAt)}</ThemedText>
                  </View>
                  {report.severity ? (
                    <View style={[styles.severityBadge, { backgroundColor: (SEVERITY_COLORS[report.severity as Severity] || Colors.textMuted) + '20' }]}>
                      <ThemedText variant="caption" color={SEVERITY_COLORS[report.severity as Severity] || Colors.textMuted}>
                        {SEVERITY_LABELS[report.severity as Severity] || report.severity}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* Create Modal */}
      <Modal visible={showCreateModal} transparent animationType="slide" onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <ThemedText variant="subheading">Ny kundrapport</ThemedText>
              <Pressable onPress={() => setShowCreateModal(false)} hitSlop={8}>
                <Feather name="x" size={24} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>
              <ThemedText variant="label" style={styles.fieldLabel}>Kategori</ThemedText>
              <View style={styles.categoryGrid}>
                {(Object.entries(CHANGE_REQUEST_CATEGORIES) as [ChangeRequestCategory, string][]).map(([key, label]) => (
                  <Pressable
                    key={key}
                    style={[styles.categoryChip, category === key ? styles.categoryChipActive : null]}
                    onPress={() => setCategory(key)}
                    testID={`category-${key}`}
                  >
                    <Feather
                      name={(CATEGORY_ICONS[key] || 'file') as any}
                      size={14}
                      color={category === key ? Colors.textInverse : Colors.primary}
                    />
                    <ThemedText
                      variant="caption"
                      color={category === key ? Colors.textInverse : Colors.text}
                    >
                      {label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              <ThemedText variant="label" style={styles.fieldLabel}>Allvarlighetsgrad</ThemedText>
              <View style={styles.severityRow}>
                {(Object.entries(SEVERITY_LABELS) as [Severity, string][]).map(([key, label]) => (
                  <Pressable
                    key={key}
                    style={[styles.severityChip, severity === key ? { backgroundColor: SEVERITY_COLORS[key], borderColor: SEVERITY_COLORS[key] } : null]}
                    onPress={() => setSeverity(key)}
                    testID={`severity-${key}`}
                  >
                    <ThemedText
                      variant="caption"
                      color={severity === key ? Colors.textInverse : SEVERITY_COLORS[key]}
                    >
                      {label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              <ThemedText variant="label" style={styles.fieldLabel}>Beskrivning</ThemedText>
              <TextInput
                style={styles.textArea}
                placeholder="Beskriv problemet..."
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                value={description}
                onChangeText={setDescription}
                testID="input-description"
              />
            </ScrollView>

            <Pressable
              style={[styles.submitButton, (!category || !description.trim()) ? styles.submitDisabled : null]}
              onPress={handleSubmit}
              disabled={!category || !description.trim() || createMutation.isPending}
              testID="button-submit-report"
            >
              {createMutation.isPending ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <>
                  <Feather name="send" size={18} color={Colors.textInverse} />
                  <ThemedText variant="label" color={Colors.textInverse}>Skicka rapport</ThemedText>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Detail Modal */}
      <Modal visible={!!selectedReport} transparent animationType="fade" onRequestClose={() => setSelectedReport(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedReport(null)}>
          <View style={[styles.detailContent, { paddingBottom: insets.bottom + Spacing.lg }]}>
            {selectedReport ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.detailHeader}>
                  <View style={styles.reportCategoryRow}>
                    <Feather name={(CATEGORY_ICONS[selectedReport.category] || 'file') as any} size={20} color={Colors.primary} />
                    <ThemedText variant="subheading">
                      {CHANGE_REQUEST_CATEGORIES[selectedReport.category] || selectedReport.category}
                    </ThemedText>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[selectedReport.status] + '20' }]}>
                    <ThemedText variant="body" color={STATUS_COLORS[selectedReport.status]}>
                      {CHANGE_REQUEST_STATUS_LABELS[selectedReport.status]}
                    </ThemedText>
                  </View>
                </View>

                <ThemedText variant="body" style={styles.detailDesc}>
                  {selectedReport.description}
                </ThemedText>

                <View style={styles.detailSection}>
                  <ThemedText variant="label" color={Colors.textSecondary}>Information</ThemedText>
                  {selectedReport.customerName ? (
                    <View style={styles.detailRow}>
                      <Feather name="briefcase" size={14} color={Colors.textMuted} />
                      <ThemedText variant="body">{selectedReport.customerName}</ThemedText>
                    </View>
                  ) : null}
                  {selectedReport.objectName ? (
                    <View style={styles.detailRow}>
                      <Feather name="box" size={14} color={Colors.textMuted} />
                      <ThemedText variant="body">{selectedReport.objectName}</ThemedText>
                    </View>
                  ) : null}
                  <View style={styles.detailRow}>
                    <Feather name="calendar" size={14} color={Colors.textMuted} />
                    <ThemedText variant="body">{formatDate(selectedReport.createdAt)}</ThemedText>
                  </View>
                  {selectedReport.severity ? (
                    <View style={styles.detailRow}>
                      <Feather name="alert-circle" size={14} color={SEVERITY_COLORS[selectedReport.severity as Severity] || Colors.textMuted} />
                      <ThemedText variant="body" color={SEVERITY_COLORS[selectedReport.severity as Severity]}>
                        {SEVERITY_LABELS[selectedReport.severity as Severity] || selectedReport.severity}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>

                {selectedReport.reviewedBy ? (
                  <View style={styles.detailSection}>
                    <ThemedText variant="label" color={Colors.textSecondary}>Granskning</ThemedText>
                    <View style={styles.detailRow}>
                      <Feather name="user-check" size={14} color={Colors.secondary} />
                      <ThemedText variant="body">{selectedReport.reviewedBy}</ThemedText>
                    </View>
                    {selectedReport.reviewedAt ? (
                      <View style={styles.detailRow}>
                        <Feather name="clock" size={14} color={Colors.textMuted} />
                        <ThemedText variant="body">{formatDate(selectedReport.reviewedAt)}</ThemedText>
                      </View>
                    ) : null}
                    {selectedReport.reviewNotes ? (
                      <View style={styles.reviewNotesBox}>
                        <ThemedText variant="body" color={Colors.textSecondary}>
                          {selectedReport.reviewNotes}
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  kpiRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  kpiCard: {
    flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: Spacing.sm, alignItems: 'center', borderTopWidth: 3,
  },
  createButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md, marginBottom: Spacing.lg,
  },
  emptyCard: { alignItems: 'center', padding: Spacing.xl },
  reportCard: { marginBottom: Spacing.sm },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  reportCategoryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.round },
  reportDesc: { marginBottom: Spacing.sm },
  reportMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  severityBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 1, borderRadius: BorderRadius.round },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.lg, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  modalScroll: { marginBottom: Spacing.md },
  fieldLabel: { marginBottom: Spacing.sm, marginTop: Spacing.md },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.primary + '30',
    backgroundColor: Colors.card,
  },
  categoryChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  severityRow: { flexDirection: 'row', gap: Spacing.sm },
  severityChip: {
    flex: 1, alignItems: 'center',
    paddingVertical: Spacing.sm, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.textMuted + '40',
  },
  textArea: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.md,
    padding: Spacing.md, fontSize: FontSize.body, color: Colors.text,
    minHeight: 100, borderWidth: 1, borderColor: Colors.textMuted + '30',
    fontFamily: 'Inter_400Regular',
  },
  submitButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: Spacing.md,
  },
  submitDisabled: { opacity: 0.5 },
  detailContent: {
    backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.lg, maxHeight: '80%',
  },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  detailDesc: { marginBottom: Spacing.lg, lineHeight: 22 },
  detailSection: { marginBottom: Spacing.lg },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  reviewNotesBox: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.md,
    padding: Spacing.md, marginTop: Spacing.sm,
    borderLeftWidth: 3, borderLeftColor: Colors.secondary,
  },
});
