import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { Colors } from '../constants/theme';

interface ThemedViewProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
}

export function ThemedView({ children, style, testID }: ThemedViewProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
  },
});
