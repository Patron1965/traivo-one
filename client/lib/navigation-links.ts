import { Platform, Linking } from 'react-native';
import { getSettings, MapApp } from './settings';

export function getMapNavigationUrl(lat: number, lng: number, label?: string): string {
  const mapApp = getSettings().mapApp;
  const encodedLabel = label ? encodeURIComponent(label) : '';

  switch (mapApp) {
    case 'waze':
      return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    case 'apple':
      if (Platform.OS === 'ios') {
        return `maps:?daddr=${lat},${lng}${encodedLabel ? `&q=${encodedLabel}` : ''}`;
      }
      return `https://maps.apple.com/?daddr=${lat},${lng}${encodedLabel ? `&q=${encodedLabel}` : ''}`;
    case 'google':
    default:
      if (Platform.OS === 'android') {
        return `google.navigation:q=${lat},${lng}`;
      }
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
}

export function openMapNavigation(lat: number, lng: number, label?: string): void {
  const url = getMapNavigationUrl(lat, lng, label);
  Linking.openURL(url).catch(() => {});
}
