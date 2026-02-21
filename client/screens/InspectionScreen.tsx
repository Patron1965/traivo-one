import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import {
  INSPECTION_CATEGORIES,
  INSPECTION_ISSUES,
  INSPECTION_STATUS_LABELS,
  type InspectionStatus,
  type InspectionItem,
} from '../types';

interface CategoryState {
  status: InspectionStatus;
  issues: string[];
  comment: string;
}

export function InspectionScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const [categories, setCategories] = useState<Record<string, CategoryState>>(() => {
    const init: Record<string, CategoryState> = {};
    INSPECTION_CATEGORIES.forEach(cat => {
      init[cat.key] = { status: 'not_checked', issues: [], comment: '' };
    });
    return init;
  });

  const saveMutation = useMutation({
    mutationFn: (inspections: InspectionItem[]) =>
      apiRequest('POST', `/api/mobile/orders/${orderId}/inspections`, { inspections }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    },
  });

  function setStatus(key: string, status: InspectionStatus) {
    setCategories(prev => ({
      ...prev,
      [key]: { ...prev[key], status },
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function toggleIssue(key: string, issue: string) {
    setCategories(prev => {
      const current = prev[key].issues;
      const newIssues = current.includes(issue)
        ? current.filter(i => i !== issue)
        : [...current, issue];
      return {
        ...prev,
        [key]: { ...prev[key], issues: newIssues },
      };
    });
  }

  function setComment(key: string, text: string) {
    setCategories(prev => ({
      ...prev,
      [key]: { ...prev[key], comment: text },
    }));
  }

  function handleSave() {
    const inspections: InspectionItem[] = INSPECTION_CATEGORIES.map((cat, idx) => ({
      id: idx + 1,
      category: cat.key,
      status: categories[cat.key].status,
      issues: categories[cat.key].issues,
      comment: categories[cat.key].comment,
    }));
    saveMutation.mutate(inspections);
  }

  function getStatusColor(status: InspectionStatus): string {
    switch (status) {
      case 'ok': return Colors.success;
      case 'warning': return Colors.warning;
      case 'error': return Colors.danger;
      default: return Colors.textMuted;
    }
  }

  function getStatusBg(status: InspectionStatus): string {
    switch (status) {
      case 'ok': return Colors.successLight;
      case 'warning': return Colors.warningLight;
      case 'error': return Colors.dangerLight;
      default: return Colors.background;
    }
  }

  const checkedCount = Object.values(categories).filter(c => c.status !== 'not_checked').length;
  const hasIssues = Object.values(categories).some(c => c.status === 'warning' || c.status === 'error');

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + 100 },
        ]}
      >
        <View style={styles.summary}>
          <ThemedText variant="subheading">Inspektionskontroll</ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>
            {checkedCount}/{INSPECTION_CATEGORIES.length} kontrollerade
          </ThemedText>
        </View>

        {INSPECTION_CATEGORIES.map(cat => {
          const state = categories[cat.key];
          const isExpanded = expandedCategory === cat.key;
          const issues = INSPECTION_ISSUES[cat.key] || [];

          return (
            <Card key={cat.key} style={StyleSheet.flatten([styles.categoryCard, { borderLeftColor: getStatusColor(state.status), borderLeftWidth: 3 }])}>
              <Pressable
                style={styles.categoryHeader}
                onPress={() => setExpandedCategory(isExpanded ? null : cat.key)}
                testID={`button-category-${cat.key}`}
              >
                <View style={styles.categoryTitleRow}>
                  <Feather name={cat.icon as any} size={18} color={Colors.primary} />
                  <ThemedText variant="subheading">{cat.label}</ThemedText>
                </View>
                <View style={styles.categoryHeaderRight}>
                  {state.status !== 'not_checked' ? (
                    <View style={[styles.statusPill, { backgroundColor: getStatusBg(state.status) }]}>
                      <ThemedText variant="caption" color={getStatusColor(state.status)} style={styles.statusPillText}>
                        {INSPECTION_STATUS_LABELS[state.status]}
                      </ThemedText>
                    </View>
                  ) : null}
                  <Feather
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={Colors.textMuted}
                  />
                </View>
              </Pressable>

              {isExpanded ? (
                <View style={styles.categoryBody}>
                  <ThemedText variant="label" style={styles.bodyLabel}>Status</ThemedText>
                  <View style={styles.statusButtons}>
                    {(['ok', 'warning', 'error'] as InspectionStatus[]).map(st => (
                      <Pressable
                        key={st}
                        style={[
                          styles.statusBtn,
                          state.status === st ? { backgroundColor: getStatusBg(st), borderColor: getStatusColor(st) } : null,
                        ]}
                        onPress={() => setStatus(cat.key, st)}
                        testID={`button-status-${cat.key}-${st}`}
                      >
                        <Feather
                          name={st === 'ok' ? 'check-circle' : st === 'warning' ? 'alert-triangle' : 'x-circle'}
                          size={16}
                          color={state.status === st ? getStatusColor(st) : Colors.textMuted}
                        />
                        <ThemedText
                          variant="caption"
                          color={state.status === st ? getStatusColor(st) : Colors.textMuted}
                        >
                          {INSPECTION_STATUS_LABELS[st]}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>

                  {state.status !== 'not_checked' && state.status !== 'ok' ? (
                    <>
                      <ThemedText variant="label" style={styles.bodyLabel}>Problem</ThemedText>
                      <View style={styles.issueGrid}>
                        {issues.map(issue => {
                          const selected = state.issues.includes(issue);
                          return (
                            <Pressable
                              key={issue}
                              style={[styles.issueBadge, selected ? styles.issueBadgeSelected : null]}
                              onPress={() => toggleIssue(cat.key, issue)}
                              testID={`button-issue-${cat.key}-${issue}`}
                            >
                              <ThemedText
                                variant="caption"
                                color={selected ? Colors.textInverse : Colors.textSecondary}
                              >
                                {issue}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : null}

                  <ThemedText variant="label" style={styles.bodyLabel}>Kommentar</ThemedText>
                  <TextInput
                    style={styles.commentInput}
                    placeholder="Fritext kommentar..."
                    placeholderTextColor={Colors.textMuted}
                    value={state.comment}
                    onChangeText={text => setComment(cat.key, text)}
                    multiline
                    testID={`input-comment-${cat.key}`}
                  />
                </View>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.bottomInfo}>
          {hasIssues ? (
            <View style={styles.issueWarning}>
              <Feather name="alert-triangle" size={14} color={Colors.warning} />
              <ThemedText variant="caption" color={Colors.warning}>
                Problem rapporterade
              </ThemedText>
            </View>
          ) : null}
        </View>
        <Pressable
          style={[styles.saveButton, saveMutation.isPending ? styles.saveButtonDisabled : null]}
          onPress={handleSave}
          disabled={saveMutation.isPending}
          testID="button-save-inspection"
        >
          {saveMutation.isPending ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <>
              <Feather name="save" size={18} color={Colors.textInverse} />
              <ThemedText variant="subheading" color={Colors.textInverse}>
                Spara inspektion
              </ThemedText>
            </>
          )}
        </Pressable>
      </View>
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
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryCard: {
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  categoryHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  statusPillText: {
    fontFamily: 'Inter_600SemiBold',
  },
  categoryBody: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  bodyLabel: {
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  statusButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statusBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  issueGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  issueBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  issueBadgeSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  commentInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontFamily: 'Inter_400Regular',
    fontSize: FontSize.md,
    color: Colors.text,
    minHeight: 60,
    maxHeight: 100,
    textAlignVertical: 'top',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  bottomInfo: {
    marginBottom: Spacing.sm,
  },
  issueWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.secondary,
    height: 52,
    borderRadius: BorderRadius.lg,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
});
