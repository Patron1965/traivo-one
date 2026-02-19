import React, { useRef, useState } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';

export function SignatureScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [hasSignature, setHasSignature] = useState(false);

  const mutation = useMutation({
    mutationFn: (signatureData: string) =>
      apiRequest('POST', `/api/mobile/orders/${orderId}/signature`, { signatureData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    },
  });

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl }]}>
      <ThemedText variant="heading" style={styles.title}>
        Digital signatur
      </ThemedText>
      <ThemedText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        L\u00e5t kunden signera f\u00f6r godk\u00e4nnande
      </ThemedText>

      <View style={styles.signatureArea}>
        <View style={styles.signaturePlaceholder}>
          <Feather name="edit-3" size={48} color={Colors.textMuted} />
          <ThemedText variant="body" color={Colors.textMuted}>
            {Platform.OS === 'web'
              ? 'Signatur visas i Expo Go p\u00e5 din telefon'
              : 'Signera h\u00e4r'}
          </ThemedText>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          style={styles.clearButton}
          onPress={() => setHasSignature(false)}
          testID="button-clear-signature"
        >
          <Feather name="trash-2" size={18} color={Colors.danger} />
          <ThemedText variant="body" color={Colors.danger}>
            Rensa
          </ThemedText>
        </Pressable>

        <Pressable
          style={styles.saveButton}
          onPress={() => {
            mutation.mutate('signature-data-placeholder');
          }}
          testID="button-save-signature"
        >
          <Feather name="check" size={18} color={Colors.textInverse} />
          <ThemedText variant="body" color={Colors.textInverse}>
            Spara signatur
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {
    marginBottom: Spacing.xl,
  },
  signatureArea: {
    flex: 1,
    maxHeight: 300,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.borderLight,
    marginBottom: Spacing.xl,
    overflow: 'hidden',
  },
  signaturePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.dangerLight,
    height: 48,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.secondary,
    height: 48,
    borderRadius: BorderRadius.lg,
  },
});
