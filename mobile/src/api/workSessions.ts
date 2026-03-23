import { apiClient } from './client';
import type { WorkSession } from '../types';

export const startWorkSession = async (): Promise<WorkSession> => {
  const response = await apiClient.post<WorkSession>('/api/mobile/work-sessions/start');
  return response.data;
};

export const stopWorkSession = async (sessionId: string): Promise<WorkSession> => {
  const response = await apiClient.patch<WorkSession>(`/api/mobile/work-sessions/${sessionId}/stop`);
  return response.data;
};

export const pauseWorkSession = async (sessionId: string): Promise<WorkSession> => {
  const response = await apiClient.patch<WorkSession>(`/api/mobile/work-sessions/${sessionId}/pause`);
  return response.data;
};

export const resumeWorkSession = async (sessionId: string): Promise<WorkSession> => {
  const response = await apiClient.patch<WorkSession>(`/api/mobile/work-sessions/${sessionId}/resume`);
  return response.data;
};

export const getActiveWorkSession = async (): Promise<WorkSession | null> => {
  try {
    const response = await apiClient.get<WorkSession>('/api/mobile/work-sessions/active');
    return response.data;
  } catch {
    return null;
  }
};
