import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Image, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';

export function CameraCaptureScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<string[]>([]);

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos(prev => [...prev, result.assets[0].uri]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
    });
    if (!result.canceled && result.assets) {
      setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  function removePhoto(index: number) {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl }]}>
      <ThemedText variant="heading" style={styles.title}>
        Foton
      </ThemedText>
      <ThemedText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        Ta bilder av objekt eller avvikelser
      </ThemedText>

      <View style={styles.photoGrid}>
        {photos.map((uri, idx) => (
          <View key={idx} style={styles.photoContainer}>
            <Image source={{ uri }} style={styles.photo} />
            <Pressable
              style={styles.removeButton}
              onPress={() => removePhoto(idx)}
            >
              <Feather name="x" size={14} color={Colors.textInverse} />
            </Pressable>
          </View>
        ))}

        <Pressable style={styles.addPhotoButton} onPress={takePhoto} testID="button-take-photo">
          <Feather name="camera" size={32} color={Colors.primary} />
          <ThemedText variant="caption" color={Colors.primary}>
            Ta foto
          </ThemedText>
        </Pressable>

        <Pressable style={styles.addPhotoButton} onPress={pickFromGallery} testID="button-pick-gallery">
          <Feather name="image" size={32} color={Colors.primary} />
          <ThemedText variant="caption" color={Colors.primary}>
            V\u00e4lj bild
          </ThemedText>
        </Pressable>
      </View>

      {photos.length > 0 ? (
        <Pressable
          style={styles.saveButton}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            navigation.goBack();
          }}
          testID="button-save-photos"
        >
          <Feather name="check" size={18} color={Colors.textInverse} />
          <ThemedText variant="body" color={Colors.textInverse}>
            Spara {photos.length} foto{photos.length > 1 ? 'n' : ''}
          </ThemedText>
        </Pressable>
      ) : null}

      {Platform.OS === 'web' ? (
        <View style={styles.webNote}>
          <Feather name="info" size={16} color={Colors.info} />
          <ThemedText variant="body" color={Colors.textSecondary}>
            K\u00f6r i Expo Go f\u00f6r full kamerafunktionalitet
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {
    marginBottom: Spacing.xl,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  photoContainer: {
    position: 'relative',
    width: 100,
    height: 100,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoButton: {
    width: 100,
    height: 100,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.borderLight,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.secondary,
    height: 48,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.xxl,
  },
  webNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    backgroundColor: Colors.infoLight,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
});
