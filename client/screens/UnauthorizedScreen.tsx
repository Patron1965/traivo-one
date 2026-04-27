import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useThemeColors } from '../context/BrandingContext';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';

export function UnauthorizedScreen() {
  useThemeColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const roleName = user?.role || 'okänd';

  return (
    <LinearGradient
      colors={[Colors.primaryDark, Colors.primary, Colors.primaryLight]}
      style={styles.gradient}
    >
      <View style={[styles.container, { paddingTop: insets.top + Spacing.xxxl, paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Feather name="shield-off" size={64} color="rgba(255,255,255,0.8)" />
          </View>

          <ThemedText variant="heading" color={Colors.textInverse} style={styles.title}>
            Ej behörig
          </ThemedText>

          <ThemedText variant="body" color="rgba(255,255,255,0.8)" style={styles.message}>
            Din roll ({roleName}) har inte behörighet att använda fältappen. Kontakta din administratör om du behöver åtkomst.
          </ThemedText>

          <View style={styles.infoCard}>
            <Feather name="info" size={18} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.text} style={styles.infoText}>
              Plannix GO är avsedd för tekniker, planerare och administratörer. Kontakta support om du anser att detta är fel.
            </ThemedText>
          </View>
        </View>

        <Pressable
          style={styles.logoutButton}
          onPress={logout}
          testID="button-logout-unauthorized"
        >
          <Feather name="log-out" size={20} color={Colors.textInverse} />
          <ThemedText variant="subheading" color={Colors.textInverse} style={{ fontSize: FontSize.lg }}>
            Logga ut
          </ThemedText>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xxl,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xl,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: Spacing.lg,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginTop: Spacing.md,
  },
  infoText: {
    flex: 1,
    lineHeight: 20,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: BorderRadius.lg,
    height: 56,
    gap: Spacing.sm,
  },
});
