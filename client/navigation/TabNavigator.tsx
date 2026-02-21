import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { MapScreen } from '../screens/MapScreen';
import { AIAssistantScreen } from '../screens/AIAssistantScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { useScreenOptions } from '../hooks/useScreenOptions';
import { Colors, FontSize } from '../constants/theme';
import { ThemedText } from '../components/ThemedText';

const Tab = createBottomTabNavigator();

function HeaderTitle() {
  return (
    <View style={styles.headerTitle}>
      <Feather name="truck" size={20} color={Colors.primary} />
      <ThemedText variant="subheading" color={Colors.primary}>
        Driver Core
      </ThemedText>
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
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{
          headerTitle: () => <HeaderTitle />,
          tabBarLabel: 'Hem',
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="OrdersTab"
        component={OrdersScreen}
        options={{
          headerTitle: 'Uppdrag',
          tabBarLabel: 'Uppdrag',
          tabBarIcon: ({ color, size }) => (
            <Feather name="clipboard" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="MapTab"
        component={MapScreen}
        options={{
          headerTitle: 'Karta',
          tabBarLabel: 'Karta',
          tabBarIcon: ({ color, size }) => (
            <Feather name="map" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="AIAssistantTab"
        component={AIAssistantScreen}
        options={{
          headerTitle: 'Unicorn Assist',
          headerStyle: { backgroundColor: Colors.surface },
          headerShadowVisible: true,
          headerTransparent: false,
          tabBarLabel: 'AI',
          tabBarIcon: ({ color, size }) => (
            <Feather name="cpu" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          headerTitle: 'Profil',
          tabBarLabel: 'Profil',
          tabBarIcon: ({ color, size }) => (
            <Feather name="user" size={size} color={color} />
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
    borderTopColor: Colors.borderLight,
    height: 85,
    paddingBottom: 20,
    paddingTop: 8,
  },
  tabBarLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: FontSize.xs,
  },
});
