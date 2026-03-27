import React, { useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useUrgentJob } from '../../context/UrgentJobContext';

const STATUS_LABELS: Record<string, string> = {
  accepted: 'Accepterat',
  en_route: 'P\u00E5 v\u00E4g',
  arrived: 'Framme',
  in_progress: 'P\u00E5g\u00E5r',
};

export function UrgentJobBanner() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { activeJob, activeJobStatus } = useUrgentJob();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (activeJob) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.7, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [activeJob, pulseAnim]);

  if (!activeJob || !activeJobStatus || activeJobStatus === 'completed' || activeJobStatus === 'declined') {
    return null;
  }

  const handlePress = () => {
    navigation.navigate('OrderDetail', { orderId: activeJob.orderId });
  };

  const statusLabel = STATUS_LABELS[activeJobStatus] || activeJobStatus;

  return (
    <Pressable
      style={[styles.banner, { paddingTop: insets.top + 4, minHeight: insets.top + 48 }]}
      onPress={handlePress}
      testID="urgent-job-banner"
    >
      <Animated.View style={{ opacity: pulseAnim }}>
        <Feather name="alert-triangle" size={16} color="#FFFFFF" />
      </Animated.View>
      <View style={styles.bannerContent}>
        <Text style={styles.bannerTitle} numberOfLines={1}>
          AKUT: {activeJob.type}
        </Text>
        <Text style={styles.bannerSubtitle} numberOfLines={1}>
          {activeJob.address} \u2022 {statusLabel}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 10,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
  },
  bannerContent: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  bannerSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.85)',
  },
});
