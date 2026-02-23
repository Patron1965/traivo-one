import { QueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function getApiUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    return `https://${domain}`;
  }
  if (Platform.OS === 'web') {
    return window.location.origin.replace(':8081', ':5000');
  }
  return 'http://localhost:5000';
}

async function getStoredToken(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem('auth');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.token || null;
    }
  } catch {}
  return null;
}

export async function apiRequest(
  method: string,
  path: string,
  body?: any,
  token?: string | null,
): Promise<any> {
  const url = new URL(path, getApiUrl()).toString();
  const authToken = token ?? await getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`${res.status}: ${errText}`);
  }
  return res.json();
}

async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }) {
  const path = queryKey[0] as string;
  const url = new URL(path, getApiUrl()).toString();
  const authToken = await getStoredToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status}`);
  }
  return res.json();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      staleTime: 30000,
      retry: 2,
    },
  },
});
