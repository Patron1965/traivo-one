import React, { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      setError('Ange anv\u00e4ndarnamn och l\u00f6senord');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await login(username.trim(), password.trim());
    } catch (e: any) {
      setError('Inloggningen misslyckades. F\u00f6rs\u00f6k igen.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <LinearGradient
      colors={[Colors.primaryDark, Colors.primary, Colors.primaryLight]}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top + Spacing.xxxl }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Feather name="truck" size={40} color={Colors.textInverse} />
          </View>
          <ThemedText variant="title" color={Colors.textInverse}>
            Driver Core
          </ThemedText>
          <ThemedText variant="body" color="rgba(255,255,255,0.7)">
            Unicorn Field Service
          </ThemedText>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Feather name="user" size={20} color={Colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Anv\u00e4ndarnamn"
              placeholderTextColor={Colors.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              testID="input-username"
            />
          </View>

          <View style={styles.inputContainer}>
            <Feather name="lock" size={20} color={Colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="L\u00f6senord"
              placeholderTextColor={Colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              testID="input-password"
            />
            <Pressable
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
              testID="button-toggle-password"
            >
              <Feather
                name={showPassword ? 'eye-off' : 'eye'}
                size={20}
                color={Colors.textMuted}
              />
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorContainer}>
              <Feather name="alert-circle" size={16} color={Colors.danger} />
              <ThemedText variant="caption" color={Colors.danger}>
                {error}
              </ThemedText>
            </View>
          ) : null}

          <Pressable
            style={[styles.loginButton, isLoading ? styles.loginButtonDisabled : null]}
            onPress={handleLogin}
            disabled={isLoading}
            testID="button-login"
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <>
                <ThemedText
                  variant="subheading"
                  color={Colors.textInverse}
                  style={{ fontSize: FontSize.lg }}
                >
                  Logga in
                </ThemedText>
                <Feather name="arrow-right" size={20} color={Colors.textInverse} />
              </>
            )}
          </Pressable>
        </View>

        <ThemedText
          variant="caption"
          color="rgba(255,255,255,0.5)"
          style={styles.version}
        >
          Driver Core v1.0
        </ThemedText>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xxxl,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  form: {
    gap: Spacing.lg,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    height: 56,
  },
  inputIcon: {
    marginRight: Spacing.md,
  },
  input: {
    flex: 1,
    fontSize: FontSize.lg,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  eyeButton: {
    padding: Spacing.sm,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.secondary,
    borderRadius: BorderRadius.lg,
    height: 56,
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  version: {
    textAlign: 'center',
    marginTop: Spacing.xxxl,
  },
});
