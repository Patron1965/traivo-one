import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, Switch, Pressable, StyleSheet, Modal, Platform } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useSettings, MapApp } from '../lib/settings';
import { usePreferences } from '../hooks/usePreferences';
import { triggerHaptic } from '../utils/haptics';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';

const MAP_APP_OPTIONS: { value: MapApp; label: string; icon: string }[] = [
  { value: 'google', label: 'Google Maps', icon: 'map' },
  { value: 'apple', label: 'Apple Maps', icon: 'compass' },
  { value: 'waze', label: 'Waze', icon: 'navigation' },
];

export function SettingsScreen({ navigation }: { navigation: any }) {
  const styles = useThemedStyles(createSettingsStyles);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { settings, updateSetting } = useSettings();
  const { preferences, updatePreference } = usePreferences();
  const { isTracking, startTracking, stopTracking } = useGpsTracking();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    if (settings.gpsTracking !== isTracking) {
      if (settings.gpsTracking) {
        startTracking();
      } else {
        stopTracking();
      }
    }
  }, [settings.gpsTracking]);

  const handleToggle = useCallback(async (
    localKey: string,
    serverKey: string | null,
    value: boolean,
    extraFn?: () => void
  ) => {
    triggerHaptic('light');
    await updateSetting(localKey as any, value);
    if (serverKey) updatePreference(serverKey as any, value);
    if (extraFn) extraFn();
  }, [updateSetting, updatePreference]);

  const handleGpsToggle = useCallback(async (value: boolean) => {
    triggerHaptic('light');
    await updateSetting('gpsTracking', value);
    if (value) {
      startTracking();
    } else {
      stopTracking();
    }
  }, [updateSetting, startTracking, stopTracking]);

  const handleClearCache = useCallback(async () => {
    setClearingCache(true);
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(k =>
        k.startsWith('@offline_cache_') ||
        k.startsWith('@route_cache_') ||
        k === '@order_cache' ||
        k === '@offline_outbox' ||
        k === '@last_sync_time'
      );
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
    } catch {}
    setClearingCache(false);
    setShowClearConfirm(false);
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl },
      ]}
    >
      <ThemedText variant="caption" color={Colors.textSecondary} style={styles.sectionLabel}>
        SPÅRNING
      </ThemedText>
      <Card style={styles.sectionCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: Colors.infoLight }]}>
              <Feather name="navigation" size={16} color={Colors.primary} />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body">GPS-spårning</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Skicka position till planerare
              </ThemedText>
            </View>
          </View>
          <Switch
            value={settings.gpsTracking}
            onValueChange={handleGpsToggle}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={settings.gpsTracking ? Colors.primary : Colors.textMuted}
            testID="switch-gps"
          />
        </View>
      </Card>

      <ThemedText variant="caption" color={Colors.textSecondary} style={styles.sectionLabel}>
        NOTISER
      </ThemedText>
      <Card style={styles.sectionCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: Colors.warningLight }]}>
              <Feather name="bell" size={16} color={Colors.warning} />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body">Push-notiser</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Ruttändringar och nya uppdrag
              </ThemedText>
            </View>
          </View>
          <Switch
            value={settings.notifications}
            onValueChange={(v) => handleToggle('notifications', 'pushEnabled', v)}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={settings.notifications ? Colors.primary : Colors.textMuted}
            testID="switch-notifications"
          />
        </View>
        <View style={styles.divider} />
        <Pressable
          style={styles.clearCacheRow}
          onPress={() => navigation.navigate('NotificationPrefs')}
          testID="button-sms-prefs"
        >
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: Colors.accentLight }]}>
              <Feather name="message-square" size={16} color={Colors.accent} />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body">SMS-inställningar</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Välj vilka SMS du får från systemet
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
      </Card>

      <ThemedText variant="caption" color={Colors.textSecondary} style={styles.sectionLabel}>
        UPPLEVELSE
      </ThemedText>
      <Card style={styles.sectionCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: '#F0E6FF' }]}>
              <Feather name="smartphone" size={16} color="#7C3AED" />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body">Haptisk feedback</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Vibrera vid statusändringar
              </ThemedText>
            </View>
          </View>
          <Switch
            value={settings.hapticFeedback}
            onValueChange={(v) => handleToggle('hapticFeedback', 'hapticFeedback', v)}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={settings.hapticFeedback ? Colors.primary : Colors.textMuted}
            testID="switch-haptic"
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: '#E8F0FE' }]}>
              <Feather name="moon" size={16} color="#5B6ABF" />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body">Mörkt läge</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Kommer snart
              </ThemedText>
            </View>
          </View>
          <Switch
            value={settings.darkMode}
            onValueChange={(v) => handleToggle('darkMode', 'darkMode', v)}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={settings.darkMode ? Colors.primary : Colors.textMuted}
            testID="switch-darkmode"
          />
        </View>
      </Card>

      <ThemedText variant="caption" color={Colors.textSecondary} style={styles.sectionLabel}>
        NAVIGATION
      </ThemedText>
      <Card style={styles.sectionCard}>
        <View style={styles.mapAppHeader}>
          <View style={[styles.iconCircle, { backgroundColor: Colors.accentLight }]}>
            <Feather name="map-pin" size={16} color={Colors.accent} />
          </View>
          <ThemedText variant="body" style={{ flex: 1 }}>Kartapp</ThemedText>
        </View>
        <View style={styles.mapAppOptions}>
          {MAP_APP_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={[
                styles.mapAppButton,
                settings.mapApp === opt.value ? styles.mapAppButtonActive : null,
              ]}
              onPress={() => updateSetting('mapApp', opt.value)}
              testID={`button-map-${opt.value}`}
            >
              <Feather
                name={opt.icon as React.ComponentProps<typeof Feather>['name']}
                size={16}
                color={settings.mapApp === opt.value ? Colors.primary : Colors.textMuted}
              />
              <ThemedText
                variant="caption"
                color={settings.mapApp === opt.value ? Colors.primary : Colors.textSecondary}
                style={settings.mapApp === opt.value ? styles.mapAppLabelActive : undefined}
              >
                {opt.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </Card>

      <ThemedText variant="caption" color={Colors.textSecondary} style={styles.sectionLabel}>
        DATA
      </ThemedText>
      <Card style={styles.sectionCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: Colors.secondaryLight }]}>
              <Feather name="wifi-off" size={16} color={Colors.secondary} />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body">Offline-läge</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Spara data lokalt vid dålig uppkoppling
              </ThemedText>
            </View>
          </View>
          <Switch
            value={settings.offlineMode}
            onValueChange={(v) => handleToggle('offlineMode', null, v)}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={settings.offlineMode ? Colors.primary : Colors.textMuted}
            testID="switch-offline"
          />
        </View>
        <View style={styles.divider} />
        <Pressable
          style={styles.clearCacheRow}
          onPress={() => setShowClearConfirm(true)}
          testID="button-clear-cache"
        >
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: Colors.dangerLight }]}>
              <Feather name="trash-2" size={16} color={Colors.danger} />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body" color={Colors.danger}>Rensa cache</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Radera sparad ruttdata och offlinedata
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
      </Card>

      <ThemedText variant="caption" color={Colors.textSecondary} style={styles.sectionLabel}>
        KONTO
      </ThemedText>
      <Card style={styles.sectionCard}>
        <View style={styles.infoRow}>
          <Feather name="user" size={16} color={Colors.textSecondary} />
          <View style={styles.infoContent}>
            <ThemedText variant="caption" color={Colors.textSecondary}>Namn</ThemedText>
            <ThemedText variant="body">{user?.name || '-'}</ThemedText>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Feather name="mail" size={16} color={Colors.textSecondary} />
          <View style={styles.infoContent}>
            <ThemedText variant="caption" color={Colors.textSecondary}>E-post</ThemedText>
            <ThemedText variant="body">{user?.email || '-'}</ThemedText>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Feather name="phone" size={16} color={Colors.textSecondary} />
          <View style={styles.infoContent}>
            <ThemedText variant="caption" color={Colors.textSecondary}>Telefon</ThemedText>
            <ThemedText variant="body">{user?.phone || '-'}</ThemedText>
          </View>
        </View>
      </Card>

      <ThemedText variant="caption" color={Colors.textMuted} style={styles.versionText}>
        Plannix Go v2.0 | Field Service
      </ThemedText>

      <Modal
        visible={showClearConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowClearConfirm(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowClearConfirm(false)}>
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <View style={styles.modalIconWrap}>
              <Feather name="trash-2" size={28} color={Colors.danger} />
            </View>
            <ThemedText variant="heading" style={styles.modalTitle}>
              Rensa cache?
            </ThemedText>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.modalMessage}>
              Detta raderar sparad ruttdata, offlinedata och synkkö. Du kan behöva ladda om appen efteråt.
            </ThemedText>
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setShowClearConfirm(false)}
                testID="button-cancel-clear"
              >
                <ThemedText variant="body" color={Colors.textSecondary}>Avbryt</ThemedText>
              </Pressable>
              <Pressable
                style={styles.modalConfirmButton}
                onPress={handleClearCache}
                disabled={clearingCache}
                testID="button-confirm-clear"
              >
                <ThemedText variant="body" color={Colors.textInverse}>
                  {clearingCache ? 'Rensar...' : 'Rensa'}
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const createSettingsStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  sectionLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    fontSize: FontSize.xs,
  },
  sectionCard: {
    width: '100%',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
    marginRight: Spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingText: {
    flex: 1,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  infoContent: {
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing.xs,
  },
  versionText: {
    textAlign: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  mapAppHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  mapAppOptions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  mapAppButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  mapAppButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.infoLight,
  },
  mapAppLabelActive: {
    fontFamily: 'Inter_600SemiBold',
  },
  clearCacheRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  modalIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.dangerLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  modalMessage: {
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  modalCancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalConfirmButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.danger,
  },
});
