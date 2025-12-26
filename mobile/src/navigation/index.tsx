import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { OrderListScreen } from '../screens/OrderListScreen';
import { OrderDetailsScreen } from '../screens/OrderDetailsScreen';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

export type RootStackParamList = {
  Login: undefined;
  OrderList: undefined;
  OrderDetails: { orderId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function Navigation() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: '#fff',
          },
          headerTintColor: '#1a1a1a',
          headerTitleStyle: {
            fontWeight: '600',
          },
          headerShadowVisible: false,
        }}
      >
        {isAuthenticated ? (
          <>
            <Stack.Screen
              name="OrderList"
              component={OrderListScreen}
              options={{
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="OrderDetails"
              component={OrderDetailsScreen}
              options={{
                title: 'Uppdrag',
                headerBackTitle: 'Tillbaka',
              }}
            />
          </>
        ) : (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{
              headerShown: false,
            }}
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
    backgroundColor: '#f5f5f5',
  },
});
