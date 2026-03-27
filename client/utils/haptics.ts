import { Platform } from 'react-native';

let Haptics: any = null;

async function loadHaptics() {
  if (Haptics !== null) return;
  try {
    Haptics = await import('expo-haptics');
  } catch {
    Haptics = false;
  }
}

export async function hapticLight() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export async function hapticMedium() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

export async function hapticSuccess() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

export async function hapticWarning() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }
}

export async function hapticSelection() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.selectionAsync();
  }
}
