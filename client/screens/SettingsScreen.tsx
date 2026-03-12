import React, { useState, useEffect } from 'react';
import { View, ScrollView, Switch, Pressable, StyleSheet, Platform, Linking } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';

const SETTINGS_KEY = 'driver_core_settings';

interface Settings {
  gpsTracking: boolean;
  notifications: boolean;
  hapticFeedback: boolean;
  offlineMode: boolean;
  darkMode: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  gpsTracking: true,
  notifications: true,
  hapticFeedback: true,
  offlineMode: false,
  darkMode: false,
};

export function SettingsScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      if (stored) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
      }
    } catch {}
  }

  async function updateSetting(key: keyof Settings, value: boolean) {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    } catch {}
  }

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
            onValueChange={(v) => updateSetting('gpsTracking', v)}
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
            onValueChange={(v) => updateSetting('notifications', v)}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={settings.notifications ? Colors.primary : Colors.textMuted}
            testID="switch-notifications"
          />
        </View>
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
            onValueChange={(v) => updateSetting('hapticFeedback', v)}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={settings.hapticFeedback ? Colors.primary : Colors.textMuted}
            testID="switch-haptic"
          />
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
            onValueChange={(v) => updateSetting('offlineMode', v)}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={settings.offlineMode ? Colors.primary : Colors.textMuted}
            testID="switch-offline"
          />
        </View>
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
        Nordnav Go v2.0 | Field Service
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
