import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getArticles, logMaterial } from '../api/sync';
import { addToQueue } from '../services/offlineQueue';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { Article } from '../types';
import type { RootStackParamList } from '../navigation';

type MaterialRouteProps = RouteProp<RootStackParamList, 'MaterialLog'>;
type MaterialNavProps = NativeStackNavigationProp<RootStackParamList>;

export function MaterialLogScreen() {
  const route = useRoute<MaterialRouteProps>();
  const navigation = useNavigation<MaterialNavProps>();
  const queryClient = useQueryClient();
  const { orderId } = route.params;

  const [search, setSearch] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [quantity, setQuantity] = useState('1');

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['articles', search],
    queryFn: () => getArticles(search || undefined),
  });

  const mutation = useMutation({
    mutationFn: () =>
      logMaterial(orderId, {
        articleId: selectedArticle!.id,
        articleNumber: selectedArticle!.articleNumber,
        articleName: selectedArticle!.name,
        quantity: parseInt(quantity) || 1,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      Alert.alert('Klart', 'Material loggat');
      navigation.goBack();
    },
    onError: async () => {
      await addToQueue({
        type: 'material',
        payload: {
          orderId,
          articleId: selectedArticle!.id,
          quantity: parseInt(quantity) || 1,
        },
      });
      Alert.alert('Sparad offline', 'Materialloggning sparas lokalt');
      navigation.goBack();
    },
  });

  const handleSubmit = () => {
    if (!selectedArticle) {
      Alert.alert('Fel', 'Välj en artikel');
      return;
    }
    mutation.mutate();
  };

  return (
    <View style={styles.container}>
      {selectedArticle ? (
        <View style={styles.selectedSection}>
          <View style={styles.selectedCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedName}>{selectedArticle.name}</Text>
              <Text style={styles.selectedNumber}>{selectedArticle.articleNumber} · {selectedArticle.unit}</Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedArticle(null)} data-testid="button-clear-article">
              <Text style={styles.changeText}>Ändra</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Antal</Text>
          <View style={styles.quantityRow}>
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => setQuantity(String(Math.max(1, (parseInt(quantity) || 1) - 1)))}
              data-testid="button-decrease-qty"
            >
              <Text style={styles.quantityButtonText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.quantityInput}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="number-pad"
              textAlign="center"
              data-testid="input-quantity"
            />
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => setQuantity(String((parseInt(quantity) || 0) + 1))}
              data-testid="button-increase-qty"
            >
              <Text style={styles.quantityButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSubmit}
            disabled={mutation.isPending}
            data-testid="button-submit-material"
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.submitButtonText}>Logga material</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Sök artikel..."
              placeholderTextColor={colors.mountainGray}
              data-testid="input-search-article"
            />
          </View>
          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.deepOceanBlue} />
            </View>
          ) : (
            <FlatList
              data={articles}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.articleCard}
                  onPress={() => setSelectedArticle(item)}
                  data-testid={`button-article-${item.id}`}
                >
                  <Text style={styles.articleName}>{item.name}</Text>
                  <Text style={styles.articleMeta}>{item.articleNumber} · {item.unit}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Text style={styles.emptyText}>Inga artiklar hittades</Text>
                </View>
              }
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  searchContainer: {
    padding: spacing.lg,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    backgroundColor: colors.arcticIce,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: colors.midnightNavy,
  },
  list: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  articleCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  articleName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.midnightNavy,
    marginBottom: spacing.xs,
  },
  articleMeta: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
  },
  selectedSection: {
    padding: spacing.lg,
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  selectedName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.midnightNavy,
  },
  selectedNumber: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    marginTop: spacing.xs,
  },
  changeText: {
    fontSize: fontSize.md,
    color: colors.northernTeal,
    fontWeight: '600',
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.mountainGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  quantityButton: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.md,
    backgroundColor: colors.deepOceanBlue,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityButtonText: {
    color: colors.white,
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
  },
  quantityInput: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
    borderWidth: 1,
    borderColor: colors.border,
  },
  submitButton: {
    backgroundColor: colors.northernTeal,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  submitButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
