import { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { submitSignature } from '../api/sync';
import { addToQueue } from '../services/offlineQueue';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { RootStackParamList } from '../navigation';

type SignatureRouteProps = RouteProp<RootStackParamList, 'Signature'>;
type SignatureNavProps = NativeStackNavigationProp<RootStackParamList>;

function toBase64(str: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i);
    const b = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
    const c = i + 2 < str.length ? str.charCodeAt(i + 2) : 0;
    output += chars.charAt(a >> 2);
    output += chars.charAt(((a & 3) << 4) | (b >> 4));
    output += i + 1 < str.length ? chars.charAt(((b & 15) << 2) | (c >> 6)) : '=';
    output += i + 2 < str.length ? chars.charAt(c & 63) : '=';
  }
  return output;
}

let SignatureCanvas: ReturnType<typeof require> | null = null;
try {
  SignatureCanvas = require('react-native-signature-canvas').default;
} catch {
  SignatureCanvas = null;
}

export function SignatureScreen() {
  const route = useRoute<SignatureRouteProps>();
  const navigation = useNavigation<SignatureNavProps>();
  const queryClient = useQueryClient();
  const { orderId } = route.params;
  const signatureRef = useRef<{ readSignature: () => void; clearSignature: () => void } | null>(null);

  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [lines, setLines] = useState<Array<{ x: number; y: number }[]>>([]);
  const [currentLine, setCurrentLine] = useState<{ x: number; y: number }[]>([]);

  const handleClear = () => {
    if (SignatureCanvas && signatureRef.current) {
      signatureRef.current.clearSignature();
    }
    setLines([]);
    setCurrentLine([]);
    setSignatureData(null);
    setHasSignature(false);
  };

  const handleSave = async () => {
    if (SignatureCanvas && signatureRef.current) {
      signatureRef.current.readSignature();
      return;
    }

    if (lines.length === 0) {
      Alert.alert('Fel', 'Rita en signatur först');
      return;
    }
    const svgData = lines.map(line =>
      line.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    ).join(' ');
    const encoded = toBase64(svgData);
    await saveSignature(encoded);
  };

  const handleSignatureResult = (result: string) => {
    if (result) {
      const base64Data = result.replace('data:image/png;base64,', '');
      saveSignature(base64Data);
    }
  };

  const saveSignature = async (encoded: string) => {
    setSignatureData(encoded);
    setIsSaving(true);
    try {
      await submitSignature(orderId, encoded);
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      Alert.alert('Klart', 'Signatur sparad');
      navigation.goBack();
    } catch {
      await addToQueue({
        type: 'signature',
        payload: { orderId, signature: encoded },
      });
      Alert.alert('Sparad offline', 'Signatur sparas lokalt');
      navigation.goBack();
    } finally {
      setIsSaving(false);
    }
  };

  const handleTouchStart = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = e.nativeEvent;
    setDrawing(true);
    setCurrentLine([{ x: locationX, y: locationY }]);
  };

  const handleTouchMove = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!drawing) return;
    const { locationX, locationY } = e.nativeEvent;
    setCurrentLine(prev => [...prev, { x: locationX, y: locationY }]);
  };

  const handleTouchEnd = () => {
    setDrawing(false);
    if (currentLine.length > 1) {
      setLines(prev => [...prev, currentLine]);
      setHasSignature(true);
    }
    setCurrentLine([]);
  };

  const canSave = SignatureCanvas ? hasSignature : lines.length > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kundsignatur</Text>
      <Text style={styles.subtitle}>Be kunden signera nedan</Text>

      {SignatureCanvas ? (
        <View style={styles.canvas}>
          <SignatureCanvas
            ref={signatureRef}
            onOK={handleSignatureResult}
            onBegin={() => setHasSignature(true)}
            descriptionText=""
            clearText="Rensa"
            confirmText="Spara"
            webStyle={`.m-signature-pad--footer { display: none; } .m-signature-pad { box-shadow: none; border: none; } body { margin: 0; }`}
            backgroundColor={colors.white}
            penColor={colors.midnightNavy}
            style={styles.signatureCanvasInner}
          />
        </View>
      ) : (
        <View
          style={styles.canvas}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {lines.length === 0 && !drawing && (
            <Text style={styles.canvasPlaceholder}>Rita signatur här</Text>
          )}
          {(lines.length > 0 || currentLine.length > 0) && (
            <View style={styles.signatureIndicator}>
              <Text style={styles.signatureIndicatorText}>
                ✏️ {lines.length} drag{currentLine.length > 0 ? ' (ritar...)' : ''}
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.clearButton}
          onPress={handleClear}
          data-testid="button-clear-signature"
        >
          <Text style={styles.clearButtonText}>Rensa</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving || !canSave}
          data-testid="button-save-signature"
        >
          {isSaving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>Spara signatur</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
    marginBottom: spacing.xl,
  },
  canvas: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
    minHeight: 250,
    overflow: 'hidden',
  },
  signatureCanvasInner: {
    flex: 1,
    width: '100%',
  },
  canvasPlaceholder: {
    fontSize: fontSize.lg,
    color: colors.mountainGray + '80',
  },
  signatureIndicator: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
  },
  signatureIndicatorText: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  clearButton: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
    justifyContent: 'center',
  },
  clearButtonText: {
    color: colors.mountainGray,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  saveButton: {
    flex: 2,
    backgroundColor: colors.northernTeal,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
