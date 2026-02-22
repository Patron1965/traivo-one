import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';
import type { Resource } from '../types';

interface AuthContextType {
  user: Resource | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string, pin?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Resource | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  async function loadStoredAuth() {
    try {
      const stored = await AsyncStorage.getItem('auth');
      if (stored) {
        const parsed = JSON.parse(stored);
        setUser(parsed.resource || parsed.user);
        setToken(parsed.token);
        try {
          const meData = await apiRequest('GET', '/api/mobile/me');
          if (meData.success && meData.resource) {
            setUser(meData.resource);
          }
        } catch {
          setUser(null);
          setToken(null);
          await AsyncStorage.removeItem('auth');
        }
      }
    } catch (e) {
      console.error('Failed to load auth:', e);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(username: string, password: string, pin?: string) {
    const body: any = pin ? { pin } : { username, password };
    const data = await apiRequest('POST', '/api/mobile/login', body);
    const resource = data.resource || data.user;
    setUser(resource);
    setToken(data.token);
    await AsyncStorage.setItem('auth', JSON.stringify({ resource, token: data.token }));
  }

  async function logout() {
    try {
      await apiRequest('POST', '/api/mobile/logout', {});
    } catch {}
    setUser(null);
    setToken(null);
    await AsyncStorage.removeItem('auth');
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
