import React, { Component, ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';

type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackIcon?: FeatherIconName;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

interface ScreenErrorFallbackProps {
  fallbackTitle?: string;
  fallbackIcon?: FeatherIconName;
  resetError: () => void;
}

function ScreenErrorFallback({ fallbackTitle, fallbackIcon, resetError }: ScreenErrorFallbackProps) {
  const styles = useThemedStyles(createScreenErrorStyles);
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Feather
          name={fallbackIcon ?? 'alert-circle'}
          size={40}
          color={Colors.warning}
        />
      </View>
      <Text style={styles.title}>
        {fallbackTitle || 'Kunde inte visa vyn'}
      </Text>
      <Text style={styles.message}>
        Något gick fel. Tryck nedan för att försöka igen.
      </Text>
      <Pressable
        style={styles.retryButton}
        onPress={resetError}
        testID="button-screen-retry"
      >
        <Feather name="refresh-cw" size={18} color={Colors.textInverse} />
        <Text style={styles.retryText}>Försök igen</Text>
      </Pressable>
    </View>
  );
}

export class ScreenErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ScreenErrorBoundary caught:', error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallbackTitle, fallbackIcon } = this.props;
      return (
        <ScreenErrorFallback
          fallbackTitle={fallbackTitle}
          fallbackIcon={fallbackIcon}
          resetError={this.resetError}
        />
      );
    }
    return this.props.children;
  }
}

const createScreenErrorStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.warningLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: FontSize.xl,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  message: {
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  retryText: {
    fontSize: FontSize.md,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textInverse,
  },
});
