import React from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Colors } from '../../constants/theme';
import styles from '../../screens/HomeScreen.styles';
import type { WeatherData } from '../../types';

interface WeatherWidgetProps {
  weather: WeatherData | undefined;
}

export function WeatherWidget({ weather }: WeatherWidgetProps) {
  if (!weather) return null;

  return (
    <View style={styles.weatherSection}>
      <View style={styles.weatherCurrent}>
        <Feather name={weather.icon as any} size={18} color={Colors.primary} />
        <ThemedText variant="body" style={styles.weatherTemp}>{weather.temperature}°C</ThemedText>
        <ThemedText variant="caption" color={Colors.textMuted}>{weather.description}</ThemedText>
        {weather.windSpeed > 0 ? (
          <View style={styles.weatherDetail}>
            <Feather name="wind" size={12} color={Colors.textMuted} />
            <ThemedText variant="caption" color={Colors.textMuted}>{weather.windSpeed} m/s</ThemedText>
          </View>
        ) : null}
        {weather.precipitation > 0 ? (
          <View style={styles.weatherDetail}>
            <Feather name="cloud-rain" size={12} color={Colors.textMuted} />
            <ThemedText variant="caption" color={Colors.textMuted}>{weather.precipitation} mm</ThemedText>
          </View>
        ) : null}
      </View>
      {weather.warnings.length > 0 ? (
        <View style={styles.weatherWarnings}>
          {weather.warnings.map((w, i) => (
            <View key={i} style={styles.weatherWarningBadge}>
              <Feather name="alert-triangle" size={13} color={Colors.warning} />
              <ThemedText variant="caption" color={Colors.warning}>{w}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
