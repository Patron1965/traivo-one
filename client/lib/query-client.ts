import { QueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

function toV1Path(path: string): string {
  if (path.startsWith('/api/v1/')) return path;
  if (path.startsWith('/api/mobile/')) return path.replace('/api/mobile/', '/api/v1/mobile/');
  if (path.startsWith('/api/planner/')) return path.replace('/api/planner/', '/api/v1/planner/');
  if (path.startsWith('/api/')) return path.replace('/api/', '/api/v1/');
  return path;
}

export function getApiUrl(): string {
  const manifestHost = Constants.expoConfig?.hostUri
    || (Constants as any).manifest?.debuggerHost
    || (Constants as any).manifest2?.extra?.expoClient?.hostUri;
  if (manifestHost) {
    const host = manifestHost.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `https://${host}`;
    }
  }

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
  } catch (e) {
    console.warn('Failed to read stored auth token:', e);
  }
  return null;
}

function httpStatusMessage(status: number): string {
  switch (status) {
    case 401: return 'Du är inte inloggad. Logga in igen.';
    case 403: return 'Du har inte behörighet för denna åtgärd.';
    case 404: return 'Resursen hittades inte.';
    case 408: return 'Servern svarade inte i tid. Försök igen.';
    case 429: return 'För många förfrågningar. Vänta en stund.';
    case 500: return 'Serverfel. Försök igen senare.';
    case 502: return 'Servern är tillfälligt otillgänglig.';
    case 503: return 'Servern är otillgänglig. Försök igen om en stund.';
    default: return `Något gick fel (${status}). Försök igen.`;
  }
}

export async function apiRequest(
  method: string,
  path: string,
  body?: any,
  token?: string | null,
): Promise<any> {
  const url = new URL(toV1Path(path), getApiUrl()).toString();
  const authToken = token ?? await getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  AsyncStorage.setItem('@last_activity_timestamp', String(Date.now())).catch(() => {});
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr: any) {
    throw new Error('Nätverksfel — kontrollera din internetanslutning och försök igen.');
  }
  if (!res.ok) {
    let errBody: any;
    try {
      errBody = await res.json();
    } catch {
      const errText = await res.text().catch(() => '');
      errBody = { error: errText };
    }
    const message = errBody?.error || errBody?.message || httpStatusMessage(res.status);
    throw new Error(message);
  }
  return res.json();
}

async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }) {
  const path = queryKey[0] as string;
  const url = new URL(toV1Path(path), getApiUrl()).toString();
  const authToken = await getStoredToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new Error('Nätverksfel — kontrollera din internetanslutning och försök igen.');
  }
  if (!res.ok) {
    let errBody: any;
    try {
      errBody = await res.json();
    } catch {
      errBody = {};
    }
    const message = errBody?.error || errBody?.message || httpStatusMessage(res.status);
    throw new Error(message);
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
