import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Pressable, StyleSheet, Modal, Animated, Easing,
  PanResponder, Dimensions, ScrollView, Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useUnreadCount } from '../hooks/useNotifications';
import { useQuery } from '@tanstack/react-query';
import { ThemedText } from './ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';
import { hapticLight, hapticSelection } from '../utils/haptics';
import type { ComponentProps } from 'react';
import type { Order } from '../types';

type FeatherName = ComponentProps<typeof Feather>['name'];

const PANEL_WIDTH = Dimensions.get('window').width * 0.82;

interface MenuItem {
  id: string;
  label: string;
  icon: FeatherName;
  screen?: string;
  color: string;
  bgColor: string;
  badge?: number;
  separator?: boolean;
  onPress?: () => void;
}

function QuickStatsWidget() {
  const { data: orders } = useQuery<Order[]>({ queryKey: ['/api/mobile/my-orders'] });
  const completed = orders?.filter(o =>
    o.status === 'completed' || o.status === 'utford' || o.status === 'avslutad'
  ).length || 0;
  const total = orders?.length || 0;

  return (
    <View style={qStyles.container}>
      <View style={qStyles.row}>
        <View style={qStyles.stat}>
          <ThemedText variant="heading" color={Colors.primary} style={qStyles.num}>
            {completed}/{total}
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>Klara</ThemedText>
        </View>
        <View style={qStyles.divider} />
        <View style={qStyles.stat}>
          <ThemedText variant="heading" color={Colors.success} style={qStyles.num}>
            {total - completed}
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>Kvar</ThemedText>
        </View>
      </View>
    </View>
  );
}

const qStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', flex: 1 },
  num: { fontSize: 20 },
  divider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
});

function HamburgerMenuModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(createHamburgerMenuStyles);
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user, logout, isOnline, setIsOnline } = useAuth();
  const unreadCount = useUnreadCount();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const slideAnim = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsRendered(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -PANEL_WIDTH,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start(() => setIsRendered(false));
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => gs.dx < -10 && Math.abs(gs.dy) < 30,
      onPanResponderMove: (_, gs) => {
        if (gs.dx < 0) slideAnim.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -80 || gs.vx < -0.5) {
          onClose();
        } else {
          Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const navigateTo = (screen: string) => {
    hapticSelection();
    onClose();
    setTimeout(() => navigation.navigate(screen), 150);
  };

  const initials = useMemo(() => {
    if (!user?.name) return '?';
    const parts = user.name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return user.name.substring(0, 2).toUpperCase();
  }, [user?.name]);

  const menuItems: MenuItem[] = [
    { id: 'ai', label: 'AI-Assistent', icon: 'cpu', screen: 'AIAssistant', color: '#7C3AED', bgColor: '#F0E6FF' },
    { id: 'notifications', label: 'Aviseringar', icon: 'bell', screen: 'Notifications', color: '#2196F3', bgColor: '#E3F2FD', badge: unreadCount },
    { id: 'team', label: 'Mitt team', icon: 'users', screen: 'Team', color: Colors.secondary, bgColor: Colors.secondaryLight + '40' },
    { id: 'sep1', label: '', icon: 'minus', color: '', bgColor: '', separator: true },
    { id: 'statistics', label: 'Statistik', icon: 'bar-chart-2', screen: 'Statistics', color: Colors.primary, bgColor: Colors.primaryLight + '20' },
    { id: 'customerReports', label: 'Kundrapporter', icon: 'file-text', screen: 'CustomerReports', color: Colors.success, bgColor: '#E8F5E9' },
    { id: 'deviations', label: 'Mina avvikelser', icon: 'alert-triangle', screen: 'MyDeviations', color: '#E67E22', bgColor: '#FFF3E0' },
    { id: 'routeFeedback', label: 'Ruttbetyg', icon: 'star', screen: 'RouteFeedback', color: Colors.warning, bgColor: '#FFF8E1' },
    { id: 'sep2', label: '', icon: 'minus', color: '', bgColor: '', separator: true },
    { id: 'profile', label: 'Min profil', icon: 'user', screen: 'Profile', color: Colors.info, bgColor: Colors.infoLight },
    { id: 'settings', label: 'Inställningar', icon: 'settings', screen: 'Settings', color: '#7B1FA2', bgColor: '#F3E5F5' },
    { id: 'about', label: 'Om Plannix Go', icon: 'info', screen: 'Settings', color: Colors.info, bgColor: Colors.infoLight },
  ];

  if (!isRendered) return null;

  return (
    <Modal transparent visible={isRendered} statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }} testID="screen-HamburgerMenu">
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: overlayAnim }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          {...panResponder.panHandlers}
          style={[styles.panel, { width: PANEL_WIDTH, transform: [{ translateX: slideAnim }] }]}
        >
          <ScrollView
            contentContainerStyle={[styles.panelContent, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.userSection}>
              <View style={styles.avatar}>
                <ThemedText variant="heading" color="#fff" style={styles.initialsText}>
                  {initials}
                </ThemedText>
              </View>
              <View style={styles.userInfo}>
                <ThemedText variant="subheading" numberOfLines={1}>{user?.name || 'Chauffor'}</ThemedText>
                <ThemedText variant="caption" color={Colors.textSecondary}>
                  {user?.role === 'driver' ? 'Chauffor' : user?.role}
                </ThemedText>
              </View>
              <Pressable
                style={[styles.onlineBadge, isOnline ? styles.onlineActive : styles.onlineInactive]}
                onPress={() => setIsOnline(!isOnline)}
                testID="button-menu-online-toggle"
              >
                <View style={[styles.onlineDot, { backgroundColor: isOnline ? '#16A34A' : '#DC2626' }]} />
                <ThemedText variant="caption" color={isOnline ? '#16A34A' : '#DC2626'} style={styles.onlineLabel}>
                  {isOnline ? 'Online' : 'Offline'}
                </ThemedText>
              </Pressable>
            </View>

            <QuickStatsWidget />

            {menuItems.map((item) => {
              if (item.separator) {
                return <View key={item.id} style={styles.separator} />;
              }
              return (
                <Pressable
                  key={item.id}
                  style={styles.menuItem}
                  onPress={() => {
                    if (item.onPress) {
                      item.onPress();
                    } else if (item.screen) {
                      navigateTo(item.screen);
                    }
                  }}
                  testID={`button-menu-${item.id}`}
                >
                  <View style={[styles.menuIcon, { backgroundColor: item.bgColor }]}>
                    <Feather name={item.icon} size={18} color={item.color} />
                  </View>
                  <ThemedText variant="body" style={styles.menuLabel}>{item.label}</ThemedText>
                  {item.badge && item.badge > 0 ? (
                    <View style={styles.badgeContainer}>
                      <ThemedText variant="caption" color="#fff" style={styles.badgeText}>
                        {item.badge > 99 ? '99+' : item.badge}
                      </ThemedText>
                    </View>
                  ) : (
                    <Feather name="chevron-right" size={16} color={Colors.textMuted} />
                  )}
                </Pressable>
              );
            })}

            <View style={styles.separator} />

            <Pressable
              style={styles.logoutItem}
              onPress={() => setShowLogoutConfirm(true)}
              testID="button-menu-logout"
            >
              <View style={[styles.menuIcon, { backgroundColor: '#FFEBEE' }]}>
                <Feather name="log-out" size={18} color={Colors.danger} />
              </View>
              <ThemedText variant="body" color={Colors.danger}>Logga ut</ThemedText>
            </Pressable>

            <ThemedText variant="caption" color={Colors.textMuted} style={styles.versionText}>
              Plannix Go v2.0
            </ThemedText>
          </ScrollView>
        </Animated.View>
      </View>

      <Modal
        visible={showLogoutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoutConfirm(false)}
      >
        <Pressable style={styles.confirmOverlay} onPress={() => setShowLogoutConfirm(false)}>
          <View style={styles.confirmContent}>
            <View style={styles.confirmIcon}>
              <Feather name="log-out" size={24} color={Colors.danger} />
            </View>
            <ThemedText variant="subheading" style={styles.confirmTitle}>Logga ut?</ThemedText>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.confirmDesc}>
              Du kommer att behova logga in igen for att anvanda appen.
            </ThemedText>
            <View style={styles.confirmButtons}>
              <Pressable
                style={styles.confirmCancelBtn}
                onPress={() => setShowLogoutConfirm(false)}
                testID="button-cancel-logout"
              >
                <ThemedText variant="body" color={Colors.textSecondary}>Avbryt</ThemedText>
              </Pressable>
              <Pressable
                style={styles.confirmLogoutBtn}
                onPress={() => {
                  setShowLogoutConfirm(false);
                  onClose();
                  logout();
                }}
                testID="button-confirm-logout"
              >
                <ThemedText variant="body" color={Colors.textInverse}>Logga ut</ThemedText>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </Modal>
  );
}

export function HamburgerMenuButton() {
  const styles = useThemedStyles(createHamburgerMenuStyles);
  const [visible, setVisible] = useState(false);
  const unreadCount = useUnreadCount();

  return (
    <>
      <Pressable
        onPress={() => {
          hapticLight();
          setVisible(true);
        }}
        hitSlop={12}
        style={styles.menuButton}
        testID="button-hamburger-menu"
      >
        <Feather name="menu" size={24} color={Colors.text} />
        {unreadCount > 0 ? <View style={styles.menuBadgeDot} /> : null}
      </Pressable>
      <HamburgerMenuModal visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

const createHamburgerMenuStyles = () => StyleSheet.create({
  menuButton: {
    position: 'relative',
    padding: 4,
  },
  menuBadgeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  panel: {
    backgroundColor: Colors.surface,
    height: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  panelContent: {
    paddingHorizontal: Spacing.lg,
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  userInfo: {
    flex: 1,
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
  },
  onlineActive: {
    backgroundColor: '#E8F5E9',
    borderColor: '#16A34A',
  },
  onlineInactive: {
    backgroundColor: '#FEF2F2',
    borderColor: '#DC2626',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  onlineLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.md,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
  },
  badgeContainer: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    lineHeight: 14,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing.sm,
  },
  logoutItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.md,
  },
  versionText: {
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  confirmContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  confirmIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFEBEE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  confirmTitle: {
    marginBottom: Spacing.sm,
    textAlign: 'center',
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
  confirmCancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmLogoutBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.danger,
  },
});
