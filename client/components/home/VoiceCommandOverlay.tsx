import React from 'react';
import { View, Pressable, Animated, Modal, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Colors } from '../../constants/theme';
import styles from '../../screens/HomeScreen.styles';

interface VoiceCommandOverlayProps {
  voiceRecording: boolean;
  voiceProcessing: boolean;
  voiceFeedback: string | null;
  voiceOverlayVisible: boolean;
  voiceTranscript: string;
  voiceError: boolean;
  offlineQuickActions: boolean;
  pulseAnim: Animated.Value;
  overlayPulseAnim: Animated.Value;
  tabBarHeight: number;
  handleVoiceCommand: () => void;
  stopVoiceRecording: () => void;
  retryVoiceCommand: () => void;
  executeVoiceAction: (action: string, displayMessage: string) => void;
  setVoiceOverlayVisible: (v: boolean) => void;
  setVoiceError: (v: boolean) => void;
  setOfflineQuickActions: (v: boolean) => void;
  silenceTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  HELP_TEXT: string;
}

export function VoiceCommandOverlay({
  voiceRecording,
  voiceProcessing,
  voiceFeedback,
  voiceOverlayVisible,
  voiceTranscript,
  voiceError,
  offlineQuickActions,
  pulseAnim,
  overlayPulseAnim,
  tabBarHeight,
  handleVoiceCommand,
  stopVoiceRecording,
  retryVoiceCommand,
  executeVoiceAction,
  setVoiceOverlayVisible,
  setVoiceError,
  setOfflineQuickActions,
  silenceTimerRef,
  HELP_TEXT,
}: VoiceCommandOverlayProps) {
  return (
    <>
      <Animated.View style={[
        styles.voiceFab,
        { bottom: tabBarHeight + 20 },
        { transform: [{ scale: voiceRecording ? pulseAnim : 1 }] },
      ]}>
        <Pressable
          style={[styles.voiceFabButton, voiceRecording ? styles.voiceFabButtonActive : null]}
          onPress={handleVoiceCommand}
          disabled={voiceProcessing}
          testID="button-voice-command"
        >
          {voiceProcessing ? (
            <ActivityIndicator size="small" color={Colors.textInverse} />
          ) : (
            <Feather name={voiceRecording ? 'square' : 'mic'} size={28} color={Colors.textInverse} />
          )}
        </Pressable>
      </Animated.View>

      <Modal
        visible={voiceOverlayVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (voiceRecording) stopVoiceRecording();
          if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
          setVoiceOverlayVisible(false);
          setVoiceError(false);
          setOfflineQuickActions(false);
        }}
      >
        <View style={styles.voiceOverlay}>
          <View style={styles.voiceOverlayContent}>
            {offlineQuickActions ? (
              <>
                <View style={styles.voiceOverlayErrorIcon}>
                  <Feather name="wifi-off" size={48} color={Colors.warning} />
                </View>
                <ThemedText variant="subheading" color={Colors.textInverse} style={styles.voiceOverlayTitle}>
                  Offline – snabbkommandon
                </ThemedText>
                <View style={styles.offlineGrid}>
                  {[
                    { label: 'Klar', action: 'complete_order', msg: 'Order markerad som klar' },
                    { label: 'N\u00e4sta', action: 'start_next', msg: 'Visar n\u00e4sta order' },
                    { label: 'P\u00e5 plats', action: 'on_site', msg: 'Ankomst registrerad' },
                    { label: 'Avvikelse', action: 'report_deviation', msg: 'Rapportera avvikelse' },
                    { label: 'Rast', action: 'start_break', msg: 'Rast startad' },
                    { label: 'Hj\u00e4lp', action: 'help', msg: HELP_TEXT },
                  ].map((item) => (
                    <Pressable
                      key={item.action}
                      style={styles.offlineBtn}
                      onPress={() => {
                        setOfflineQuickActions(false);
                        setVoiceOverlayVisible(false);
                        executeVoiceAction(item.action, item.msg);
                      }}
                    >
                      <ThemedText variant="label" color={Colors.textInverse}>{item.label}</ThemedText>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  style={styles.voiceOverlayCloseBtn}
                  onPress={() => {
                    setOfflineQuickActions(false);
                    setVoiceOverlayVisible(false);
                  }}
                  testID="button-offline-close"
                >
                  <ThemedText variant="label" color="rgba(255,255,255,0.7)">St\u00e4ng</ThemedText>
                </Pressable>
              </>
            ) : voiceError ? (
              <>
                <View style={styles.voiceOverlayErrorIcon}>
                  <Feather name="alert-circle" size={48} color={Colors.danger} />
                </View>
                <ThemedText variant="subheading" color={Colors.textInverse} style={styles.voiceOverlayTitle}>
                  Kommandot k\u00e4ndes inte igen
                </ThemedText>
                <ThemedText variant="body" color="rgba(255,255,255,0.7)" style={styles.voiceOverlaySubtitle}>
                  F\u00f6rs\u00f6k igen eller s\u00e4g "hj\u00e4lp" f\u00f6r att h\u00f6ra tillg\u00e4ngliga kommandon
                </ThemedText>
                <View style={styles.voiceOverlayActions}>
                  <Pressable style={styles.voiceOverlayRetryBtn} onPress={retryVoiceCommand} testID="button-voice-retry">
                    <Feather name="mic" size={20} color={Colors.textInverse} />
                    <ThemedText variant="label" color={Colors.textInverse}>F\u00f6rs\u00f6k igen</ThemedText>
                  </Pressable>
                  <Pressable
                    style={styles.voiceOverlayCloseBtn}
                    onPress={() => {
                      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
                      setVoiceOverlayVisible(false); setVoiceError(false);
                    }}
                    testID="button-voice-close"
                  >
                    <ThemedText variant="label" color="rgba(255,255,255,0.7)">St\u00e4ng</ThemedText>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Animated.View style={[styles.voiceOverlayMicCircle, { transform: [{ scale: overlayPulseAnim }] }]}>
                  <Feather name="mic" size={48} color={Colors.textInverse} />
                </Animated.View>
                <ThemedText variant="subheading" color={Colors.textInverse} style={styles.voiceOverlayTitle}>
                  {voiceRecording ? 'Lyssnar...' : voiceProcessing ? 'Bearbetar...' : 'R\u00f6stkommando'}
                </ThemedText>
                {voiceTranscript ? (
                  <ThemedText variant="body" color="rgba(255,255,255,0.8)" style={styles.voiceOverlayTranscript}>
                    {voiceTranscript}
                  </ThemedText>
                ) : null}
                {voiceRecording ? (
                  <Pressable
                    style={styles.voiceOverlayStopBtn}
                    onPress={stopVoiceRecording}
                  >
                    <Feather name="square" size={16} color={Colors.textInverse} />
                    <ThemedText variant="caption" color={Colors.textInverse}>Stoppa</ThemedText>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        </View>
      </Modal>

      {voiceFeedback ? (
        <View style={[styles.voiceFeedbackToast, { bottom: tabBarHeight + 90 }]}>
          <Feather name="info" size={16} color={Colors.textInverse} />
          <ThemedText variant="body" color={Colors.textInverse} style={styles.voiceFeedbackText}>
            {voiceFeedback}
          </ThemedText>
        </View>
      ) : null}
    </>
  );
}
