import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import type { Colors } from '../utils/theme';
import {
  TAG_SUGGESTIONS, tagsToInput, parseTagsInput, collectAllTags, itemMatchesTagFilter,
} from '../utils/tags';

export function TagEditor({
  tags, onChange, colors, label = 'Tags',
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  colors: Colors;
  label?: string;
}) {
  const s = styles(colors);
  const [text, setText] = React.useState(tagsToInput(tags));

  React.useEffect(() => {
    setText(tagsToInput(tags));
  }, [tags]);

  const commit = (raw: string) => {
    const next = parseTagsInput(raw);
    onChange(next);
    setText(tagsToInput(next));
  };

  const addSuggestion = (tag: string) => {
    const lower = tag.toLowerCase();
    if (tags.some(t => t.toLowerCase() === lower)) return;
    onChange([...tags, tag].sort((a, b) => a.localeCompare(b)));
    setText(tagsToInput([...tags, tag]));
  };

  const unused = TAG_SUGGESTIONS.filter(sug => !tags.some(t => t.toLowerCase() === sug.toLowerCase()));

  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.hint}>Comma-separated — park, franchise, season, etc.</Text>
      <TextInput
        style={s.input}
        value={text}
        onChangeText={setText}
        onBlur={() => commit(text)}
        onSubmitEditing={() => commit(text)}
        placeholder="Magic Kingdom, Marvel, …"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="words"
      />
      {tags.length > 0 && (
        <View style={s.chipRow}>
          {tags.map(tag => (
            <TouchableOpacity key={tag} style={s.chip}
              onPress={() => onChange(tags.filter(t => t !== tag))}>
              <Text style={s.chipText}>{tag} ×</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {unused.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.suggestScroll}>
          <View style={s.chipRow}>
            {unused.slice(0, 12).map(tag => (
              <TouchableOpacity key={tag} style={s.suggestChip} onPress={() => addSuggestion(tag)}>
                <Text style={s.suggestText}>+ {tag}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export function TagFilterBar<T extends { name: string; tags?: string[] }>({
  items, search, onSearchChange, activeTag, onActiveTagChange, colors, placeholder = 'Search name or tags…',
}: {
  items: T[];
  search: string;
  onSearchChange: (v: string) => void;
  activeTag: string | null;
  onActiveTagChange: (tag: string | null) => void;
  colors: Colors;
  placeholder?: string;
}) {
  const s = styles(colors);
  const allTags = collectAllTags(items);

  return (
    <View style={s.filterWrap}>
      <TextInput
        style={s.searchInput}
        value={search}
        onChangeText={onSearchChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />
      {allTags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.chipRow}>
            <TouchableOpacity
              style={[s.filterChip, !activeTag && s.filterChipActive]}
              onPress={() => onActiveTagChange(null)}>
              <Text style={[s.filterChipText, !activeTag && { color: colors.primary }]}>All</Text>
            </TouchableOpacity>
            {allTags.map(tag => {
              const on = activeTag?.toLowerCase() === tag.toLowerCase();
              return (
                <TouchableOpacity key={tag}
                  style={[s.filterChip, on && s.filterChipActive]}
                  onPress={() => onActiveTagChange(on ? null : tag)}>
                  <Text style={[s.filterChipText, on && { color: colors.primary }]}>{tag}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export function TagChipRow({ tags, colors }: { tags?: string[]; colors: Colors }) {
  if (!tags?.length) return null;
  const s = styles(colors);
  return (
    <View style={s.chipRow}>
      {tags.map(tag => (
        <View key={tag} style={s.listChip}>
          <Text style={s.listChipText}>{tag}</Text>
        </View>
      ))}
    </View>
  );
}

export function filterTaggedItems<T extends { name: string; tags?: string[] }>(
  items: T[], search: string, activeTag: string | null,
): T[] {
  return items.filter(item => itemMatchesTagFilter(item, search, activeTag));
}

const styles = (colors: Colors) => StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
  hint: { fontSize: 11, color: colors.textMuted, marginBottom: 6 },
  input: {
    backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    color: colors.textPrimary, padding: 10, fontSize: 14,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    backgroundColor: colors.primaryDim, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.primary,
  },
  chipText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  suggestScroll: { marginTop: 4 },
  suggestChip: {
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  suggestText: { fontSize: 10, color: colors.textSecondary },
  filterWrap: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  searchInput: {
    backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    color: colors.textPrimary, padding: 10, fontSize: 14,
  },
  filterChip: {
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.primaryDim, borderColor: colors.primary },
  filterChipText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  listChip: {
    backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: colors.border,
  },
  listChipText: { fontSize: 10, color: colors.textMuted },
});
