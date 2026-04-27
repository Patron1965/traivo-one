import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Image, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import * as ImagePicker from 'expo-image-picker';
import { triggerNotification, NotificationFeedbackType } from '../lib/haptics';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';
import { apiRequest, getApiUrl } from '../lib/query-client';

type PhotoItem = {
  uri: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  photoId?: string;
};

export function CameraCaptureScreen({ route, navigation }: any) {
  const styles = useThemedStyles(createCameraCaptureStyles);
  const { orderId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos(prev => [...prev, { uri: result.assets[0].uri, status: 'pending' }]);
      triggerNotification(NotificationFeedbackType.Success);
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
      const newPhotos = result.assets.map(a => ({ uri: a.uri, status: 'pending' as const }));
      setPhotos(prev => [...prev, ...newPhotos]);
      triggerNotification(NotificationFeedbackType.Success);
    }
  }

  function removePhoto(index: number) {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function uploadPhoto(photo: PhotoItem, index: number): Promise<boolean> {
    try {
      setPhotos(prev => prev.map((p, i) => i === index ? { ...p, status: 'uploading' } : p));

      const presignRes = await apiRequest('POST', `/api/mobile/orders/${orderId}/upload-photo`, {
        filename: `photo_${Date.now()}.jpg`,
        contentType: 'image/jpeg',
      });

      if (presignRes.uploadUrl) {
        if (Platform.OS === 'web') {
          const blob = await fetch(photo.uri).then(r => r.blob());
          await fetch(presignRes.uploadUrl, {
            method: 'PUT',
            body: blob,
            headers: { 'Content-Type': 'image/jpeg' },
          });
        } else {
          const FileSystem = await import('expo-file-system');
          await FileSystem.uploadAsync(presignRes.uploadUrl, photo.uri, {
            httpMethod: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          });
        }

        await apiRequest('POST', `/api/mobile/orders/${orderId}/confirm-photo`, {
          photoId: presignRes.photoId,
        });

        setPhotos(prev => prev.map((p, i) => i === index ? { ...p, status: 'uploaded', photoId: presignRes.photoId } : p));
        return true;
      }

      setPhotos(prev => prev.map((p, i) => i === index ? { ...p, status: 'uploaded' } : p));
      return true;
    } catch (err) {
      setPhotos(prev => prev.map((p, i) => i === index ? { ...p, status: 'failed' } : p));
      return false;
    }
  }

  async function saveAllPhotos() {
    setIsSaving(true);
    let successCount = 0;
    for (let i = 0; i < photos.length; i++) {
      if (photos[i].status === 'pending' || photos[i].status === 'failed') {
        const ok = await uploadPhoto(photos[i], i);
        if (ok) successCount++;
      } else if (photos[i].status === 'uploaded') {
        successCount++;
      }
    }
    setIsSaving(false);

    if (successCount === photos.length) {
      triggerNotification(NotificationFeedbackType.Success);
      navigation.goBack();
    } else {
      triggerNotification(NotificationFeedbackType.Error);
    }
  }

  function getStatusIcon(status: PhotoItem['status']): React.ReactNode {
    switch (status) {
      case 'uploading':
        return <ActivityIndicator size="small" color={Colors.textInverse} />;
      case 'uploaded':
        return <Feather name="check-circle" size={18} color="#2ECC71" />;
      case 'failed':
        return <Feather name="alert-circle" size={18} color={Colors.danger} />;
      default:
        return null;
    }
  }

  const pendingCount = photos.filter(p => p.status === 'pending' || p.status === 'failed').length;
  const uploadedCount = photos.filter(p => p.status === 'uploaded').length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xxl }}
    >
      <ThemedText variant="heading" style={styles.title}>
        Foton
      </ThemedText>
      <ThemedText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        Ta bilder av objekt eller avvikelser
      </ThemedText>

      <View style={styles.photoGrid}>
        {photos.map((photo, idx) => (
          <View key={idx} style={styles.photoContainer}>
            <Image source={{ uri: photo.uri }} style={styles.photo} />
            {photo.status !== 'pending' ? (
              <View style={styles.statusOverlay}>
                {getStatusIcon(photo.status)}
              </View>
            ) : null}
            {!isSaving ? (
              <Pressable
                style={styles.removeButton}
                onPress={() => removePhoto(idx)}
              >
                <Feather name="x" size={14} color={Colors.textInverse} />
              </Pressable>
            ) : null}
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
            Valj bild
          </ThemedText>
        </Pressable>
      </View>

      {photos.length > 0 ? (
        <View style={styles.statusBar}>
          <ThemedText variant="caption" color={Colors.textSecondary}>
            {uploadedCount > 0 ? `${uploadedCount} uppladdade` : ''}
            {uploadedCount > 0 && pendingCount > 0 ? ' | ' : ''}
            {pendingCount > 0 ? `${pendingCount} vantar` : ''}
          </ThemedText>
        </View>
      ) : null}

      {photos.length > 0 ? (
        <Pressable
          style={[styles.saveButton, isSaving ? styles.saveButtonDisabled : null]}
          onPress={saveAllPhotos}
          disabled={isSaving}
          testID="button-save-photos"
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={Colors.textInverse} />
          ) : (
            <Feather name="upload-cloud" size={18} color={Colors.textInverse} />
          )}
          <ThemedText variant="body" color={Colors.textInverse}>
            {isSaving ? 'Laddar upp...' : `Ladda upp ${photos.length} foto${photos.length > 1 ? 'n' : ''}`}
          </ThemedText>
        </Pressable>
      ) : null}

      {Platform.OS === 'web' ? (
        <View style={styles.webNote}>
          <Feather name="info" size={16} color={Colors.info} />
          <ThemedText variant="body" color={Colors.textSecondary}>
            Kor i Expo Go for full kamerafunktionalitet
          </ThemedText>
        </View>
      ) : null}
    </ScrollView>
  );
}

const createCameraCaptureStyles = () => StyleSheet.create({
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
  statusOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 2,
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
  statusBar: {
    marginTop: Spacing.md,
    alignItems: 'center',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.secondary,
    height: 48,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.xl,
  },
  saveButtonDisabled: {
    opacity: 0.7,
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
