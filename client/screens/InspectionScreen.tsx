import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator, Image, Platform, Alert } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
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
  type PhotoRequirement,
} from '../types';

interface CategoryPhotos {
  photo?: string;
  beforePhoto?: string;
  afterPhoto?: string;
}

interface CategoryState {
  status: InspectionStatus;
  issues: string[];
  comment: string;
  photos: CategoryPhotos;
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
      init[cat.key] = { status: 'not_checked', issues: [], comment: '', photos: {} };
    });
    return init;
  });

  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (inspections: InspectionItem[]) => {
      const photoPayloads: { category: string; photoSlot: string; base64Data: string }[] = [];

      for (const cat of INSPECTION_CATEGORIES) {
        const state = categories[cat.key];
        const slots: { slot: 'photo' | 'beforePhoto' | 'afterPhoto'; uri?: string }[] = [
          { slot: 'photo', uri: state.photos.photo },
          { slot: 'beforePhoto', uri: state.photos.beforePhoto },
          { slot: 'afterPhoto', uri: state.photos.afterPhoto },
        ];

        for (const { slot, uri } of slots) {
          if (!uri) continue;
          try {
            setUploadProgress(`Läser ${cat.label}...`);
            const base64 = await FileSystem.readAsStringAsync(uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            photoPayloads.push({ category: cat.key, photoSlot: slot, base64Data: base64 });
          } catch (err: any) {
            console.warn(`Failed to read photo ${slot} for ${cat.key}:`, err.message);
          }
        }
      }

      if (photoPayloads.length > 0) {
        setUploadProgress(`Laddar upp ${photoPayloads.length} foto...`);
        const uploadRes = await apiRequest('POST', `/api/mobile/inspections/${orderId}/photos`, {
          photos: photoPayloads,
        });

        if (uploadRes.errors && uploadRes.errors.length > 0) {
          const failedAll = !uploadRes.uploaded || uploadRes.uploaded.length === 0;
          const errorMsg = uploadRes.errors.map((e: any) => e.error).join('\n');
          if (failedAll) {
            throw new Error(errorMsg);
          }
          Alert.alert(
            'Vissa foton kunde inte laddas upp',
            errorMsg,
            [{ text: 'OK' }]
          );
        }
      }

      setUploadProgress('Sparar inspektion...');
      return apiRequest('POST', `/api/mobile/orders/${orderId}/inspections`, { inspections });
    },
    onSuccess: () => {
      setUploadProgress(null);
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    },
    onError: (err: any) => {
      setUploadProgress(null);
      Alert.alert(
        'Kunde inte spara',
        err.message || 'Ett fel uppstod vid uppladdning av foton. Försök igen.',
        [{ text: 'OK' }]
      );
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

  async function capturePhoto(categoryKey: string, photoSlot: 'photo' | 'beforePhoto' | 'afterPhoto') {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets[0]) {
      setCategories(prev => ({
        ...prev,
        [categoryKey]: {
          ...prev[categoryKey],
          photos: {
            ...prev[categoryKey].photos,
            [photoSlot]: result.assets[0].uri,
          },
        },
      }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  async function pickPhoto(categoryKey: string, photoSlot: 'photo' | 'beforePhoto' | 'afterPhoto') {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setCategories(prev => ({
        ...prev,
        [categoryKey]: {
          ...prev[categoryKey],
          photos: {
            ...prev[categoryKey].photos,
            [photoSlot]: result.assets[0].uri,
          },
        },
      }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  function removePhoto(categoryKey: string, photoSlot: 'photo' | 'beforePhoto' | 'afterPhoto') {
    setCategories(prev => ({
      ...prev,
      [categoryKey]: {
        ...prev[categoryKey],
        photos: {
          ...prev[categoryKey].photos,
          [photoSlot]: undefined,
        },
      },
    }));
  }

  function isCategoryPhotoComplete(catKey: string): boolean {
    const cat = INSPECTION_CATEGORIES.find(c => c.key === catKey);
    if (!cat || !cat.photoRequired) return true;
    const photos = categories[catKey].photos;
    if (cat.photoType === 'single') {
      return !!photos.photo;
    }
    if (cat.photoType === 'before_after') {
      return !!photos.beforePhoto && !!photos.afterPhoto;
    }
    return true;
  }

  function getMissingPhotoCategories(): string[] {
    return INSPECTION_CATEGORIES
      .filter(cat => cat.photoRequired && categories[cat.key].status !== 'not_checked' && !isCategoryPhotoComplete(cat.key))
      .map(cat => cat.label);
  }

  function handleSave() {
    const missing = getMissingPhotoCategories();
    if (missing.length > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    const inspections: InspectionItem[] = INSPECTION_CATEGORIES.map((cat, idx) => {
      const state = categories[cat.key];
      const photos: string[] = [];
      if (state.photos.photo) photos.push(state.photos.photo);
      if (state.photos.beforePhoto) photos.push(state.photos.beforePhoto);
      if (state.photos.afterPhoto) photos.push(state.photos.afterPhoto);

      return {
        id: idx + 1,
        category: cat.key,
        status: state.status,
        issues: state.issues,
        comment: state.comment,
        photos: photos.length > 0 ? photos : undefined,
        beforePhoto: state.photos.beforePhoto,
        afterPhoto: state.photos.afterPhoto,
      };
    });
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

  function renderPhotoSlot(
    categoryKey: string,
    photoSlot: 'photo' | 'beforePhoto' | 'afterPhoto',
    label: string,
  ) {
    const uri = categories[categoryKey].photos[photoSlot];
    return (
      <View style={styles.photoSlotContainer}>
        <ThemedText variant="caption" color={Colors.textSecondary} style={styles.photoSlotLabel}>
          {label}
        </ThemedText>
        {uri ? (
          <View style={styles.photoPreviewContainer}>
            <Image source={{ uri }} style={styles.photoPreview} />
            <Pressable
              style={styles.photoRemoveBtn}
              onPress={() => removePhoto(categoryKey, photoSlot)}
              testID={`button-remove-photo-${categoryKey}-${photoSlot}`}
            >
              <Feather name="x" size={12} color={Colors.textInverse} />
            </Pressable>
            <View style={styles.photoCheckmark}>
              <Feather name="check-circle" size={16} color={Colors.success} />
            </View>
          </View>
        ) : (
          <View style={styles.photoCaptureRow}>
            <Pressable
              style={styles.photoCaptureBtn}
              onPress={() => capturePhoto(categoryKey, photoSlot)}
              testID={`button-capture-${categoryKey}-${photoSlot}`}
            >
              <Feather name="camera" size={20} color={Colors.primary} />
              <ThemedText variant="caption" color={Colors.primary}>Ta foto</ThemedText>
            </Pressable>
            {Platform.OS !== 'web' ? (
              <Pressable
                style={styles.photoPickBtn}
                onPress={() => pickPhoto(categoryKey, photoSlot)}
                testID={`button-pick-${categoryKey}-${photoSlot}`}
              >
                <Feather name="image" size={16} color={Colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    );
  }

  function renderPhotoSection(catKey: string, photoType: PhotoRequirement, isRequired: boolean) {
    if (photoType === 'none') return null;

    const isComplete = isCategoryPhotoComplete(catKey);
    const hasChecked = categories[catKey].status !== 'not_checked';

    return (
      <View style={styles.photoSection}>
        <View style={styles.photoSectionHeader}>
          <View style={styles.photoSectionTitleRow}>
            <Feather name="camera" size={14} color={isRequired ? Colors.primary : Colors.textSecondary} />
            <ThemedText variant="label" color={isRequired ? Colors.primary : Colors.textSecondary}>
              Foto {isRequired ? '(obligatoriskt)' : '(valfritt)'}
            </ThemedText>
          </View>
          {hasChecked && isRequired ? (
            isComplete ? (
              <View style={[styles.photoStatusBadge, { backgroundColor: Colors.successLight }]}>
                <Feather name="check" size={12} color={Colors.success} />
                <ThemedText variant="caption" color={Colors.success}>Klart</ThemedText>
              </View>
            ) : (
              <View style={[styles.photoStatusBadge, { backgroundColor: Colors.warningLight }]}>
                <Feather name="alert-triangle" size={12} color={Colors.warning} />
                <ThemedText variant="caption" color={Colors.warning}>Saknas</ThemedText>
              </View>
            )
          ) : null}
        </View>

        {photoType === 'single' ? (
          renderPhotoSlot(catKey, 'photo', 'Foto')
        ) : (
          <View style={styles.beforeAfterRow}>
            {renderPhotoSlot(catKey, 'beforePhoto', 'Före')}
            <View style={styles.beforeAfterDivider}>
              <Feather name="arrow-right" size={16} color={Colors.textMuted} />
            </View>
            {renderPhotoSlot(catKey, 'afterPhoto', 'Efter')}
          </View>
        )}
      </View>
    );
  }

  const checkedCount = Object.values(categories).filter(c => c.status !== 'not_checked').length;
  const hasIssues = Object.values(categories).some(c => c.status === 'warning' || c.status === 'error');
  const missingPhotos = getMissingPhotoCategories();
  const canSave = missingPhotos.length === 0;

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
          const photoMissing = cat.photoRequired && state.status !== 'not_checked' && !isCategoryPhotoComplete(cat.key);

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
                  {cat.photoRequired ? (
                    <Feather name="camera" size={14} color={photoMissing ? Colors.warning : Colors.textMuted} />
                  ) : null}
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

                  {renderPhotoSection(cat.key, cat.photoType, cat.photoRequired)}

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
          {missingPhotos.length > 0 ? (
            <View style={styles.issueWarning}>
              <Feather name="camera" size={14} color={Colors.danger} />
              <ThemedText variant="caption" color={Colors.danger}>
                Foto saknas: {missingPhotos.join(', ')}
              </ThemedText>
            </View>
          ) : null}
        </View>
        <Pressable
          style={[styles.saveButton, (saveMutation.isPending || !canSave) ? styles.saveButtonDisabled : null]}
          onPress={handleSave}
          disabled={saveMutation.isPending || !canSave}
          testID="button-save-inspection"
        >
          {saveMutation.isPending ? (
            <View style={styles.saveButtonLoading}>
              <ActivityIndicator color={Colors.textInverse} />
              {uploadProgress ? (
                <ThemedText variant="caption" color={Colors.textInverse}>
                  {uploadProgress}
                </ThemedText>
              ) : null}
            </View>
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
  photoSection: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  photoSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  photoSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  photoStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  photoSlotContainer: {
    flex: 1,
  },
  photoSlotLabel: {
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  photoPreviewContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCheckmark: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 10,
    padding: 2,
  },
  photoCaptureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  photoCaptureBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.primaryLight,
    borderStyle: 'dashed',
    minHeight: 80,
  },
  photoPickBtn: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  beforeAfterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  beforeAfterDivider: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: Spacing.lg,
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
    gap: Spacing.xs,
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
  saveButtonLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});
