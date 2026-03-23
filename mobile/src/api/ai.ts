import { apiClient } from './client';

interface ChatResponse {
  response: string;
}

interface TranscribeResponse {
  text: string;
}

interface ImageAnalysisResponse {
  category: string;
  description: string;
  severity: string;
}

export const sendChatMessage = async (message: string, context?: {
  orderNumber?: string;
  customerName?: string;
}): Promise<ChatResponse> => {
  const response = await apiClient.post<ChatResponse>('/api/mobile/ai/chat', { message, context });
  return response.data;
};

export const transcribeAudio = async (audioBase64: string): Promise<TranscribeResponse> => {
  const response = await apiClient.post<TranscribeResponse>('/api/mobile/ai/transcribe', { audio: audioBase64 });
  return response.data;
};

export const analyzeImage = async (imageBase64: string, context?: string): Promise<ImageAnalysisResponse> => {
  const response = await apiClient.post<ImageAnalysisResponse>('/api/mobile/ai/analyze-image', { image: imageBase64, context });
  return response.data;
};
