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
import { useBranding, useThemeColors, useThemedStyles } from '../context/BrandingContext';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';

const FALLBACK_LOGO = require('../../assets/plannix-logo.png');

type LoginMode = 'pin' | 'email_pin' | 'credentials';

export function LoginScreen() {
  const styles = useThemedStyles(createLoginStyles);
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { branding } = useBranding();
  const themeColors = useThemeColors();
  const [mode, setMode] = useState<LoginMode>('pin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
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
    } else if (mode === 'email_pin') {
      if (!email.trim()) {
        setError('Ange din e-postadress');
        return;
      }
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
      } else if (mode === 'email_pin') {
        await login('', '', pin.trim(), email.trim());
      } else {
        await login(username.trim(), password.trim());
      }
    } catch (e: any) {
      setError('Inloggningen misslyckades. Försök igen.');
    } finally {
      setIsLoading(false);
    }
  }

  function switchMode(newMode: LoginMode) {
    if (mode === newMode) return;
    setMode(newMode);
    setError('');
    setPin('');
    setUsername('');
    setPassword('');
    setEmail('');
  }

  return (
    <LinearGradient
      colors={[themeColors.primaryDark, themeColors.primary, themeColors.primaryLight]}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top + Spacing.xxxl }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <Image
            source={branding.logoUrl ? { uri: branding.logoUrl } : FALLBACK_LOGO}
            style={styles.logoImage}
            resizeMode="contain"
            defaultSource={FALLBACK_LOGO}
          />
          <ThemedText variant="body" color="rgba(255,255,255,0.7)">
            {branding.companyName} Field Service
          </ThemedText>
        </View>

        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeTab, mode === 'pin' ? styles.modeTabActive : null]}
            onPress={() => switchMode('pin')}
            testID="button-mode-pin"
          >
            <Feather name="hash" size={16} color={mode === 'pin' ? Colors.primary : 'rgba(255,255,255,0.6)'} />
            <ThemedText
              variant="caption"
              color={mode === 'pin' ? Colors.primary : 'rgba(255,255,255,0.6)'}
              style={styles.modeTabText}
            >
              PIN
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.modeTab, mode === 'email_pin' ? styles.modeTabActive : null]}
            onPress={() => switchMode('email_pin')}
            testID="button-mode-email-pin"
          >
            <Feather name="mail" size={16} color={mode === 'email_pin' ? Colors.primary : 'rgba(255,255,255,0.6)'} />
            <ThemedText
              variant="caption"
              color={mode === 'email_pin' ? Colors.primary : 'rgba(255,255,255,0.6)'}
              style={styles.modeTabText}
            >
              E-post
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.modeTab, mode === 'credentials' ? styles.modeTabActive : null]}
            onPress={() => switchMode('credentials')}
            testID="button-mode-credentials"
          >
            <Feather name="user" size={16} color={mode === 'credentials' ? Colors.primary : 'rgba(255,255,255,0.6)'} />
            <ThemedText
              variant="caption"
              color={mode === 'credentials' ? Colors.primary : 'rgba(255,255,255,0.6)'}
              style={styles.modeTabText}
            >
              Konto
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
          ) : mode === 'email_pin' ? (
            <View style={styles.emailPinSection}>
              <View style={styles.inputContainer}>
                <Feather name="mail" size={20} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="E-postadress"
                  placeholderTextColor={Colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  testID="input-email"
                />
              </View>
              <View style={styles.inputContainer}>
                <Feather name="hash" size={20} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, styles.pinInput]}
                  placeholder="PIN-kod"
                  placeholderTextColor={Colors.textMuted}
                  value={pin}
                  onChangeText={(text) => setPin(text.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                  textAlign="center"
                  testID="input-email-pin"
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
            style={[styles.loginButton, { backgroundColor: themeColors.secondary }, isLoading ? styles.loginButtonDisabled : null]}
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
          {branding.companyName} GO v2.0
        </ThemedText>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// Themed style factory: see useThemedStyles in BrandingContext.
const createLoginStyles = () => StyleSheet.create({
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
  logoImage: {
    width: 200,
    height: 56,
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
  emailPinSection: {
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
