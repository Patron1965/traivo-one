import * as Haptics from 'expo-haptics';
import { getSettings } from './settings';

export async function triggerImpact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium): Promise<void> {
  if (!getSettings().hapticFeedback) return;
  return Haptics.impactAsync(style);
}

export async function triggerNotification(type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success): Promise<void> {
  if (!getSettings().hapticFeedback) return;
  return Haptics.notificationAsync(type);
}

export async function triggerSelection(): Promise<void> {
  if (!getSettings().hapticFeedback) return;
  return Haptics.selectionAsync();
}
