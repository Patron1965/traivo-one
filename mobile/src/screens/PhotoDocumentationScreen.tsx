import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { submitPhotos } from '../api/sync';
import { addToQueue } from '../services/offlineQueue';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { RootStackParamList } from '../navigation';

type RouteProps = RouteProp<RootStackParamList, 'PhotoDocumentation'>;
type NavProps = NativeStackNavigationProp<RootStackParamList>;

export function PhotoDocumentationScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavProps>();
  const queryClient = useQueryClient();
  const { orderId } = route.params;

  const [photos, setPhotos] = useState<Array<{ uri: string; caption: string }>>([]);
  const [isSaving, setIsSaving] = useState(false);

  const takePhoto = async () => {
    try {
      const ImagePicker = require('expo-image-picker');
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Behörighet', 'Kameraåtkomst behövs för att ta foton');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        setPhotos(prev => [...prev, {
          uri: result.assets[0].uri,
          caption: '',
        }]);
      }
    } catch {
      Alert.alert('Fel', 'Kunde inte öppna kameran');
    }
  };

  const pickFromLibrary = async () => {
    try {
      const ImagePicker = require('expo-image-picker');
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Behörighet', 'Behöver åtkomst till bildbiblioteket');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: true,
        base64: true,
      });
      if (!result.canceled) {
        const newPhotos = result.assets.map((asset: { uri: string }) => ({
          uri: asset.uri,
          caption: '',
        }));
        setPhotos(prev => [...prev, ...newPhotos]);
      }
    } catch {
      Alert.alert('Fel', 'Kunde inte öppna bildbiblioteket');
    }
  };

  const updateCaption = (index: number, caption: string) => {
    setPhotos(prev => prev.map((p, i) => i === index ? { ...p, caption } : p));
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (photos.length === 0) {
      Alert.alert('Fel', 'Lägg till minst ett foto');
      return;
    }
    setIsSaving(true);
    try {
      await submitPhotos(orderId, photos.map(p => ({ uri: p.uri, caption: p.caption })));
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      Alert.alert('Klart', `${photos.length} foto(n) sparade`);
      navigation.goBack();
    } catch {
      await addToQueue({
        type: 'photo',
        payload: { orderId, photos: photos.map(p => ({ uri: p.uri, caption: p.caption })) },
      });
      Alert.alert('Sparad offline', 'Foton sparas lokalt och laddas upp vid anslutning');
      navigation.goBack();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Fotodokumentation</Text>
      <Text style={styles.subtitle}>Ta foton av arbetet för dokumentation</Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.captureButton}
          onPress={takePhoto}
          data-testid="button-take-photo"
        >
          <Text style={styles.captureIcon}>📸</Text>
          <Text style={styles.captureText}>Ta foto</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.captureButton}
          onPress={pickFromLibrary}
          data-testid="button-pick-photo"
        >
          <Text style={styles.captureIcon}>🖼️</Text>
          <Text style={styles.captureText}>Välj bild</Text>
        </TouchableOpacity>
      </View>

      {photos.length > 0 && (
        <View style={styles.photoList}>
          {photos.map((photo, index) => (
            <View key={index} style={styles.photoItem}>
              <View style={styles.photoHeader}>
                <Image source={{ uri: photo.uri }} style={styles.thumbnail} />
                <View style={styles.photoInfo}>
                  <Text style={styles.photoLabel}>Foto {index + 1}</Text>
                  <TouchableOpacity
                    onPress={() => removePhoto(index)}
                    data-testid={`button-remove-photo-${index}`}
                  >
                    <Text style={styles.removeText}>Ta bort</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TextInput
                style={styles.captionInput}
                value={photo.caption}
                onChangeText={(text) => updateCaption(index, text)}
                placeholder="Lägg till bildtext (valfritt)..."
                placeholderTextColor={colors.mountainGray}
                data-testid={`input-caption-${index}`}
              />
            </View>
          ))}
        </View>
      )}

      {photos.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyText}>Inga foton tillagda ännu</Text>
          <Text style={styles.emptySubtext}>Tryck på knapparna ovan för att lägga till</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.saveButton, photos.length === 0 && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={isSaving || photos.length === 0}
        data-testid="button-save-photos"
      >
        {isSaving ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.saveButtonText}>
            Spara {photos.length > 0 ? `${photos.length} foto(n)` : 'foton'}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
    marginBottom: spacing.xl,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  captureButton: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.deepOceanBlue,
    borderStyle: 'dashed',
    minHeight: 100,
    justifyContent: 'center',
  },
  captureIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  captureText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.deepOceanBlue,
  },
  photoList: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  photoItem: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  thumbnail: {
    width: 80,
    height: 60,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.border,
  },
  photoInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginLeft: spacing.md,
  },
  photoLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.midnightNavy,
  },
  removeText: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontWeight: '600',
  },
  captionInput: {
    backgroundColor: colors.arcticIce,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.midnightNavy,
    minHeight: 40,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    marginBottom: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.mountainGray,
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
  },
  saveButton: {
    backgroundColor: colors.northernTeal,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
