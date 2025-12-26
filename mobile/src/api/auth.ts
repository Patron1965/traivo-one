import { apiClient } from './client';
import type { Resource } from '../types';

export interface LoginCredentials {
  email: string;
  pin: string;
}

export interface LoginResponse {
  success: boolean;
  resource: Resource;
  token: string;
}

export const login = async (credentials: LoginCredentials): Promise<LoginResponse> => {
  const response = await apiClient.post<LoginResponse>('/api/mobile/login', credentials);
  return response.data;
};

export const logout = async (): Promise<void> => {
  await apiClient.post('/api/mobile/logout');
};

export const getCurrentResource = async (): Promise<Resource> => {
  const response = await apiClient.get<Resource>('/api/mobile/me');
  return response.data;
};
