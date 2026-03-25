import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Modal, Linking, Platform } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useResourceProfiles } from '../hooks/useResourceProfiles';
import { useTeam } from '../hooks/useTeam';
import { useDisruptionMonitor } from '../hooks/useDisruptionMonitor';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import type { ComponentProps } from 'react';
import type { Order, ResourceProfile, TeamMember } from '../types';

type FeatherIconName = ComponentProps<typeof Feather>['name'];

const PROFILE_ICON_MAP: Record<string, FeatherIconName> = {
  truck: 'truck',
  package: 'package',
  tool: 'tool',
  settings: 'settings',
  briefcase: 'briefcase',
  box: 'box',
  anchor: 'anchor',
  compass: 'compass',
  zap: 'zap',
  shield: 'shield',
};

function getProfileIcon(icon: string): FeatherIconName {
  return PROFILE_ICON_MAP[icon] || 'user';
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

export function ProfileScreen() {
  const navigation = useNavigation<any>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { user, logout, isOnline, setIsOnline } = useAuth();
  const { profiles, isLoading: profilesLoading } = useResourceProfiles();
  const { team, partner, isLeader } = useTeam();
  const { reportUnavailable } = useDisruptionMonitor();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showSickLeaveModal, setShowSickLeaveModal] = useState(false);
  const [sickLeaveLoading, setSickLeaveLoading] = useState(false);

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const completedToday = orders?.filter(o => o.status === 'completed' || o.status === 'utford').length || 0;
  const totalToday = orders?.length || 0;
  const initials = getInitials(user?.name);

  const handleCall = () => {
    if (user?.phone) {
      Linking.openURL(`tel:${user.phone}`);
    }
  };

  const handleEmail = () => {
    if (user?.email) {
      Linking.openURL(`mailto:${user.email}`);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + Spacing.xl },
      ]}
    >
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <ThemedText variant="heading" color="#fff" style={styles.initialsText}>
            {initials}
          </ThemedText>
        </View>
        <Pressable
          style={[styles.onlineBadge, isOnline ? styles.onlineBadgeActive : styles.onlineBadgeInactive]}
          onPress={() => setIsOnline(!isOnline)}
          testID="button-online-toggle"
        >
          <View style={[styles.onlineDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
          <ThemedText variant="caption" color={isOnline ? '#16A34A' : '#DC2626'} style={styles.onlineText}>
            {isOnline ? 'Online' : 'Offline'}
          </ThemedText>
        </Pressable>
      </View>

      <ThemedText variant="heading" style={styles.name}>
        {user?.name || 'Chaufför'}
      </ThemedText>
      <ThemedText variant="body" color={Colors.textSecondary} style={styles.role}>
        {user?.role === 'driver' ? 'Chaufför' : user?.role}
      </ThemedText>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <ThemedText variant="heading" color={Colors.primary} style={styles.statNumber}>
            {completedToday}
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>Klara</ThemedText>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <ThemedText variant="heading" color={Colors.secondary} style={styles.statNumber}>
            {totalToday}
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>Totalt</ThemedText>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <ThemedText variant="heading" color={Colors.warning} style={styles.statNumber}>
            {totalToday - completedToday}
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>Kvar</ThemedText>
        </View>
      </View>

      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <View style={[styles.infoIcon, { backgroundColor: Colors.primaryLight + '20' }]}>
            <Feather name="truck" size={16} color={Colors.primary} />
          </View>
          <View style={styles.infoContent}>
            <ThemedText variant="caption" color={Colors.textSecondary}>Fordon</ThemedText>
            <ThemedText variant="body">{user?.vehicleRegNo || 'Ej tilldelad'}</ThemedText>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <View style={[styles.infoIcon, { backgroundColor: Colors.secondaryLight + '40' }]}>
            <Feather name="hash" size={16} color={Colors.secondary} />
          </View>
          <View style={styles.infoContent}>
            <ThemedText variant="caption" color={Colors.textSecondary}>Resurs-ID</ThemedText>
            <ThemedText variant="body">{user?.resourceId || 'Ej tilldelad'}</ThemedText>
          </View>
        </View>
        <View style={styles.divider} />
        <Pressable
          style={styles.infoRow}
          onPress={user?.phone ? handleCall : undefined}
          disabled={!user?.phone}
          testID="button-call"
        >
          <View style={[styles.infoIcon, { backgroundColor: '#E8F5E9' }]}>
            <Feather name="phone" size={16} color={Colors.success} />
          </View>
          <View style={styles.infoContent}>
            <ThemedText variant="caption" color={Colors.textSecondary}>Telefon</ThemedText>
            <ThemedText variant="body" color={user?.phone ? Colors.primary : Colors.textMuted}>
              {user?.phone || 'Ej tilldelad'}
            </ThemedText>
          </View>
          {user?.phone ? <Feather name="external-link" size={14} color={Colors.textMuted} /> : null}
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={styles.infoRow}
          onPress={user?.email ? handleEmail : undefined}
          disabled={!user?.email}
          testID="button-email"
        >
          <View style={[styles.infoIcon, { backgroundColor: Colors.infoLight }]}>
            <Feather name="mail" size={16} color={Colors.info} />
          </View>
          <View style={styles.infoContent}>
            <ThemedText variant="caption" color={Colors.textSecondary}>E-post</ThemedText>
            <ThemedText variant="body" color={user?.email ? Colors.primary : Colors.textMuted}>
              {user?.email || 'Ej tilldelad'}
            </ThemedText>
          </View>
          {user?.email ? <Feather name="external-link" size={14} color={Colors.textMuted} /> : null}
        </Pressable>
      </Card>

      {profiles.length > 0 ? (
        <Card style={styles.profilesCard}>
          <View style={styles.profilesHeader}>
            <Feather name="briefcase" size={16} color={Colors.primary} />
            <ThemedText variant="label" style={styles.profilesTitle}>Mina profiler</ThemedText>
          </View>
          {profiles.map((profile: ResourceProfile, idx: number) => (
            <View key={String(profile.id)} style={[styles.profileItem, idx > 0 ? styles.profileItemBorder : null]}>
              <View style={styles.profileTop}>
                <View style={[styles.profileColorDot, { backgroundColor: profile.color }]} />
                <Feather name={getProfileIcon(profile.icon)} size={16} color={Colors.text} />
                <ThemedText variant="body" style={styles.profileName}>{profile.name}</ThemedText>
              </View>
              {profile.executionCodes.length > 0 ? (
                <View style={styles.profileTags}>
                  {profile.executionCodes.map((code: string) => (
                    <View key={code} style={styles.execCodeTag}>
                      <ThemedText variant="caption" color={Colors.primary} style={styles.tagText}>{code}</ThemedText>
                    </View>
                  ))}
                </View>
              ) : null}
              {profile.equipmentTypes.length > 0 ? (
                <View style={styles.profileTags}>
                  {profile.equipmentTypes.map((et: string) => (
                    <View key={et} style={styles.equipTag}>
                      <ThemedText variant="caption" color={Colors.textSecondary} style={styles.tagText}>{et}</ThemedText>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      <Pressable onPress={() => navigation.navigate('Team')} testID="button-team-section">
        <Card style={styles.profilesCard}>
          <View style={styles.profilesHeader}>
            <Feather name="users" size={16} color={Colors.secondary} />
            <ThemedText variant="label" style={styles.profilesTitle}>Mitt team</ThemedText>
            <Feather name="chevron-right" size={16} color={Colors.textMuted} />
          </View>
          {team ? (
            <>
              <View style={styles.teamHeaderRow}>
                <View style={[styles.teamColorDot, { backgroundColor: team.color }]} />
                <View style={styles.teamHeaderInfo}>
                  <ThemedText variant="body" style={styles.profileName}>{team.name}</ThemedText>
                  {team.description ? (
                    <ThemedText variant="caption" color={Colors.textSecondary}>{team.description}</ThemedText>
                  ) : null}
                </View>
                {isLeader ? (
                  <View style={styles.teamLeaderBadge}>
                    <Feather name="star" size={10} color={Colors.warning} />
                    <ThemedText variant="caption" color={Colors.warning}>Ledare</ThemedText>
                  </View>
                ) : null}
              </View>
              {team.members.map((member: TeamMember, idx: number) => (
                <View key={String(member.id)} style={[styles.teamMemberRow, idx > 0 ? styles.profileItemBorder : null]}>
                  <View style={styles.teamMemberInfo}>
                    <View style={styles.teamMemberNameRow}>
                      <View style={[styles.teamOnlineDot, { backgroundColor: member.isOnline ? Colors.success : Colors.textMuted }]} />
                      <ThemedText variant="body">{member.name}</ThemedText>
                      {member.role === 'leader' ? (
                        <Feather name="star" size={12} color={Colors.warning} style={styles.teamStarIcon} />
                      ) : member.role === 'substitute' ? (
                        <View style={styles.teamSubBadge}>
                          <ThemedText variant="caption" color={Colors.info}>Vikarie</ThemedText>
                        </View>
                      ) : null}
                    </View>
                    {member.phone ? (
                      <ThemedText variant="caption" color={Colors.textSecondary}>{member.phone}</ThemedText>
                    ) : null}
                  </View>
                  {member.phone ? (
                    <Pressable
                      onPress={() => Linking.openURL(`tel:${member.phone}`)}
                      hitSlop={8}
                      style={styles.teamCallButton}
                    >
                      <Feather name="phone" size={16} color={Colors.primary} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {team.projectCode ? (
                <View style={styles.teamFooter}>
                  <ThemedText variant="caption" color={Colors.textSecondary}>
                    Projektkod: {team.projectCode}
                  </ThemedText>
                </View>
              ) : null}
            </>
          ) : (
            <ThemedText variant="caption" color={Colors.textSecondary} style={{ marginTop: Spacing.sm }}>
              Inget team. Tryck för att skapa eller gå med.
            </ThemedText>
          )}
        </Card>
      </Pressable>

      <Card style={styles.menuCard}>
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('Settings')} testID="button-settings">
          <View style={styles.menuLeft}>
            <View style={[styles.menuIcon, { backgroundColor: '#F3E5F5' }]}>
              <Feather name="settings" size={16} color="#7B1FA2" />
            </View>
            <ThemedText variant="body">Inställningar</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('Statistics')} testID="button-statistics">
          <View style={styles.menuLeft}>
            <View style={[styles.menuIcon, { backgroundColor: Colors.primaryLight + '20' }]}>
              <Feather name="bar-chart-2" size={16} color={Colors.primary} />
            </View>
            <ThemedText variant="body">Statistik</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('Notifications')} testID="button-notifications">
          <View style={styles.menuLeft}>
            <View style={[styles.menuIcon, { backgroundColor: '#E3F2FD' }]}>
              <Feather name="bell" size={16} color="#2196F3" />
            </View>
            <ThemedText variant="body">Aviseringar</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('CustomerReports')} testID="button-customer-reports">
          <View style={styles.menuLeft}>
            <View style={[styles.menuIcon, { backgroundColor: '#E8F5E9' }]}>
              <Feather name="file-text" size={16} color={Colors.success} />
            </View>
            <ThemedText variant="body">Kundrapporter</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('MyDeviations')} testID="button-my-deviations">
          <View style={styles.menuLeft}>
            <View style={[styles.menuIcon, { backgroundColor: '#FFF3E0' }]}>
              <Feather name="alert-triangle" size={16} color="#E67E22" />
            </View>
            <ThemedText variant="body">Mina avvikelser</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('RouteFeedback')} testID="button-route-feedback">
          <View style={styles.menuLeft}>
            <View style={[styles.menuIcon, { backgroundColor: '#FFF8E1' }]}>
              <Feather name="star" size={16} color={Colors.warning} />
            </View>
            <ThemedText variant="body">Ruttbetyg</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={styles.menuItem}
          onPress={() => setShowSickLeaveModal(true)}
          testID="button-sick-leave"
        >
          <View style={styles.menuLeft}>
            <View style={[styles.menuIcon, { backgroundColor: '#FFEBEE' }]}>
              <Feather name="thermometer" size={16} color={Colors.danger} />
            </View>
            <ThemedText variant="body">Sjukanmälan</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.menuItem} onPress={() => navigation.navigate('Settings')} testID="button-about">
          <View style={styles.menuLeft}>
            <View style={[styles.menuIcon, { backgroundColor: Colors.infoLight }]}>
              <Feather name="info" size={16} color={Colors.info} />
            </View>
            <ThemedText variant="body">Om Traivo Go</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>
      </Card>

      <Pressable
        style={styles.logoutButton}
        onPress={() => setShowLogoutModal(true)}
        testID="button-logout"
      >
        <Feather name="log-out" size={18} color={Colors.danger} />
        <ThemedText variant="body" color={Colors.danger}>
          Logga ut
        </ThemedText>
      </Pressable>

      <ThemedText variant="caption" color={Colors.textMuted} style={styles.versionText}>
        Nordnav Go v1.0.0
      </ThemedText>

      <Modal
        visible={showSickLeaveModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSickLeaveModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSickLeaveModal(false)}>
          <View style={styles.modalContent}>
            <View style={[styles.modalIconCircle, { backgroundColor: '#FFEBEE' }]}>
              <Feather name="thermometer" size={24} color={Colors.danger} />
            </View>
            <ThemedText variant="subheading" style={styles.modalTitle}>
              Sjukanmälan
            </ThemedText>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.modalDesc}>
              Anmäl att du inte kan arbeta idag. Planeraren kommer att omfördela dina uppdrag.
            </ThemedText>
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setShowSickLeaveModal(false)}
                testID="button-cancel-sick"
              >
                <ThemedText variant="body" color={Colors.textSecondary}>Avbryt</ThemedText>
              </Pressable>
              <Pressable
                style={styles.modalLogoutButton}
                onPress={async () => {
                  setSickLeaveLoading(true);
                  try {
                    await reportUnavailable('sick');
                    setShowSickLeaveModal(false);
                  } catch {} finally {
                    setSickLeaveLoading(false);
                  }
                }}
                testID="button-confirm-sick"
              >
                <ThemedText variant="body" color={Colors.textInverse}>
                  {sickLeaveLoading ? 'Skickar...' : 'Bekräfta'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={showLogoutModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowLogoutModal(false)}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconCircle}>
              <Feather name="log-out" size={24} color={Colors.danger} />
            </View>
            <ThemedText variant="subheading" style={styles.modalTitle}>
              Logga ut?
            </ThemedText>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.modalDesc}>
              Du kommer att behöva logga in igen för att använda appen.
            </ThemedText>
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setShowLogoutModal(false)}
                testID="button-cancel-logout"
              >
                <ThemedText variant="body" color={Colors.textSecondary}>Avbryt</ThemedText>
              </Pressable>
              <Pressable
                style={styles.modalLogoutButton}
                onPress={() => {
                  setShowLogoutModal(false);
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
  avatarSection: {
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  initialsText: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
  },
  onlineBadgeActive: {
    backgroundColor: '#E8F5E9',
    borderColor: '#16A34A',
  },
  onlineBadgeInactive: {
    backgroundColor: '#FEF2F2',
    borderColor: '#DC2626',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotOnline: {
    backgroundColor: '#16A34A',
  },
  dotOffline: {
    backgroundColor: '#DC2626',
  },
  onlineText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  name: {
    marginBottom: Spacing.xs,
  },
  role: {
    marginBottom: Spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statNumber: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.borderLight,
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
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContent: {
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing.xs,
  },
  profilesCard: {
    width: '100%',
    marginBottom: Spacing.md,
  },
  profilesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  profilesTitle: {
    fontFamily: 'Inter_600SemiBold',
  },
  profileItem: {
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  profileItemBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  profileColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  profileName: {
    fontFamily: 'Inter_600SemiBold',
  },
  profileTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    paddingLeft: 26,
  },
  execCodeTag: {
    backgroundColor: Colors.primaryLight + '20',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  equipTag: {
    backgroundColor: Colors.background,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  tagText: {
    fontSize: 11,
  },
  teamHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  teamColorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  teamHeaderInfo: {
    flex: 1,
  },
  teamLeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.warning + '20',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  teamMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  teamMemberInfo: {
    flex: 1,
    gap: 2,
  },
  teamMemberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  teamOnlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  teamStarIcon: {
    marginLeft: 2,
  },
  teamSubBadge: {
    backgroundColor: Colors.infoLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    marginLeft: 4,
  },
  teamCallButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  teamFooter: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  menuCard: {
    width: '100%',
    marginBottom: Spacing.md,
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
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.dangerLight,
    backgroundColor: '#FFF5F5',
    width: '100%',
    justifyContent: 'center',
  },
  versionText: {
    marginTop: Spacing.lg,
    fontSize: 11,
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
    maxWidth: 320,
    alignItems: 'center',
  },
  modalIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    marginBottom: Spacing.sm,
  },
  modalDesc: {
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.background,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  modalLogoutButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.danger,
    alignItems: 'center',
  },
});
