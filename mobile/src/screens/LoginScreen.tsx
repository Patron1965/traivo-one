import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, fontSize, borderRadius } from '../theme';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !pin.trim()) {
      Alert.alert('Fel', 'Ange e-post och PIN-kod');
      return;
    }

    setIsLoading(true);
    try {
      const success = await login(email.trim(), pin.trim());
      if (!success) {
        Alert.alert('Inloggning misslyckades', 'Kontrollera dina uppgifter och försök igen');
      }
    } catch (error) {
      Alert.alert('Fel', 'Kunde inte ansluta till servern');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>TG</Text>
          </View>
          <Text style={styles.title}>Traivo Go</Text>
          <Text style={styles.subtitle}>Logga in för att se dina uppdrag</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>E-post</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="din@email.se"
              placeholderTextColor={colors.mountainGray}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
              data-testid="input-email"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>PIN-kod</Text>
            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={setPin}
              placeholder="****"
              placeholderTextColor={colors.mountainGray}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              editable={!isLoading}
              data-testid="input-pin"
            />
          </View>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            data-testid="button-login"
          >
            {isLoading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Logga in</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.deepOceanBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoText: {
    color: colors.white,
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
  },
  title: {
    fontSize: fontSize.xxxl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
  },
  form: {
    gap: spacing.lg,
  },
  inputContainer: {
    gap: spacing.sm,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.midnightNavy,
  },
  input: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: fontSize.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.midnightNavy,
  },
  button: {
    backgroundColor: colors.deepOceanBlue,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
    minHeight: 52,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
