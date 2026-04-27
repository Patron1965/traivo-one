import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
  Alert,
  RefreshControl,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTeam } from '../hooks/useTeam';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/query-client';
import { Card } from '../components/Card';
import { ThemedText } from '../components/ThemedText';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';
import type { TeamMember, Order } from '../types';

const TEAM_COLORS = [
  { label: 'Teal', value: '#4A9B9B' },
  { label: 'Blå', value: '#1B4B6B' },
  { label: 'Grön', value: '#4CAF50' },
  { label: 'Orange', value: '#FF9800' },
  { label: 'Lila', value: '#9C27B0' },
  { label: 'Röd', value: '#E53935' },
];

export function TeamScreen() {
  const styles = useThemedStyles(createTeamStyles);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { token, user } = useAuth();
  const { team, partner, isLeader, isLoading, refetch } = useTeam();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [teamOrders, setTeamOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createColor, setCreateColor] = useState(TEAM_COLORS[0].value);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    if (team) await loadTeamOrders();
    setRefreshing(false);
  }, [refetch, team]);

  const loadTeamOrders = useCallback(async () => {
    if (!token) return;
    setLoadingOrders(true);
    try {
      const data = await apiRequest('GET', '/api/mobile/team-orders', undefined, token);
      const orders = Array.isArray(data) ? data : [];
      setTeamOrders(orders);
    } catch {}
    setLoadingOrders(false);
  }, [token]);

  React.useEffect(() => {
    if (team && token) loadTeamOrders();
  }, [team, token, loadTeamOrders]);

  const handleCreateTeam = async () => {
    if (!createName.trim() || !token) return;
    setActionLoading(true);
    try {
      await apiRequest('POST', '/api/mobile/teams', {
        name: createName.trim(),
        description: createDescription.trim(),
        color: createColor,
      }, token);
      setShowCreateModal(false);
      setCreateName('');
      setCreateDescription('');
      await refetch();
    } catch {
      Alert.alert('Fel', 'Kunde inte skapa team. Försök igen.');
    }
    setActionLoading(false);
  };

  const handleSearchResources = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2 || !token) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const data = await apiRequest('GET', `/api/mobile/resources/search?q=${encodeURIComponent(q)}`, undefined, token);
      setSearchResults(Array.isArray(data) ? data : []);
    } catch { setSearchResults([]); }
    setSearching(false);
  };

  const handleInvite = async (resourceId: number | string) => {
    if (!team || !token) return;
    setActionLoading(true);
    try {
      await apiRequest('POST', `/api/mobile/teams/${team.id}/invite`, { resourceId }, token);
      Alert.alert('Klart', 'Inbjudan skickad!');
      setShowInviteModal(false);
      setSearchQuery('');
      setSearchResults([]);
      await refetch();
    } catch {
      Alert.alert('Fel', 'Kunde inte skicka inbjudan.');
    }
    setActionLoading(false);
  };

  const handleLeaveTeam = () => {
    if (!team || !token) return;
    Alert.alert(
      'Lämna team',
      `Vill du verkligen lämna ${team.name}?`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Lämna',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await apiRequest('POST', `/api/mobile/teams/${team.id}/leave`, {}, token);
              await refetch();
            } catch {
              Alert.alert('Fel', 'Kunde inte lämna teamet.');
            }
            setActionLoading(false);
          },
        },
      ],
    );
  };

  const handleDeleteTeam = () => {
    if (!team || !token) return;
    Alert.alert(
      'Ta bort team',
      `Vill du verkligen ta bort ${team.name}? Alla medlemmar kommer att tas bort.`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Ta bort',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await apiRequest('DELETE', `/api/mobile/teams/${team.id}`, undefined, token);
              await refetch();
            } catch {
              Alert.alert('Fel', 'Kunde inte ta bort teamet.');
            }
            setActionLoading(false);
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { paddingTop: headerHeight }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <ThemedText variant="caption" color={Colors.textSecondary} style={{ marginTop: Spacing.md }}>
          Laddar teaminfo...
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      testID="screen-Team"
    >
      {team && team.status === 'active' ? (
        <>
          <Card style={styles.teamCard}>
            <View style={styles.teamHeader}>
              <View style={[styles.teamColorBar, { backgroundColor: team.color }]} />
              <View style={styles.teamHeaderContent}>
                <ThemedText variant="title" style={styles.teamName}>{team.name}</ThemedText>
                {team.description ? (
                  <ThemedText variant="caption" color={Colors.textSecondary}>{team.description}</ThemedText>
                ) : null}
              </View>
              {isLeader ? (
                <View style={styles.leaderBadge}>
                  <Feather name="star" size={12} color={Colors.warning} />
                  <ThemedText variant="caption" color={Colors.warning}>Ledare</ThemedText>
                </View>
              ) : null}
            </View>
            {team.projectCode ? (
              <View style={styles.metaRow}>
                <Feather name="hash" size={14} color={Colors.textMuted} />
                <ThemedText variant="caption" color={Colors.textSecondary}>{team.projectCode}</ThemedText>
              </View>
            ) : null}
            {team.serviceArea && team.serviceArea.length > 0 ? (
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={14} color={Colors.textMuted} />
                <ThemedText variant="caption" color={Colors.textSecondary}>
                  Område: {team.serviceArea.join(', ')}
                </ThemedText>
              </View>
            ) : null}
          </Card>

          <Card style={styles.membersCard}>
            <View style={styles.sectionHeader}>
              <Feather name="users" size={16} color={Colors.secondary} />
              <ThemedText variant="label" style={styles.sectionTitle}>
                Medlemmar ({team.members.length})
              </ThemedText>
              {isLeader ? (
                <Pressable
                  style={styles.addButton}
                  onPress={() => setShowInviteModal(true)}
                  testID="button-invite-member"
                >
                  <Feather name="user-plus" size={16} color={Colors.primary} />
                </Pressable>
              ) : null}
            </View>
            {team.members.map((member: TeamMember, idx: number) => (
              <View
                key={String(member.id)}
                style={[styles.memberRow, idx > 0 ? styles.memberBorder : null]}
                testID={`team-member-${idx}`}
              >
                <View style={styles.memberLeft}>
                  <View style={[styles.onlineDot, { backgroundColor: member.isOnline ? Colors.success : Colors.textMuted }]} />
                  <View style={styles.memberInfo}>
                    <View style={styles.memberNameRow}>
                      <ThemedText variant="body" style={styles.memberName}>{member.name}</ThemedText>
                      {member.role === 'leader' ? (
                        <Feather name="star" size={12} color={Colors.warning} />
                      ) : member.role === 'substitute' ? (
                        <View style={styles.subBadge}>
                          <ThemedText variant="caption" color={Colors.info} style={styles.subText}>Vikarie</ThemedText>
                        </View>
                      ) : null}
                    </View>
                    <ThemedText variant="caption" color={Colors.textSecondary}>
                      {member.isOnline ? 'Online' : 'Offline'}
                      {member.phone ? ` · ${member.phone}` : ''}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.memberActions}>
                  {member.phone ? (
                    <Pressable
                      style={styles.iconButton}
                      onPress={() => Linking.openURL(`tel:${member.phone}`)}
                      hitSlop={8}
                      testID={`button-call-${member.resourceId}`}
                    >
                      <Feather name="phone" size={16} color={Colors.primary} />
                    </Pressable>
                  ) : null}
                  {member.email ? (
                    <Pressable
                      style={styles.iconButton}
                      onPress={() => Linking.openURL(`mailto:${member.email}`)}
                      hitSlop={8}
                    >
                      <Feather name="mail" size={16} color={Colors.secondary} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>

          <Card style={styles.ordersCard}>
            <View style={styles.sectionHeader}>
              <Feather name="clipboard" size={16} color={Colors.secondary} />
              <ThemedText variant="label" style={styles.sectionTitle}>Teamordrar idag</ThemedText>
              {loadingOrders ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
            </View>
            {teamOrders.length > 0 ? (
              teamOrders.map((order, idx) => (
                <Pressable
                  key={String(order.id)}
                  style={[styles.orderRow, idx > 0 ? styles.memberBorder : null]}
                  onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                  testID={`team-order-${order.id}`}
                >
                  <View style={styles.orderInfo}>
                    <ThemedText variant="body" numberOfLines={1}>{order.customerName}</ThemedText>
                    <ThemedText variant="caption" color={Colors.textSecondary} numberOfLines={1}>
                      {order.address} · {order.scheduledTimeStart || ''}
                      {order.assigneeName ? ` · ${order.assigneeName}` : ''}
                    </ThemedText>
                  </View>
                  <StatusBadge status={order.status} size="sm" />
                </Pressable>
              ))
            ) : (
              <ThemedText variant="caption" color={Colors.textSecondary} style={styles.emptyText}>
                {loadingOrders ? 'Laddar...' : 'Inga teamordrar idag'}
              </ThemedText>
            )}
          </Card>

          <View style={styles.actionButtons}>
            {isLeader ? (
              <Pressable style={styles.dangerButton} onPress={handleDeleteTeam} testID="button-delete-team">
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Feather name="trash-2" size={16} color="#fff" />
                    <Text style={styles.dangerButtonText}>Ta bort team</Text>
                  </>
                )}
              </Pressable>
            ) : (
              <Pressable style={styles.warningButton} onPress={handleLeaveTeam} testID="button-leave-team">
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Feather name="log-out" size={16} color="#fff" />
                    <Text style={styles.warningButtonText}>Lämna team</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </>
      ) : (
        <View style={styles.noTeamContainer}>
          <Card style={styles.noTeamCard}>
            <View style={styles.noTeamIcon}>
              <Feather name="users" size={48} color={Colors.textMuted} />
            </View>
            <ThemedText variant="title" style={styles.noTeamTitle}>Inget team</ThemedText>
            <ThemedText variant="body" color={Colors.textSecondary} style={styles.noTeamDescription}>
              Du är inte med i något team just nu. Skapa ett nytt team eller vänta på en inbjudan.
            </ThemedText>
            <Pressable
              style={styles.createButton}
              onPress={() => setShowCreateModal(true)}
              testID="button-create-team"
            >
              <Feather name="plus" size={18} color="#fff" />
              <Text style={styles.createButtonText}>Skapa team</Text>
            </Pressable>
          </Card>
        </View>
      )}

      <Modal visible={showCreateModal} animationType="slide" transparent testID="modal-create-team">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <ThemedText variant="title">Skapa team</ThemedText>
              <Pressable onPress={() => setShowCreateModal(false)} hitSlop={8}>
                <Feather name="x" size={24} color={Colors.text} />
              </Pressable>
            </View>

            <ThemedText variant="label" style={styles.inputLabel}>Teamnamn</ThemedText>
            <TextInput
              style={styles.input}
              value={createName}
              onChangeText={setCreateName}
              placeholder="T.ex. Team Centrum"
              placeholderTextColor={Colors.textMuted}
              testID="input-team-name"
            />

            <ThemedText variant="label" style={styles.inputLabel}>Beskrivning</ThemedText>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={createDescription}
              onChangeText={setCreateDescription}
              placeholder="Valfri beskrivning..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={2}
              testID="input-team-description"
            />

            <ThemedText variant="label" style={styles.inputLabel}>Färg</ThemedText>
            <View style={styles.colorPicker}>
              {TEAM_COLORS.map((c) => (
                <Pressable
                  key={c.value}
                  style={[
                    styles.colorOption,
                    { backgroundColor: c.value },
                    createColor === c.value ? styles.colorSelected : null,
                  ]}
                  onPress={() => setCreateColor(c.value)}
                />
              ))}
            </View>

            <Pressable
              style={[styles.createButton, !createName.trim() ? styles.buttonDisabled : null]}
              onPress={handleCreateTeam}
              disabled={!createName.trim() || actionLoading}
              testID="button-confirm-create"
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="plus" size={16} color="#fff" />
                  <Text style={styles.createButtonText}>Skapa</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showInviteModal} animationType="slide" transparent testID="modal-invite-member">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <ThemedText variant="title">Bjud in medlem</ThemedText>
              <Pressable onPress={() => { setShowInviteModal(false); setSearchQuery(''); setSearchResults([]); }} hitSlop={8}>
                <Feather name="x" size={24} color={Colors.text} />
              </Pressable>
            </View>

            <ThemedText variant="label" style={styles.inputLabel}>Sök förare</ThemedText>
            <TextInput
              style={styles.input}
              value={searchQuery}
              onChangeText={handleSearchResources}
              placeholder="Skriv namn..."
              placeholderTextColor={Colors.textMuted}
              testID="input-search-driver"
            />

            {searching ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: Spacing.md }} />
            ) : null}

            {searchResults.map((r) => {
              const alreadyMember = team?.members.some(m => String(m.resourceId) === String(r.id));
              return (
                <View key={String(r.id)} style={styles.searchResultRow}>
                  <View style={styles.searchResultInfo}>
                    <ThemedText variant="body">{r.name}</ThemedText>
                    <ThemedText variant="caption" color={Colors.textSecondary}>{r.phone || r.email || ''}</ThemedText>
                  </View>
                  {alreadyMember ? (
                    <View style={styles.alreadyBadge}>
                      <ThemedText variant="caption" color={Colors.success}>Redan med</ThemedText>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.inviteButton}
                      onPress={() => handleInvite(r.id)}
                      disabled={actionLoading}
                      testID={`button-invite-${r.id}`}
                    >
                      {actionLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Feather name="user-plus" size={14} color="#fff" />
                          <Text style={styles.inviteButtonText}>Bjud in</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
              );
            })}

            {searchQuery.length >= 2 && searchResults.length === 0 && !searching ? (
              <ThemedText variant="caption" color={Colors.textSecondary} style={styles.emptyText}>
                Inga förare hittades
              </ThemedText>
            ) : null}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const createTeamStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  teamCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  teamColorBar: {
    width: 4,
    height: 40,
    borderRadius: 2,
  },
  teamHeaderContent: {
    flex: 1,
  },
  teamName: {
    fontSize: FontSize.xl,
  },
  leaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.warningLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingLeft: Spacing.lg + 4,
  },
  membersCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    flex: 1,
    color: Colors.text,
  },
  addButton: {
    padding: Spacing.xs,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  memberBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.md,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  memberInfo: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  memberName: {
    fontFamily: 'Inter_600SemiBold',
  },
  subBadge: {
    backgroundColor: Colors.infoLight,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: BorderRadius.sm,
  },
  subText: {
    fontSize: 10,
  },
  memberActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  iconButton: {
    padding: Spacing.xs,
  },
  ordersCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  orderInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
  actionButtons: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.danger,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  dangerButtonText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: FontSize.md,
  },
  warningButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.warning,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  warningButtonText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: FontSize.md,
  },
  noTeamContainer: {
    paddingHorizontal: Spacing.lg,
  },
  noTeamCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl * 2,
  },
  noTeamIcon: {
    marginBottom: Spacing.lg,
  },
  noTeamTitle: {
    marginBottom: Spacing.sm,
  },
  noTeamDescription: {
    textAlign: 'center',
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    minWidth: 160,
  },
  createButtonText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: FontSize.md,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  inputLabel: {
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
    color: Colors.text,
  },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    fontFamily: 'Inter_400Regular',
  },
  inputMultiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  colorPicker: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  colorOption: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSelected: {
    borderColor: Colors.text,
    borderWidth: 3,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  searchResultInfo: {
    flex: 1,
  },
  alreadyBadge: {
    backgroundColor: Colors.successLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.round,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.secondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  inviteButtonText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: FontSize.sm,
  },
});

export default TeamScreen;
