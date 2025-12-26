import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken } from '../api/client';
import { login as apiLogin, logout as apiLogout, getCurrentResource } from '../api/auth';
import type { Resource, AuthState } from '../types';

interface AuthContextType extends AuthState {
  login: (email: string, pin: string) => Promise<boolean>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AUTH_TOKEN_KEY = '@auth_token';
const RESOURCE_KEY = '@resource';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    resource: null,
    token: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      const resourceStr = await AsyncStorage.getItem(RESOURCE_KEY);

      if (token && resourceStr) {
        setAuthToken(token);
        const resource = JSON.parse(resourceStr) as Resource;
        setAuthState({
          isAuthenticated: true,
          resource,
          token,
        });
      }
    } catch (error) {
      console.error('Failed to load auth state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, pin: string): Promise<boolean> => {
    try {
      const response = await apiLogin({ email, pin });
      
      if (response.success) {
        setAuthToken(response.token);
        await AsyncStorage.setItem(AUTH_TOKEN_KEY, response.token);
        await AsyncStorage.setItem(RESOURCE_KEY, JSON.stringify(response.resource));
        
        setAuthState({
          isAuthenticated: true,
          resource: response.resource,
          token: response.token,
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      setAuthToken(null);
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      await AsyncStorage.removeItem(RESOURCE_KEY);
      setAuthState({
        isAuthenticated: false,
        resource: null,
        token: null,
      });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        logout,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
