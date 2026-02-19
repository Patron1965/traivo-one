import React from 'react';
import { Text, TextStyle, StyleSheet } from 'react-native';
import { Colors, FontSize } from '../constants/theme';

interface ThemedTextProps {
  children: React.ReactNode;
  style?: TextStyle | TextStyle[];
  variant?: 'title' | 'heading' | 'subheading' | 'body' | 'caption' | 'label';
  color?: string;
  numberOfLines?: number;
  testID?: string;
}

export function ThemedText({
  children,
  style,
  variant = 'body',
  color,
  numberOfLines,
  testID,
}: ThemedTextProps) {
  return (
    <Text
      style={[styles[variant], color ? { color } : null, style]}
      numberOfLines={numberOfLines}
      testID={testID}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: FontSize.title,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: FontSize.xxl,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  subheading: {
    fontSize: FontSize.xl,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  body: {
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 20,
  },
  caption: {
    fontSize: FontSize.sm,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  label: {
    fontSize: FontSize.sm,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
