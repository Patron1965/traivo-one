import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useScreenOptions } from '../hooks/useScreenOptions';
import { TabNavigator } from './TabNavigator';
import { LoginScreen } from '../screens/LoginScreen';
import { UnauthorizedScreen } from '../screens/UnauthorizedScreen';
import { OrderDetailScreen } from '../screens/OrderDetailScreen';
import { ReportDeviationScreen } from '../screens/ReportDeviationScreen';
import { MaterialLogScreen } from '../screens/MaterialLogScreen';
import { CameraCaptureScreen } from '../screens/CameraCaptureScreen';
import { SignatureScreen } from '../screens/SignatureScreen';
import { CustomerSignOffScreen } from '../screens/CustomerSignOffScreen';
import { InspectionScreen } from '../screens/InspectionScreen';
import { ScreenErrorBoundary } from '../components/ScreenErrorBoundary';
import { SettingsScreen } from '../screens/SettingsScreen';
import { NotificationPrefsScreen } from '../screens/NotificationPrefsScreen';
import StatisticsScreen from '../screens/StatisticsScreen';
import { RouteFeedbackScreen } from '../screens/RouteFeedbackScreen';
import { TeamScreen } from '../screens/TeamScreen';
import { CustomerReportsScreen } from '../screens/CustomerReportsScreen';
import { MyDeviationsScreen } from '../screens/MyDeviationsScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { AIAssistantScreen } from '../screens/AIAssistantScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { UrgentJobModal } from '../components/urgent/UrgentJobModal';
import { UrgentJobBanner } from '../components/urgent/UrgentJobBanner';
import { useUrgentJobSocket } from '../hooks/useUrgentJobSocket';
import { useWebSocket } from '../hooks/useWebSocket';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '../constants/theme';
import { FIELD_APP_ALLOWED_ROLES } from '../types';

const Stack = createNativeStackNavigator();

function useNotificationResponseListener() {
  const navigation = useNavigation<any>();

  useEffect(() => {
    let subscription: any;
    (async () => {
      try {
        const Notifications = await import('expo-notifications');
        subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
          const data = response.notification.request.content.data;
          if (data?.orderId) {
            navigation.navigate('OrderDetail', { orderId: data.orderId });
          }
        });
      } catch (e) {
        console.log('Notification listener setup skipped (expected in Expo Go):', e);
      }
    })();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [navigation]);
}

function UrgentJobSocketBridge() {
  const { user } = useAuth();
  const { addHandler } = useWebSocket(
    user?.id,
    user?.tenantId || 'plannix-demo',
    undefined
  );
  useUrgentJobSocket(addHandler);
  return null;
}

function AuthenticatedTabNavigator() {
  useNotificationResponseListener();
  return (
    <>
      <UrgentJobSocketBridge />
      <TabNavigator />
    </>
  );
}

function isUserRoleAllowed(role?: string): boolean {
  if (!role) return true;
  const normalized = role.toLowerCase().trim();
  return (FIELD_APP_ALLOWED_ROLES as readonly string[]).includes(normalized);
}

export function RootNavigator() {
  const { user, isLoading } = useAuth();
  const screenOptions = useScreenOptions();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const hasAccess = user ? isUserRoleAllowed(user.role) : false;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Navigator screenOptions={screenOptions}>
        {user ? (
          hasAccess ? (
            <>
              <Stack.Screen
                name="MainTabs"
                component={AuthenticatedTabNavigator}
                options={{ headerShown: false }}
              />
            <Stack.Screen
              name="OrderDetail"
              component={OrderDetailScreen}
              options={{ headerTitle: 'Uppdrag' }}
            />
            <Stack.Screen
              name="ReportDeviation"
              component={ReportDeviationScreen}
              options={{ headerTitle: 'Avvikelse' }}
            />
            <Stack.Screen
              name="MaterialLog"
              component={MaterialLogScreen}
              options={{ headerTitle: 'Material' }}
            />
            <Stack.Screen
              name="CameraCapture"
              component={CameraCaptureScreen}
              options={{ headerTitle: 'Foto' }}
            />
            <Stack.Screen
              name="Signature"
              component={SignatureScreen}
              options={{ headerTitle: 'Signatur' }}
            />
            <Stack.Screen
              name="CustomerSignOff"
              component={CustomerSignOffScreen}
              options={{ headerTitle: 'Kundkvittering' }}
            />
            <Stack.Screen
              name="Inspection"
              options={{ headerTitle: 'Inspektion' }}
            >
              {(props: any) => (
                <ScreenErrorBoundary fallbackTitle="Inspektionen kunde inte visas" fallbackIcon="clipboard">
                  <InspectionScreen {...props} />
                </ScreenErrorBoundary>
              )}
            </Stack.Screen>
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerTitle: 'Installningar' }}
            />
            <Stack.Screen
              name="Statistics"
              component={StatisticsScreen}
              options={{ headerTitle: 'Statistik' }}
            />
            <Stack.Screen
              name="RouteFeedback"
              component={RouteFeedbackScreen}
              options={{ headerTitle: 'Ruttbetyg' }}
            />
            <Stack.Screen
              name="Team"
              component={TeamScreen}
              options={{ headerTitle: 'Mitt team' }}
            />
            <Stack.Screen
              name="CustomerReports"
              component={CustomerReportsScreen}
              options={{ headerTitle: 'Kundrapporter' }}
            />
            <Stack.Screen
              name="MyDeviations"
              component={MyDeviationsScreen}
              options={{ headerTitle: 'Mina avvikelser' }}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ headerTitle: 'Aviseringar' }}
            />
            <Stack.Screen
              name="NotificationPrefs"
              component={NotificationPrefsScreen}
              options={{ headerTitle: 'SMS-inställningar' }}
            />
            <Stack.Screen
              name="AIAssistant"
              options={{
                headerTitle: 'Plannix Assist',
                headerStyle: { backgroundColor: Colors.surface },
                headerShadowVisible: true,
              }}
            >
              {(props: any) => (
                <ScreenErrorBoundary fallbackTitle="Assistenten kunde inte visas" fallbackIcon="cpu">
                  <AIAssistantScreen {...props} />
                </ScreenErrorBoundary>
              )}
            </Stack.Screen>
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ headerTitle: 'Profil' }}
            />
          </>
        ) : (
          <Stack.Screen
            name="Unauthorized"
            component={UnauthorizedScreen}
            options={{ headerShown: false }}
          />
        )
      ) : (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      )}
      </Stack.Navigator>
      <UrgentJobBanner />
      <UrgentJobModal />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
