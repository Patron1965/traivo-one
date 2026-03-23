import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { OrderListScreen } from '../screens/OrderListScreen';
import { OrderDetailsScreen } from '../screens/OrderDetailsScreen';
import { DeviationReportScreen } from '../screens/DeviationReportScreen';
import { MaterialLogScreen } from '../screens/MaterialLogScreen';
import { SignatureScreen } from '../screens/SignatureScreen';
import { InspectionScreen } from '../screens/InspectionScreen';
import { WorkSessionScreen } from '../screens/WorkSessionScreen';
import { AIAssistantScreen } from '../screens/AIAssistantScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { RouteFeedbackScreen } from '../screens/RouteFeedbackScreen';
import { PhotoDocumentationScreen } from '../screens/PhotoDocumentationScreen';
import { ChecklistScreen } from '../screens/ChecklistScreen';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';
import { SyncStatusBar } from '../components/SyncStatusBar';

export type RootStackParamList = {
  Login: undefined;
  MainTabs: undefined;
  OrderDetails: { orderId: string };
  DeviationReport: { orderId: string };
  MaterialLog: { orderId: string };
  Signature: { orderId: string };
  Inspection: { orderId: string };
  PhotoDocumentation: { orderId: string };
  Checklist: { orderId: string };
  WorkSession: undefined;
  RouteFeedback: undefined;
};

export type TabParamList = {
  DashboardTab: undefined;
  OrdersTab: undefined;
  AITab: undefined;
  NotificationsTab: undefined;
  ProfileTab: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    DashboardTab: '🏠',
    OrdersTab: '📋',
    AITab: '🤖',
    NotificationsTab: '🔔',
    ProfileTab: '👤',
  };
  return (
    <Text style={{ fontSize: focused ? 24 : 20, opacity: focused ? 1 : 0.6 }}>
      {icons[label] || '📌'}
    </Text>
  );
}

function MainTabs() {
  return (
    <View style={{ flex: 1 }}>
      <SyncStatusBar />
      <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
        tabBarActiveTintColor: colors.deepOceanBlue,
        tabBarInactiveTintColor: colors.mountainGray,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          paddingBottom: 4,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: colors.white,
        },
        headerTintColor: colors.midnightNavy,
        headerTitleStyle: {
          fontWeight: '600',
        },
        headerShadowVisible: false,
      })}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardScreen}
        options={{ title: 'Hem', headerTitle: 'Traivo Go' }}
      />
      <Tab.Screen
        name="OrdersTab"
        component={OrderListScreen}
        options={{ title: 'Ordrar', headerTitle: 'Dagens ordrar' }}
      />
      <Tab.Screen
        name="AITab"
        component={AIAssistantScreen}
        options={{ title: 'AI', headerTitle: 'AI-assistent' }}
      />
      <Tab.Screen
        name="NotificationsTab"
        component={NotificationsScreen}
        options={{ title: 'Aviseringar', headerTitle: 'Notifieringar' }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ title: 'Profil', headerTitle: 'Min profil' }}
      />
    </Tab.Navigator>
    </View>
  );
}

export function Navigation() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.deepOceanBlue} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.white,
          },
          headerTintColor: colors.midnightNavy,
          headerTitleStyle: {
            fontWeight: '600',
          },
          headerShadowVisible: false,
          headerBackTitle: 'Tillbaka',
        }}
      >
        {isAuthenticated ? (
          <>
            <Stack.Screen
              name="MainTabs"
              component={MainTabs}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OrderDetails"
              component={OrderDetailsScreen}
              options={{ title: 'Uppdrag' }}
            />
            <Stack.Screen
              name="DeviationReport"
              component={DeviationReportScreen}
              options={{ title: 'Avvikelserapport' }}
            />
            <Stack.Screen
              name="MaterialLog"
              component={MaterialLogScreen}
              options={{ title: 'Logga material' }}
            />
            <Stack.Screen
              name="Signature"
              component={SignatureScreen}
              options={{ title: 'Signatur' }}
            />
            <Stack.Screen
              name="Inspection"
              component={InspectionScreen}
              options={{ title: 'Inspektion' }}
            />
            <Stack.Screen
              name="WorkSession"
              component={WorkSessionScreen}
              options={{ title: 'Arbetspass' }}
            />
            <Stack.Screen
              name="PhotoDocumentation"
              component={PhotoDocumentationScreen}
              options={{ title: 'Foton' }}
            />
            <Stack.Screen
              name="Checklist"
              component={ChecklistScreen}
              options={{ title: 'Checklista' }}
            />
            <Stack.Screen
              name="RouteFeedback"
              component={RouteFeedbackScreen}
              options={{ title: 'Ruttbetyg' }}
            />
          </>
        ) : (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.arcticIce,
  },
});
