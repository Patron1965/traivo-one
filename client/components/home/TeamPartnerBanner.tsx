import React from 'react';
import { View, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Colors } from '../../constants/theme';
import { createHomeStyles } from '../../screens/HomeScreen.styles';
import { useThemedStyles } from '../../context/BrandingContext';

interface TeamPartner {
  name: string;
  phone?: string;
  isOnline?: boolean;
}

interface TeamPartnerBannerProps {
  partner: TeamPartner | null;
}

export function TeamPartnerBanner({ partner }: TeamPartnerBannerProps) {
  const styles = useThemedStyles(createHomeStyles);
  if (!partner) return null;

  return (
    <Pressable
      style={styles.teamBanner}
      onPress={() => partner.phone ? Linking.openURL(`tel:${partner.phone}`) : undefined}
      testID="banner-team-partner"
    >
      <View style={styles.teamBannerLeft}>
        <View style={[styles.teamBannerDot, { backgroundColor: partner.isOnline ? Colors.success : Colors.textMuted }]} />
        <View>
          <ThemedText variant="label" color={Colors.secondary}>Teampartner</ThemedText>
          <ThemedText variant="body" color={Colors.text}>{partner.name}</ThemedText>
        </View>
      </View>
      {partner.phone ? (
        <View style={styles.teamBannerCall}>
          <Feather name="phone" size={16} color={Colors.primary} />
        </View>
      ) : null}
    </Pressable>
  );
}
