import React, { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, StyleSheet, FlatList } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest, getApiUrl } from '../lib/query-client';
import type { Article } from '../types';

export function MaterialLogScreen({ route, navigation }: any) {
  const { orderId, articles } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [loggedItems, setLoggedItems] = useState<any[]>([]);

  const { data: searchResults } = useQuery<any[]>({
    queryKey: ['/api/mobile/articles', search],
    queryFn: async () => {
      const url = new URL('/api/mobile/articles', getApiUrl());
      if (search) url.searchParams.set('search', search);
      const res = await fetch(url.toString());
      return res.json();
    },
    enabled: search.length > 0,
  });

  const mutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest('POST', `/api/mobile/orders/${orderId}/materials`, data),
    onSuccess: (data) => {
      setLoggedItems(prev => [...prev, data]);
      setSelectedArticle(null);
      setQuantity('1');
      setNote('');
      setSearch('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  function handleLog() {
    if (!selectedArticle) return;
    mutation.mutate({
      articleId: selectedArticle.id,
      articleName: selectedArticle.name,
      quantity: parseInt(quantity) || 1,
      unit: selectedArticle.unit,
      note,
    });
  }

  const orderArticles = articles || [];
  const showResults = search.length > 0 && searchResults && searchResults.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText variant="heading" style={styles.title}>
        Materiallogg
      </ThemedText>

      {orderArticles.length > 0 ? (
        <>
          <ThemedText variant="label" style={styles.sectionLabel}>
            F\u00f6rv\u00e4ntade artiklar
          </ThemedText>
          {orderArticles.map((article: Article) => (
            <Pressable
              key={article.id}
              style={[
                styles.articleItem,
                selectedArticle?.id === article.id ? styles.articleSelected : null,
              ]}
              onPress={() => {
                setSelectedArticle(article);
                setQuantity(String(article.quantity));
                Haptics.selectionAsync();
              }}
              testID={`button-article-${article.id}`}
            >
              <View style={styles.articleInfo}>
                <ThemedText variant="body">{article.name}</ThemedText>
                <ThemedText variant="caption">
                  {article.quantity} {article.unit} | {article.category}
                </ThemedText>
              </View>
              {selectedArticle?.id === article.id ? (
                <Feather name="check-circle" size={20} color={Colors.secondary} />
              ) : (
                <Feather name="plus-circle" size={20} color={Colors.textMuted} />
              )}
            </Pressable>
          ))}
        </>
      ) : null}

      <ThemedText variant="label" style={[styles.sectionLabel, { marginTop: Spacing.xl }]}>
        S\u00f6k artikel
      </ThemedText>
      <View style={styles.searchContainer}>
        <Feather name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="S\u00f6k artiklar..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
          testID="input-article-search"
        />
      </View>

      {showResults ? (
        <View style={styles.searchResults}>
          {searchResults.map((article: any) => (
            <Pressable
              key={article.id}
              style={styles.searchResultItem}
              onPress={() => {
                setSelectedArticle(article);
                setSearch('');
                Haptics.selectionAsync();
              }}
            >
              <ThemedText variant="body">{article.name}</ThemedText>
              <ThemedText variant="caption">{article.category}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {selectedArticle ? (
        <Card style={styles.logForm}>
          <ThemedText variant="subheading">{selectedArticle.name}</ThemedText>
          <View style={styles.quantityRow}>
            <ThemedText variant="body">Antal:</ThemedText>
            <View style={styles.quantityControls}>
              <Pressable
                style={styles.quantityBtn}
                onPress={() => {
                  const n = Math.max(1, parseInt(quantity) - 1);
                  setQuantity(String(n));
                  Haptics.selectionAsync();
                }}
              >
                <Feather name="minus" size={18} color={Colors.primary} />
              </Pressable>
              <TextInput
                style={styles.quantityInput}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
                testID="input-quantity"
              />
              <Pressable
                style={styles.quantityBtn}
                onPress={() => {
                  const n = parseInt(quantity) + 1;
                  setQuantity(String(n));
                  Haptics.selectionAsync();
                }}
              >
                <Feather name="plus" size={18} color={Colors.primary} />
              </Pressable>
            </View>
          </View>
          <TextInput
            style={styles.noteInput}
            placeholder="Notering (valfritt)"
            placeholderTextColor={Colors.textMuted}
            value={note}
            onChangeText={setNote}
            testID="input-material-note"
          />
          <Pressable style={styles.logButton} onPress={handleLog} testID="button-log-material">
            <Feather name="check" size={18} color={Colors.textInverse} />
            <ThemedText variant="body" color={Colors.textInverse}>
              Registrera
            </ThemedText>
          </Pressable>
        </Card>
      ) : null}

      {loggedItems.length > 0 ? (
        <>
          <ThemedText variant="label" style={[styles.sectionLabel, { marginTop: Spacing.xl }]}>
            Registrerat idag
          </ThemedText>
          {loggedItems.map((item, idx) => (
            <View key={idx} style={styles.loggedItem}>
              <Feather name="check-circle" size={16} color={Colors.success} />
              <ThemedText variant="body">{item.articleName}</ThemedText>
              <ThemedText variant="caption">
                {item.quantity} {item.unit}
              </ThemedText>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xl,
  },
  sectionLabel: {
    marginBottom: Spacing.md,
  },
  articleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  articleSelected: {
    borderColor: Colors.secondary,
    backgroundColor: Colors.successLight,
  },
  articleInfo: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    height: 48,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  searchResults: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginTop: Spacing.sm,
  },
  searchResultItem: {
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  logForm: {
    marginTop: Spacing.lg,
    gap: Spacing.md,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  quantityBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.infoLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityInput: {
    width: 60,
    height: 40,
    textAlign: 'center',
    fontSize: FontSize.xl,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
  },
  noteInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  logButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.secondary,
    height: 48,
    borderRadius: BorderRadius.md,
  },
  loggedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
});
