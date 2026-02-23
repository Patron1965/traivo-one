import React from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';

export function ProfileScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { user, logout } = useAuth();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + Spacing.xl },
      ]}
    >
      <View style={styles.avatar}>
        <Feather name="user" size={40} color={Colors.primary} />
      </View>
      <ThemedText variant="heading" style={styles.name}>
        {user?.name || 'Chaufför'}
      </ThemedText>
      <ThemedText variant="body" color={Colors.textSecondary} style={styles.role}>
        {user?.role === 'driver' ? 'Chaufför' : user?.role}
      </ThemedText>

      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Feather name="truck" size={18} color={Colors.primary} />
          <View style={styles.infoContent}>
            <ThemedText variant="caption">Fordon</ThemedText>
            <ThemedText variant="body">{user?.vehicleRegNo || '-'}</ThemedText>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Feather name="hash" size={18} color={Colors.primary} />
          <View style={styles.infoContent}>
            <ThemedText variant="caption">Resurs-ID</ThemedText>
            <ThemedText variant="body">{user?.resourceId || '-'}</ThemedText>
          </View>
        </View>
      </Card>

      <Card style={styles.menuCard}>
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('Settings')} testID="button-settings">
          <View style={styles.menuLeft}>
            <Feather name="settings" size={18} color={Colors.textSecondary} />
            <ThemedText variant="body">Inställningar</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('Settings')} testID="button-about">
          <View style={styles.menuLeft}>
            <Feather name="info" size={18} color={Colors.textSecondary} />
            <ThemedText variant="body">Om Driver Core</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
      </Card>

      <Pressable style={styles.logoutButton} onPress={logout} testID="button-logout">
        <Feather name="log-out" size={18} color={Colors.danger} />
        <ThemedText variant="body" color={Colors.danger}>
          Logga ut
        </ThemedText>
      </Pressable>
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
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.infoLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  name: {
    marginBottom: Spacing.xs,
  },
  role: {
    marginBottom: Spacing.xl,
  },
  infoCard: {
    width: '100%',
    marginBottom: Spacing.md,
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
  menuCard: {
    width: '100%',
    marginBottom: Spacing.xl,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
});
