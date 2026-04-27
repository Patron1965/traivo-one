import React, { useRef, useState, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, Pressable, PanResponder, TextInput,
  ActivityIndicator, Platform
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { triggerNotification, triggerImpact, NotificationFeedbackType, ImpactFeedbackStyle } from '../lib/haptics';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';
import { apiRequest } from '../lib/query-client';
import type { Order } from '../types';

interface PathData {
  id: number;
  d: string;
}

export function CustomerSignOffScreen({ route, navigation }: any) {
  const styles = useThemedStyles(createCustomerSignOffStyles);
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState('');
  const [paths, setPaths] = useState<PathData[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const pathIdRef = useRef(0);
  const currentPathRef = useRef<string>('');
  const currentPathSvgRef = useRef<any>(null);

  const hasSignature = paths.length > 0 || isDrawing;

  const { data: order, isLoading } = useQuery<Order>({
    queryKey: [`/api/mobile/orders/${orderId}`],
  });

  const signOffMutation = useMutation({
    mutationFn: (data: { customerName: string; signatureData: string; signedAt: string }) =>
      apiRequest('POST', `/api/mobile/orders/${orderId}/customer-signoff`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${orderId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
      triggerNotification(NotificationFeedbackType.Success);
      navigation.goBack();
    },
    onError: () => {
      triggerNotification(NotificationFeedbackType.Error);
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

  const handleSubmit = useCallback(() => {
    if (!hasSignature || customerName.trim().length === 0) return;
    const allPaths = paths.map(p => p.d).join('|');
    signOffMutation.mutate({
      customerName: customerName.trim(),
      signatureData: allPaths,
      signedAt: new Date().toISOString(),
    });
  }, [hasSignature, customerName, paths, signOffMutation]);

  const canSubmit = hasSignature && customerName.trim().length > 0 && !signOffMutation.isPending;

  if (isLoading || !order) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight + Spacing.md }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const subSteps = order.subSteps || [];
  const completedSteps = subSteps.filter(s => s.completed).length;
  const deviations = order.deviations || [];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + 100 },
        ]}
      >
        <ThemedText variant="heading" style={styles.title}>
          Kundkvittering
        </ThemedText>
        <ThemedText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
          Kunden bekräftar utfört arbete
        </ThemedText>

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Ordersammanfattning</ThemedText>
          <View style={styles.summaryRow}>
            <Feather name="hash" size={16} color={Colors.primary} />
            <ThemedText variant="body">{order.orderNumber}</ThemedText>
          </View>
          <View style={styles.summaryRow}>
            <Feather name="map-pin" size={16} color={Colors.primary} />
            <ThemedText variant="body">{order.address}, {order.postalCode} {order.city}</ThemedText>
          </View>
          <View style={styles.summaryRow}>
            <Feather name="user" size={16} color={Colors.primary} />
            <ThemedText variant="body">{order.customerName}</ThemedText>
          </View>
          <View style={styles.summaryRow}>
            <StatusBadge status={order.status} />
          </View>
        </Card>

        {subSteps.length > 0 ? (
          <Card>
            <ThemedText variant="label" style={styles.sectionLabel}>Utfört arbete</ThemedText>
            <View style={styles.progressRow}>
              <ThemedText variant="body" color={Colors.secondary}>
                {completedSteps}/{subSteps.length} steg klara
              </ThemedText>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${subSteps.length > 0 ? (completedSteps / subSteps.length) * 100 : 0}%` },
                  ]}
                />
              </View>
            </View>
            {subSteps.map(step => (
              <View key={step.id} style={styles.checklistRow}>
                <Feather
                  name={step.completed ? 'check-circle' : 'circle'}
                  size={18}
                  color={step.completed ? Colors.success : Colors.textMuted}
                />
                <ThemedText
                  variant="body"
                  color={step.completed ? Colors.text : Colors.textMuted}
                  style={step.completed ? undefined : styles.incompleteText}
                >
                  {step.name}
                </ThemedText>
              </View>
            ))}
          </Card>
        ) : null}

        {order.articles.length > 0 ? (
          <Card>
            <ThemedText variant="label" style={styles.sectionLabel}>Material</ThemedText>
            {order.articles.map(article => (
              <View key={article.id} style={styles.materialRow}>
                <View style={styles.materialDot} />
                <ThemedText variant="body" style={styles.materialName}>
                  {article.name}
                </ThemedText>
                <ThemedText variant="body" color={Colors.textSecondary}>
                  {article.quantity} {article.unit}
                </ThemedText>
              </View>
            ))}
          </Card>
        ) : null}

        {deviations.length > 0 ? (
          <Card style={styles.deviationCard}>
            <ThemedText variant="label" style={styles.sectionLabel}>Avvikelser</ThemedText>
            {deviations.map(dev => (
              <View key={dev.id} style={styles.deviationRow}>
                <Feather name="alert-triangle" size={16} color={Colors.warning} />
                <View style={styles.deviationInfo}>
                  <ThemedText variant="body">{dev.category}</ThemedText>
                  <ThemedText variant="caption" color={Colors.textSecondary}>
                    {dev.description}
                  </ThemedText>
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Kundens namn</ThemedText>
          <TextInput
            style={styles.nameInput}
            placeholder="Skriv kundens namn..."
            placeholderTextColor={Colors.textMuted}
            value={customerName}
            onChangeText={setCustomerName}
            testID="input-customer-name"
          />
        </Card>

        <Card>
          <ThemedText variant="label" style={styles.sectionLabel}>Kundens signatur</ThemedText>
          <View
            style={styles.signatureArea}
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
                <Feather name="edit-3" size={28} color={Colors.borderLight} />
                <ThemedText variant="caption" color={Colors.borderLight}>
                  Rita signatur här
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.signatureLine} />
          </View>
          <Pressable
            style={styles.clearSignatureButton}
            onPress={handleClear}
            testID="button-clear-customer-signature"
          >
            <Feather name="trash-2" size={14} color={Colors.danger} />
            <ThemedText variant="caption" color={Colors.danger}>
              Rensa signatur
            </ThemedText>
          </Pressable>
        </Card>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[styles.submitButton, !canSubmit ? styles.submitButtonDisabled : null]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          testID="button-customer-signoff"
        >
          {signOffMutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.textInverse} />
          ) : (
            <Feather name="check-circle" size={20} color={Colors.textInverse} />
          )}
          <ThemedText variant="subheading" color={Colors.textInverse}>
            {signOffMutation.isPending ? 'Skickar...' : 'Godkänn och signera'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const createCustomerSignOffStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {
    marginBottom: Spacing.sm,
  },
  sectionLabel: {
    marginBottom: Spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  progressBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.borderLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.secondary,
    borderRadius: 3,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  incompleteText: {
    fontStyle: 'italic',
  },
  materialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  materialDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.secondary,
  },
  materialName: {
    flex: 1,
  },
  deviationCard: {
    backgroundColor: Colors.warningLight,
  },
  deviationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  deviationInfo: {
    flex: 1,
  },
  nameInput: {
    height: 48,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    fontFamily: 'Inter_400Regular',
    fontSize: FontSize.md,
    color: Colors.text,
  },
  signatureArea: {
    height: 200,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
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
    bottom: 30,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  clearSignatureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    alignSelf: 'flex-end',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 56,
    backgroundColor: Colors.secondary,
    borderRadius: BorderRadius.lg,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.textMuted,
  },
});
