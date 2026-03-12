import { Dimensions, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');

export const Colors = {
  primary: '#1B4B6B',
  primaryLight: '#2A6496',
  primaryDark: '#0E2F4A',
  secondary: '#4A9B9B',
  secondaryLight: '#5AABAB',
  accent: '#7DBFB0',
  accentLight: '#B0D9D2',

  success: '#4A9B9B',
  successLight: '#E0F5F5',
  warning: '#E6A817',
  warningLight: '#FEF3CD',
  danger: '#C0392B',
  dangerLight: '#FDECEA',
  info: '#2A6496',
  infoLight: '#D6E8F5',

  background: '#E8F4F8',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardElevated: '#F0F7FA',

  text: '#2C3E50',
  textSecondary: '#6B7C8C',
  textMuted: '#A0B0BC',
  textInverse: '#FFFFFF',

  border: '#C5D5DC',
  borderLight: '#DDE8EE',
  divider: '#EEF4F7',

  overlay: 'rgba(0,0,0,0.5)',

  statusSkapad: '#95A5A6',
  statusPlaneradPre: '#7DBFB0',
  statusPlaneradResurs: '#4A9B9B',
  statusPlaneradLas: '#1B4B6B',
  statusUtford: '#4A9B9B',
  statusFakturerad: '#7DBFB0',
  statusImpossible: '#C0392B',

  statusPlanned: '#6B7C8C',
  statusDispatched: '#2A6496',
  statusOnSite: '#4A9B9B',
  statusInProgress: '#7DBFB0',
  statusCompleted: '#4A9B9B',
  statusFailed: '#C0392B',
  statusCancelled: '#95A5A6',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const FontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  xxxl: 28,
  title: 34,
};

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  round: 999,
};

export const IconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

export const Screen = {
  width,
  height,
  isSmall: width < 375,
};

export const Shadows = {
  sm: Platform.select({
    ios: {
      shadowColor: '#1B4B6B',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
    },
    android: {
      elevation: 2,
    },
    default: {},
  }),
  md: Platform.select({
    ios: {
      shadowColor: '#1B4B6B',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
    },
    android: {
      elevation: 4,
    },
    default: {},
  }),
  lg: Platform.select({
    ios: {
      shadowColor: '#1B4B6B',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
    },
    android: {
      elevation: 8,
    },
    default: {},
  }),
};
