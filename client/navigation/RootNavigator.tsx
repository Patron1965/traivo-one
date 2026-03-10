import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useScreenOptions } from '../hooks/useScreenOptions';
import { TabNavigator } from './TabNavigator';
import { LoginScreen } from '../screens/LoginScreen';
import { OrderDetailScreen } from '../screens/OrderDetailScreen';
import { ReportDeviationScreen } from '../screens/ReportDeviationScreen';
import { MaterialLogScreen } from '../screens/MaterialLogScreen';
import { CameraCaptureScreen } from '../screens/CameraCaptureScreen';
import { SignatureScreen } from '../screens/SignatureScreen';
import { InspectionScreen } from '../screens/InspectionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '../constants/theme';

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

function AuthenticatedTabNavigator() {
  useNotificationResponseListener();
  return <TabNavigator />;
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

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {user ? (
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
            name="Inspection"
            component={InspectionScreen}
            options={{ headerTitle: 'Inspektion' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ headerTitle: 'Inställningar' }}
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
