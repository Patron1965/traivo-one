import React, { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';

type LoginMode = 'credentials' | 'pin';

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [mode, setMode] = useState<LoginMode>('pin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin() {
    if (mode === 'pin') {
      if (!pin.trim() || pin.length < 4) {
        setError('Ange en giltig PIN-kod (4-6 siffror)');
        return;
      }
    } else {
      if (!username.trim() || !password.trim()) {
        setError('Ange användarnamn och lösenord');
        return;
      }
    }
    setIsLoading(true);
    setError('');
    try {
      if (mode === 'pin') {
        await login('', '', pin.trim());
      } else {
        await login(username.trim(), password.trim());
      }
    } catch (e: any) {
      setError('Inloggningen misslyckades. Försök igen.');
    } finally {
      setIsLoading(false);
    }
  }

  function switchMode() {
    setMode(mode === 'pin' ? 'credentials' : 'pin');
    setError('');
    setPin('');
    setUsername('');
    setPassword('');
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

        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeTab, mode === 'pin' ? styles.modeTabActive : null]}
            onPress={() => { if (mode !== 'pin') switchMode(); }}
            testID="button-mode-pin"
          >
            <Feather name="hash" size={16} color={mode === 'pin' ? Colors.primary : 'rgba(255,255,255,0.6)'} />
            <ThemedText
              variant="caption"
              color={mode === 'pin' ? Colors.primary : 'rgba(255,255,255,0.6)'}
              style={styles.modeTabText}
            >
              PIN-kod
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.modeTab, mode === 'credentials' ? styles.modeTabActive : null]}
            onPress={() => { if (mode !== 'credentials') switchMode(); }}
            testID="button-mode-credentials"
          >
            <Feather name="user" size={16} color={mode === 'credentials' ? Colors.primary : 'rgba(255,255,255,0.6)'} />
            <ThemedText
              variant="caption"
              color={mode === 'credentials' ? Colors.primary : 'rgba(255,255,255,0.6)'}
              style={styles.modeTabText}
            >
              Inloggning
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.form}>
          {mode === 'pin' ? (
            <View style={styles.pinSection}>
              <ThemedText variant="body" color="rgba(255,255,255,0.8)" style={styles.pinLabel}>
                Ange din PIN-kod
              </ThemedText>
              <View style={styles.inputContainer}>
                <Feather name="hash" size={20} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, styles.pinInput]}
                  placeholder="- - - -"
                  placeholderTextColor={Colors.textMuted}
                  value={pin}
                  onChangeText={(text) => setPin(text.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                  textAlign="center"
                  testID="input-pin"
                />
              </View>
            </View>
          ) : (
            <>
              <View style={styles.inputContainer}>
                <Feather name="user" size={20} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Användarnamn"
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
                  placeholder="Lösenord"
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
            </>
          )}

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
          Driver Core v2.0
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
    marginBottom: Spacing.xxl,
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
  modeToggle: {
    flexDirection: 'row',
    marginBottom: Spacing.xl,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: BorderRadius.lg,
    padding: 4,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  modeTabActive: {
    backgroundColor: Colors.surface,
  },
  modeTabText: {
    fontSize: FontSize.sm,
  },
  form: {
    gap: Spacing.lg,
  },
  pinSection: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  pinLabel: {
    textAlign: 'center',
  },
  pinInput: {
    fontSize: FontSize.xxl,
    letterSpacing: 12,
    fontFamily: 'Inter_600SemiBold',
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
