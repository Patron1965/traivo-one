import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';

interface User {
  id: number;
  name: string;
  role: string;
  resourceId: number;
  vehicleRegNo?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
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
  const [user, setUser] = useState<User | null>(null);
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
        setUser(parsed.user);
        setToken(parsed.token);
      }
    } catch (e) {
      console.error('Failed to load auth:', e);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(username: string, password: string) {
    const data = await apiRequest('POST', '/api/mobile/login', {
      username,
      password,
    });
    setUser(data.user);
    setToken(data.token);
    await AsyncStorage.setItem('auth', JSON.stringify(data));
  }

  async function logout() {
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
