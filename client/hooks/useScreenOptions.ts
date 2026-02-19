import { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { Colors } from '../constants/theme';

interface Options {
  transparent?: boolean;
}

export function useScreenOptions(options?: Options): NativeStackNavigationOptions {
  const transparent = options?.transparent ?? true;

  return {
    headerStyle: {
      backgroundColor: transparent ? 'transparent' : Colors.surface,
    },
    headerTintColor: Colors.text,
    headerTitleStyle: {
      fontFamily: 'Inter_600SemiBold',
    },
    headerShadowVisible: !transparent,
    headerTransparent: transparent,
    headerBackTitleVisible: false,
    contentStyle: {
      backgroundColor: Colors.background,
    },
  };
}
