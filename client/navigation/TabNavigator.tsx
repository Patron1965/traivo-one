import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Platform, Image, Pressable } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { MapScreen } from '../screens/MapScreen';
import { TodoScreen, getUncompletedTodoCount } from '../screens/TodoScreen';
import { DayReportScreen } from '../screens/DayReportScreen';
import { ScreenErrorBoundary } from '../components/ScreenErrorBoundary';
import { HamburgerMenuButton } from '../components/HamburgerMenu';
import { useScreenOptions } from '../hooks/useScreenOptions';
import { useBranding, useThemeColors, useThemedStyles } from '../context/BrandingContext';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';
import { hapticLight } from '../utils/haptics';

const Tab = createBottomTabNavigator();

const FALLBACK_LOGO = require('../../assets/plannix-logo.png');

function HeaderTitle() {
  const { branding } = useBranding();
  return (
    <Image
      source={branding.logoUrl ? { uri: branding.logoUrl } : FALLBACK_LOGO}
      style={{ width: 120, height: 32 }}
      resizeMode="contain"
      defaultSource={FALLBACK_LOGO}
    />
  );
}

function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  const styles = useThemedStyles(createTabStyles);
  return (
    <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
      <Feather name={name as any} size={24} color={color} />
    </View>
  );
}

function TodoBadgeWrapper({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      getUncompletedTodoCount().then(setCount);
    }, [])
  );
  return <>{children}</>;
}

export function TabNavigator() {
  const styles = useThemedStyles(createTabStyles);
  const screenOptions = useScreenOptions();
  const themeColors = useThemeColors();
  const [todoBadge, setTodoBadge] = useState<number>(0);

  useFocusEffect(
    useCallback(() => {
      getUncompletedTodoCount().then(setTodoBadge);
      const interval = setInterval(() => getUncompletedTodoCount().then(setTodoBadge), 5000);
      return () => clearInterval(interval);
    }, [])
  );

  return (
    <Tab.Navigator
      screenOptions={{
        ...screenOptions,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: themeColors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
        headerRight: () => <HamburgerMenuButton />,
        headerRightContainerStyle: { paddingRight: Spacing.md },
        tabBarButton: (props) => (
          <Pressable
            {...props}
            onPress={(e) => {
              hapticLight();
              props.onPress?.(e);
            }}
          />
        ),
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{
          headerTitle: () => <HeaderTitle />,
          tabBarLabel: 'Hem',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="OrdersTab"
        component={OrdersScreen}
        options={{
          headerTitle: 'Uppdrag',
          tabBarLabel: 'Uppdrag',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="clipboard" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="TodoTab"
        component={TodoScreen}
        options={{
          headerTitle: 'Att göra',
          tabBarLabel: 'Att göra',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="list" color={color} focused={focused} />
          ),
          tabBarBadge: todoBadge > 0 ? todoBadge : undefined,
          tabBarBadgeStyle: styles.todoBadge,
        }}
      />
      <Tab.Screen
        name="MapTab"
        options={{
          headerTitle: 'Karta',
          tabBarLabel: 'Karta',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="map" color={color} focused={focused} />
          ),
        }}
      >
        {(props: any) => (
          <ScreenErrorBoundary fallbackTitle="Kartan kunde inte visas" fallbackIcon="map">
            <MapScreen {...props} />
          </ScreenErrorBoundary>
        )}
      </Tab.Screen>
      <Tab.Screen
        name="ReportTab"
        component={DayReportScreen}
        options={{
          headerTitle: 'Rapport',
          tabBarLabel: 'Rapport',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="file-text" color={color} focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// Themed style factory: re-evaluated by useThemedStyles whenever the
// tenant's brand colors change so the tab bar/icon backgrounds reflect
// the active tenant without remount.
const createTabStyles = () => StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 92 : 72,
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
    paddingTop: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  tabBarItem: {
    paddingTop: 4,
    gap: 2,
  },
  tabBarLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: FontSize.md,
    marginTop: 2,
  },
  tabIconWrap: {
    width: 52,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
  },
  tabIconWrapActive: {
    backgroundColor: Colors.infoLight,
  },
  todoBadge: {
    backgroundColor: '#F97316',
    fontSize: 10,
    fontWeight: '700',
    minWidth: 18,
    height: 18,
    lineHeight: 14,
  },
});
