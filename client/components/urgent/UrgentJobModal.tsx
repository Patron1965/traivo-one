import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Modal,
  TextInput,
  ScrollView,
  Linking,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUrgentJob } from '../../context/UrgentJobContext';
import { URGENT_DECLINE_REASONS } from '../../types';

type ModalPhase = 'overview' | 'confirm_accept' | 'decline_reason';

export function UrgentJobModal() {
  const insets = useSafeAreaInsets();
  const { incomingJob, acceptJob, declineJob, dismissIncoming } = useUrgentJob();
  const [phase, setPhase] = useState<ModalPhase>('overview');
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [freetext, setFreetext] = useState('');
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (incomingJob) {
      setPhase('overview');
      setSelectedReason(null);
      setFreetext('');
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 400, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [incomingJob, pulseAnim]);

  if (!incomingJob) return null;

  const handleAccept = (startNavigation: boolean) => {
    acceptJob(startNavigation);
  };

  const handleDeclineSubmit = () => {
    if (!selectedReason) return;
    const reasonLabel = URGENT_DECLINE_REASONS.find(r => r.id === selectedReason)?.label || selectedReason;
    declineJob(reasonLabel, selectedReason === 'other' ? freetext : undefined);
  };

  const handleCall = () => {
    if (incomingJob.customerPhone) {
      Linking.openURL(`tel:${incomingJob.customerPhone.replace(/\s/g, '')}`);
    }
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.overlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
          <View style={styles.card}>
            <View style={styles.urgentHeader}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Feather name="alert-triangle" size={28} color="#EF4444" />
              </Animated.View>
              <Text style={styles.urgentTitle}>AKUT JOBB TILLDELAT</Text>
            </View>

            <View style={styles.detailsContainer}>
              <View style={styles.detailRow}>
                <Feather name="map-pin" size={18} color="#6B7C8C" />
                <View style={styles.detailText}>
                  <Text style={styles.detailLabel}>{incomingJob.type}</Text>
                  <Text style={styles.detailValue}>{incomingJob.address}</Text>
                  {incomingJob.distance ? (
                    <Text style={styles.detailMuted}>
                      {incomingJob.distance} bort
                      {incomingJob.estimatedMinutes ? ` (~${incomingJob.estimatedMinutes} min)` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>

              {incomingJob.deadline ? (
                <View style={styles.detailRow}>
                  <Feather name="clock" size={18} color="#6B7C8C" />
                  <View style={styles.detailText}>
                    <Text style={styles.detailValue}>
                      Deadline: {new Date(incomingJob.deadline).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                      {incomingJob.deadlineLabel ? ` (${incomingJob.deadlineLabel})` : ''}
                    </Text>
                  </View>
                </View>
              ) : null}

              {incomingJob.articles ? (
                <View style={styles.detailRow}>
                  <Feather name="clipboard" size={18} color="#6B7C8C" />
                  <Text style={styles.detailValue}>{incomingJob.articles}</Text>
                </View>
              ) : null}

              <View style={styles.detailRow}>
                <Feather name="user" size={18} color="#6B7C8C" />
                <Text style={styles.detailValue}>Kund: {incomingJob.customerName}</Text>
              </View>

              {incomingJob.customerPhone ? (
                <Pressable style={styles.detailRow} onPress={handleCall} testID="urgent-call-customer">
                  <Feather name="phone" size={18} color="#2A6496" />
                  <Text style={[styles.detailValue, styles.phoneLink]}>{incomingJob.customerPhone}</Text>
                </Pressable>
              ) : null}

              {incomingJob.notes ? (
                <View style={styles.notesBox}>
                  <Text style={styles.notesText}>"{incomingJob.notes}"</Text>
                </View>
              ) : null}
            </View>

            {phase === 'overview' ? (
              <View style={styles.buttonRow}>
                <Pressable
                  style={styles.declineButton}
                  onPress={() => setPhase('decline_reason')}
                  testID="urgent-decline-btn"
                >
                  <Feather name="x" size={20} color="#374151" />
                  <Text style={styles.declineButtonText}>AVB\u00D6J</Text>
                </Pressable>
                <Pressable
                  style={styles.acceptButton}
                  onPress={() => setPhase('confirm_accept')}
                  testID="urgent-accept-btn"
                >
                  <Feather name="check" size={20} color="#FFFFFF" />
                  <Text style={styles.acceptButtonText}>ACCEPTERA</Text>
                </Pressable>
              </View>
            ) : null}

            {phase === 'confirm_accept' ? (
              <View style={styles.confirmSection}>
                <Text style={styles.confirmTitle}>Acceptera akut jobb {incomingJob.address}?</Text>
                <Pressable
                  style={styles.confirmNavButton}
                  onPress={() => handleAccept(true)}
                  testID="urgent-accept-nav"
                >
                  <Feather name="navigation" size={18} color="#FFFFFF" />
                  <Text style={styles.confirmNavText}>Ja, starta navigering</Text>
                </Pressable>
                <Pressable
                  style={styles.confirmNoNavButton}
                  onPress={() => handleAccept(false)}
                  testID="urgent-accept-no-nav"
                >
                  <Text style={styles.confirmNoNavText}>Ja, utan navigering</Text>
                </Pressable>
                <Pressable
                  style={styles.backButton}
                  onPress={() => setPhase('overview')}
                  testID="urgent-back-btn"
                >
                  <Text style={styles.backButtonText}>Tillbaka</Text>
                </Pressable>
              </View>
            ) : null}

            {phase === 'decline_reason' ? (
              <View style={styles.declineSection}>
                <Text style={styles.declineSectionTitle}>Anledning till avb\u00F6jning</Text>
                {URGENT_DECLINE_REASONS.map((reason) => (
                  <Pressable
                    key={reason.id}
                    style={[
                      styles.reasonOption,
                      selectedReason === reason.id ? styles.reasonSelected : null,
                    ]}
                    onPress={() => setSelectedReason(reason.id)}
                    testID={`urgent-reason-${reason.id}`}
                  >
                    <View style={[styles.radioOuter, selectedReason === reason.id ? styles.radioSelected : null]}>
                      {selectedReason === reason.id ? <View style={styles.radioInner} /> : null}
                    </View>
                    <Text style={styles.reasonText}>{reason.label}</Text>
                  </Pressable>
                ))}
                {selectedReason === 'other' ? (
                  <TextInput
                    style={styles.freetextInput}
                    placeholder="Beskriv anledningen..."
                    placeholderTextColor="#9CA3AF"
                    value={freetext}
                    onChangeText={setFreetext}
                    multiline
                    testID="urgent-freetext"
                  />
                ) : null}
                <View style={styles.buttonRow}>
                  <Pressable
                    style={styles.backButton}
                    onPress={() => { setPhase('overview'); setSelectedReason(null); setFreetext(''); }}
                  >
                    <Text style={styles.backButtonText}>Tillbaka</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.submitDeclineButton, !selectedReason ? styles.disabledButton : null]}
                    onPress={handleDeclineSubmit}
                    disabled={!selectedReason}
                    testID="urgent-decline-submit"
                  >
                    <Text style={styles.submitDeclineText}>Skicka avb\u00F6jning</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {incomingJob.assignedBy ? (
              <Text style={styles.assignedBy}>Tilldelad av: {incomingJob.assignedBy}</Text>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderTopWidth: 4,
    borderTopColor: '#EF4444',
    padding: 24,
  },
  urgentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  urgentTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#EF4444',
  },
  detailsContainer: {
    gap: 14,
    marginBottom: 24,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  detailText: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: '#1F2937',
  },
  detailValue: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#374151',
  },
  detailMuted: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginTop: 2,
  },
  phoneLink: {
    color: '#2A6496',
    textDecorationLine: 'underline',
  },
  notesBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
  notesText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#92400E',
    fontStyle: 'italic',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  declineButton: {
    flex: 0.48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    height: 56,
  },
  declineButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#374151',
  },
  acceptButton: {
    flex: 0.52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#22C55E',
    borderRadius: 12,
    height: 56,
  },
  acceptButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  confirmSection: {
    gap: 12,
  },
  confirmTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 4,
  },
  confirmNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#22C55E',
    borderRadius: 12,
    height: 52,
  },
  confirmNavText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  confirmNoNavButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    height: 48,
  },
  confirmNoNavText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#374151',
  },
  backButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
  },
  backButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#6B7280',
  },
  declineSection: {
    gap: 10,
  },
  declineSectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#1F2937',
    marginBottom: 4,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  reasonSelected: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: '#EF4444',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  reasonText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#374151',
    flex: 1,
  },
  freetextInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#1F2937',
    textAlignVertical: 'top',
  },
  submitDeclineButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    borderRadius: 12,
    height: 48,
  },
  disabledButton: {
    opacity: 0.4,
  },
  submitDeclineText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  assignedBy: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 16,
  },
});
