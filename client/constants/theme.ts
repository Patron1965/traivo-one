import { Dimensions, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');

export const Colors = {
  primary: '#EA580C',
  primaryLight: '#F97316',
  primaryDark: '#C2410C',
  secondary: '#991B1B',
  secondaryLight: '#B91C1C',
  accent: '#F59E0B',
  accentLight: '#FDE68A',

  success: '#27AE60',
  successLight: '#EAFAF1',
  warning: '#F59E0B',
  warningLight: '#FEF9E7',
  danger: '#991B1B',
  dangerLight: '#FEE2E2',
  info: '#0E7490',
  infoLight: '#E0F2FE',

  background: '#F8F9FA',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardElevated: '#F0F3F5',

  text: '#1C2833',
  textSecondary: '#5D6D7E',
  textMuted: '#AEB6BF',
  textInverse: '#FFFFFF',

  border: '#D5D8DC',
  borderLight: '#EAECEE',
  divider: '#F2F3F4',

  overlay: 'rgba(0,0,0,0.5)',

  statusSkapad: '#95A5A6',
  statusPlaneradPre: '#9B59B6',
  statusPlaneradResurs: '#0E7490',
  statusPlaneradLas: '#EA580C',
  statusUtford: '#27AE60',
  statusFakturerad: '#1ABC9C',
  statusImpossible: '#991B1B',

  statusPlanned: '#9B59B6',
  statusDispatched: '#0E7490',
  statusOnSite: '#EA580C',
  statusInProgress: '#2ECC71',
  statusCompleted: '#27AE60',
  statusFailed: '#991B1B',
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
      shadowColor: '#000',
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
      shadowColor: '#000',
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
      shadowColor: '#000',
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
