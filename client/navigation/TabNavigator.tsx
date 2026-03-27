import React from 'react';
import { StyleSheet, View, Platform, Image, Pressable } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { MapScreen } from '../screens/MapScreen';
import { ScreenErrorBoundary } from '../components/ScreenErrorBoundary';
import { HamburgerMenuButton } from '../components/HamburgerMenu';
import { useScreenOptions } from '../hooks/useScreenOptions';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';
import { hapticLight } from '../utils/haptics';

const Tab = createBottomTabNavigator();

function HeaderTitle() {
  return (
    <Image
      source={require('../../assets/traivo-logo.png')}
      style={{ width: 120, height: 32 }}
      resizeMode="contain"
    />
  );
}

function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  return (
    <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
      <Feather name={name as any} size={24} color={color} />
    </View>
  );
}

export function TabNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Tab.Navigator
      screenOptions={{
        ...screenOptions,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.primary,
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
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
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
});
