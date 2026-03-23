import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { AuthProvider } from './src/context/AuthContext';
import { Navigation } from './src/navigation';
import { syncQueue } from './src/services/offlineQueue';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
    },
  },
});

export default function App() {
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    syncIntervalRef.current = setInterval(() => {
      syncQueue().catch(() => {});
    }, 2 * 60 * 1000);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncQueue().catch(() => {});
      }
    });

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      subscription.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Navigation />
          <StatusBar style="dark" />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
