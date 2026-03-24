import React, { Component, ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { reloadAppAsync } from 'expo';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { Feather } from '@expo/vector-icons';

interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Feather name="alert-triangle" size={48} color={Colors.warning} />
      </View>
      <Text style={styles.title}>Traivo Go stannade</Text>
      <Text style={styles.message}>
        Något oväntat inträffade. Starta om Traivo Go för att fortsätta.
      </Text>
      <Pressable
        style={styles.button}
        onPress={() => reloadAppAsync()}
        testID="button-restart"
      >
        <Feather name="refresh-cw" size={20} color={Colors.textInverse} />
        <Text style={styles.buttonText}>Kör igång igen</Text>
      </Pressable>
    </View>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          resetError={this.resetError}
        />
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.warningLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  title: {
    fontSize: FontSize.xxl,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  message: {
    fontSize: FontSize.lg,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  buttonText: {
    fontSize: FontSize.lg,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textInverse,
  },
});
