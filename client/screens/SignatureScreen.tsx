import React, { useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, PanResponder, Dimensions, Platform } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { triggerNotification, triggerImpact, NotificationFeedbackType, ImpactFeedbackStyle } from '../lib/haptics';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';

interface PathData {
  id: number;
  d: string;
}

export function SignatureScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [paths, setPaths] = useState<PathData[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const pathIdRef = useRef(0);
  const layoutRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const currentPathRef = useRef<string>('');
  const currentPathSvgRef = useRef<any>(null);

  const hasSignature = paths.length > 0 || isDrawing;

  const mutation = useMutation({
    mutationFn: (signatureData: string) =>
      apiRequest('POST', `/api/mobile/orders/${orderId}/signature`, { signatureData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      triggerNotification(NotificationFeedbackType.Success);
      navigation.goBack();
    },
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touch = evt.nativeEvent;
        const x = touch.locationX;
        const y = touch.locationY;
        currentPathRef.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
        if (currentPathSvgRef.current) {
          currentPathSvgRef.current.setNativeProps({ d: currentPathRef.current });
        }
        setIsDrawing(true);
      },
      onPanResponderMove: (evt) => {
        const touch = evt.nativeEvent;
        const x = touch.locationX;
        const y = touch.locationY;
        currentPathRef.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        if (currentPathSvgRef.current) {
          currentPathSvgRef.current.setNativeProps({ d: currentPathRef.current });
        }
      },
      onPanResponderRelease: () => {
        if (currentPathRef.current.length > 0) {
          pathIdRef.current += 1;
          const finishedPath = currentPathRef.current;
          currentPathRef.current = '';
          setPaths(prev => [...prev, { id: pathIdRef.current, d: finishedPath }]);
          setIsDrawing(false);
        }
      },
    })
  ).current;

  const handleClear = useCallback(() => {
    setPaths([]);
    currentPathRef.current = '';
    setIsDrawing(false);
    pathIdRef.current = 0;
    if (currentPathSvgRef.current) {
      currentPathSvgRef.current.setNativeProps({ d: '' });
    }
    triggerImpact(ImpactFeedbackStyle.Light);
  }, []);

  const handleSave = useCallback(() => {
    const allPaths = paths.map(p => p.d).join('|');
    mutation.mutate(allPaths);
  }, [paths, mutation]);

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.md }]}>
      <ThemedText variant="heading" style={styles.title}>
        Digital signatur
      </ThemedText>
      <ThemedText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        Rita signaturen med fingret nedan
      </ThemedText>

      <View
        style={styles.signatureArea}
        onLayout={(e) => {
          layoutRef.current = e.nativeEvent.layout;
        }}
        {...panResponder.panHandlers}
      >
        <Svg style={StyleSheet.absoluteFill}>
          {paths.map(p => (
            <Path
              key={p.id}
              d={p.d}
              stroke={Colors.text}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          <Path
            ref={currentPathSvgRef}
            d=""
            stroke={Colors.text}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        {!hasSignature ? (
          <View style={styles.signaturePlaceholder} pointerEvents="none">
            <Feather name="edit-3" size={32} color={Colors.borderLight} />
            <ThemedText variant="caption" color={Colors.borderLight}>
              Rita din signatur här
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.signatureLine} />
      </View>

      <View style={[styles.buttonRow, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={styles.clearButton}
          onPress={handleClear}
          testID="button-clear-signature"
        >
          <Feather name="trash-2" size={18} color={Colors.danger} />
          <ThemedText variant="body" color={Colors.danger}>
            Rensa
          </ThemedText>
        </Pressable>

        <Pressable
          style={[styles.saveButton, !hasSignature ? styles.saveButtonDisabled : null]}
          onPress={handleSave}
          disabled={!hasSignature || mutation.isPending}
          testID="button-save-signature"
        >
          <Feather name="check" size={18} color={Colors.textInverse} />
          <ThemedText variant="body" color={Colors.textInverse}>
            {mutation.isPending ? 'Sparar...' : 'Spara signatur'}
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
    marginBottom: Spacing.lg,
  },
  signatureArea: {
    flex: 1,
    maxHeight: 350,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    marginBottom: Spacing.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  signaturePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  signatureLine: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.dangerLight,
    height: 52,
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
    height: 52,
    borderRadius: BorderRadius.lg,
  },
  saveButtonDisabled: {
    backgroundColor: Colors.textMuted,
  },
});
