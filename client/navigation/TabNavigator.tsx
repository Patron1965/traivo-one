import React from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { MapScreen } from '../screens/MapScreen';
import { AIAssistantScreen } from '../screens/AIAssistantScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { useScreenOptions } from '../hooks/useScreenOptions';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';
import { ThemedText } from '../components/ThemedText';

const Tab = createBottomTabNavigator();

function HeaderTitle() {
  return (
    <View style={styles.headerTitle}>
      <Feather name="compass" size={20} color={Colors.primary} />
      <ThemedText variant="subheading" color={Colors.primary}>
        Nordfield
      </ThemedText>
    </View>
  );
}

function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  return (
    <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
      <Feather name={name as any} size={22} color={color} />
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
        component={MapScreen}
        options={{
          headerTitle: 'Karta',
          tabBarLabel: 'Karta',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="map" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="AIAssistantTab"
        component={AIAssistantScreen}
        options={{
          headerTitle: 'Nordfield Assist',
          headerStyle: { backgroundColor: Colors.surface },
          headerShadowVisible: true,
          headerTransparent: false,
          tabBarLabel: 'Assist',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="cpu" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          headerTitle: 'Profil',
          tabBarLabel: 'Profil',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="user" color={color} focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 88 : 68,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 6,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  tabBarItem: {
    paddingTop: 2,
    gap: 2,
  },
  tabBarLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: FontSize.sm,
    marginTop: 2,
  },
  tabIconWrap: {
    width: 44,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
  },
  tabIconWrapActive: {
    backgroundColor: Colors.infoLight,
  },
});
