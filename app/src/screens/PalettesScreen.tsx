/**
 * PalettesScreen.tsx
 * Create/edit custom color palettes and organize them into park-specific sets.
 * Sets can be pushed to WLED from the Home screen.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, ScrollView, Alert,
} from 'react-native';
import IconPlus  from '@tabler/icons-react-native/dist/esm/icons/IconPlus';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconPencil from '@tabler/icons-react-native/dist/esm/icons/IconPencil';
import IconCheck from '@tabler/icons-react-native/dist/esm/icons/IconCheck';

import { useAppStore, CustomPalette, PaletteSet } from '../stores/store';
import { useTheme } from '../utils/theme';
import { generateId } from '../utils/utils';

type TabType = 'palettes' | 'sets';

const PRESET_COLORS = [
  '#ff0000','#ff4400','#ff8800','#ffcc00','#ffff00',
  '#88ff00','#00ff00','#00ff88','#00ffff','#0088ff',
  '#0000ff','#8800ff','#ff00ff','#ff0088','#ffffff','#000000',
];

export default function PalettesScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const {
    customPalettes, addCustomPalette, updateCustomPalette, removeCustomPalette,
    paletteSets, addPaletteSet, updatePaletteSet, removePaletteSet,
    saveToStorage,
  } = useAppStore();

  const [tab, setTab]               = useState<TabType>('palettes');
  const [editPalette, setEditPalette] = useState<CustomPalette | null>(null);
  const [editSet, setEditSet]         = useState<PaletteSet | null>(null);
  const [isNew, setIsNew]             = useState(false);

  // ── Palette editing ──

  const newPalette = (): CustomPalette => ({
    id: generateId(), name: '', colors: ['#a78bfa', '#22c55e', '#f59e0b'],
  });

  const openNewPalette = () => { setEditPalette(newPalette()); setIsNew(true); };
  const openEditPalette = (p: CustomPalette) => { setEditPalette({ ...p, colors: [...p.colors] }); setIsNew(false); };

  const savePalette = () => {
    if (!editPalette) return;
    if (!editPalette.name.trim()) { Alert.alert('Name required'); return; }
    if (isNew) addCustomPalette(editPalette);
    else updateCustomPalette(editPalette.id, editPalette);
    saveToStorage();
    setEditPalette(null);
  };

  const deletePalette = (id: string) => {
    Alert.alert('Delete Palette', 'Delete this palette?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        removeCustomPalette(id);
        // Remove from any sets
        paletteSets.forEach(ps => {
          if (ps.paletteIds.includes(id)) {
            updatePaletteSet(ps.id, { paletteIds: ps.paletteIds.filter(pid => pid !== id) });
          }
        });
        saveToStorage();
        setEditPalette(null);
      }},
    ]);
  };

  const addColor = () => {
    if (!editPalette || editPalette.colors.length >= 16) return;
    setEditPalette({ ...editPalette, colors: [...editPalette.colors, '#ffffff'] });
  };

  const removeColor = (i: number) => {
    if (!editPalette || editPalette.colors.length <= 2) return;
    setEditPalette({ ...editPalette, colors: editPalette.colors.filter((_, j) => j !== i) });
  };

  const setColor = (i: number, hex: string) => {
    if (!editPalette) return;
    const c = [...editPalette.colors]; c[i] = hex;
    setEditPalette({ ...editPalette, colors: c });
  };

  // ── Palette set editing ──

  const newSet = (): PaletteSet => ({ id: generateId(), name: '', paletteIds: [] });
  const openNewSet = () => { setEditSet(newSet()); setIsNew(true); };
  const openEditSet = (ps: PaletteSet) => { setEditSet({ ...ps, paletteIds: [...ps.paletteIds] }); setIsNew(false); };

  const saveSet = () => {
    if (!editSet) return;
    if (!editSet.name.trim()) { Alert.alert('Name required'); return; }
    if (editSet.paletteIds.length === 0) { Alert.alert('Add at least one palette'); return; }
    if (isNew) addPaletteSet(editSet);
    else updatePaletteSet(editSet.id, editSet);
    saveToStorage();
    setEditSet(null);
  };

  const togglePaletteInSet = (id: string) => {
    if (!editSet) return;
    const ids = editSet.paletteIds.includes(id)
      ? editSet.paletteIds.filter(p => p !== id)
      : [...editSet.paletteIds, id];
    setEditSet({ ...editSet, paletteIds: ids });
  };

  const movePaletteInSet = (fromIdx: number, toIdx: number) => {
    if (!editSet) return;
    const ids = [...editSet.paletteIds];
    const [item] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, item);
    setEditSet({ ...editSet, paletteIds: ids });
  };

  return (
    <View style={s.container}>
      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['palettes', 'sets'] as TabType[]).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'palettes' ? `Palettes (${customPalettes.length})` : `Sets (${paletteSets.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Palettes tab */}
      {tab === 'palettes' && (
        <FlatList
          data={customPalettes}
          keyExtractor={p => p.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyText}>No custom palettes yet</Text>
              <Text style={s.hint}>Create palettes, then group them into park-specific sets</Text>
            </View>
          }
          ListFooterComponent={
            <TouchableOpacity style={s.addBtn} onPress={openNewPalette}>
              <IconPlus size={16} color={colors.primary} />
              <Text style={s.addBtnText}>New Palette</Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.card} onPress={() => openEditPalette(item)}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{item.name}</Text>
                <View style={s.swatchRow}>
                  {item.colors.map((c, i) => (
                    <View key={i} style={[s.swatch, { backgroundColor: c }]} />
                  ))}
                </View>
              </View>
              <TouchableOpacity onPress={() => openEditPalette(item)} style={s.iconBtn}>
                <IconPencil size={15} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => deletePalette(item.id)} style={s.iconBtn}>
                <IconTrash size={15} color={colors.danger} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Sets tab */}
      {tab === 'sets' && (
        <FlatList
          data={paletteSets}
          keyExtractor={ps => ps.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyText}>No palette sets yet</Text>
              <Text style={s.hint}>Sets let you group palettes for a specific park and push them all to WLED at once from the Home screen</Text>
            </View>
          }
          ListFooterComponent={
            <TouchableOpacity style={s.addBtn} onPress={openNewSet}>
              <IconPlus size={16} color={colors.primary} />
              <Text style={s.addBtnText}>New Set</Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.card} onPress={() => openEditSet(item)}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{item.name}</Text>
                <Text style={s.hint}>{item.paletteIds.length} palette{item.paletteIds.length !== 1 ? 's' : ''}</Text>
                <View style={s.swatchRow}>
                  {item.paletteIds.map(id => {
                    const pal = customPalettes.find(p => p.id === id);
                    return pal?.colors.slice(0, 4).map((c, i) => (
                      <View key={`${id}-${i}`} style={[s.swatch, { backgroundColor: c }]} />
                    ));
                  })}
                </View>
              </View>
              <TouchableOpacity onPress={() => {
                Alert.alert('Delete Set', `Delete "${item.name}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => { removePaletteSet(item.id); saveToStorage(); } },
                ]);
              }} style={s.iconBtn}>
                <IconTrash size={15} color={colors.danger} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Edit palette modal */}
      <Modal visible={!!editPalette} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <ScrollView contentContainerStyle={s.modalContent}>
              <Text style={s.modalTitle}>{isNew ? 'New Palette' : 'Edit Palette'}</Text>

              <Text style={s.fieldLabel}>Name</Text>
              <TextInput style={s.input} value={editPalette?.name ?? ''}
                onChangeText={v => editPalette && setEditPalette({ ...editPalette, name: v })}
                placeholder="e.g. Haunted Mansion" placeholderTextColor={colors.textMuted} />

              <Text style={s.fieldLabel}>Colors ({editPalette?.colors.length ?? 0}/16)</Text>

              {/* Gradient preview */}
              {editPalette && editPalette.colors.length >= 2 && (
                <View style={[s.gradientPreview, {
                  // RN doesn't support multi-stop gradients natively — show swatches instead
                }]}>
                  {editPalette.colors.map((c, i) => (
                    <View key={i} style={{ flex: 1, backgroundColor: c }} />
                  ))}
                </View>
              )}

              <View style={s.colorGrid}>
                {editPalette?.colors.map((c, i) => (
                  <View key={i} style={s.colorCell}>
                    <View style={[s.colorSwatch, { backgroundColor: c }]}>
                      <Text style={s.colorHex}>{c}</Text>
                    </View>
                    {/* Quick color picker — tap preset colors */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                      {PRESET_COLORS.map(pc => (
                        <TouchableOpacity key={pc} onPress={() => setColor(i, pc)}
                          style={[s.presetColor, { backgroundColor: pc }, pc === c && { borderWidth: 2, borderColor: '#fff' }]} />
                      ))}
                    </ScrollView>
                    {(editPalette?.colors.length ?? 0) > 2 && (
                      <TouchableOpacity style={s.removeColorBtn} onPress={() => removeColor(i)}>
                        <Text style={s.removeColorBtnText}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>

              {(editPalette?.colors.length ?? 0) < 16 && (
                <TouchableOpacity style={s.addColorBtn} onPress={addColor}>
                  <IconPlus size={14} color={colors.primary} />
                  <Text style={s.addColorBtnText}>Add Color</Text>
                </TouchableOpacity>
              )}

              <View style={s.modalBtns}>
                {!isNew && (
                  <TouchableOpacity style={[s.btn, { borderColor: colors.danger }]}
                    onPress={() => editPalette && deletePalette(editPalette.id)}>
                    <Text style={[s.btnText, { color: colors.danger }]}>Delete</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={s.btn} onPress={() => setEditPalette(null)}>
                  <Text style={s.btnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={savePalette}>
                  <Text style={[s.btnText, { color: '#fff' }]}>Save</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit set modal */}
      <Modal visible={!!editSet} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <ScrollView contentContainerStyle={s.modalContent}>
              <Text style={s.modalTitle}>{isNew ? 'New Palette Set' : 'Edit Set'}</Text>

              <Text style={s.fieldLabel}>Set Name</Text>
              <TextInput style={s.input} value={editSet?.name ?? ''}
                onChangeText={v => editSet && setEditSet({ ...editSet, name: v })}
                placeholder="e.g. Magic Kingdom" placeholderTextColor={colors.textMuted} />

              <Text style={s.fieldLabel}>Palettes (tap to toggle, up to 8)</Text>
              <Text style={s.hint}>These will be pushed to WLED slots 0-7 when you activate this set</Text>

              {customPalettes.length === 0 && (
                <Text style={[s.hint, { marginTop: 8 }]}>No palettes yet — create some in the Palettes tab first</Text>
              )}

              {customPalettes.map(p => {
                const selected = editSet?.paletteIds.includes(p.id) ?? false;
                const idx = editSet?.paletteIds.indexOf(p.id) ?? -1;
                // WLED v16+ supports 100+ custom palettes - no meaningful limit needed
                const atLimit = false;
                return (
                  <TouchableOpacity key={p.id}
                    style={[s.setPaletteRow, selected && { borderColor: colors.primary, backgroundColor: colors.primaryDim }]}
                    onPress={() => !atLimit && togglePaletteInSet(p.id)}
                    disabled={atLimit}>
                    <View style={s.swatchRow}>
                      {p.colors.slice(0, 6).map((c, i) => <View key={i} style={[s.swatch, { backgroundColor: c }]} />)}
                    </View>
                    <Text style={[s.cardTitle, { flex: 1 }]}>{p.name}</Text>
                    {selected && (
                      <View style={[s.badge, { backgroundColor: colors.primary }]}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>#{idx + 1}</Text>
                      </View>
                    )}
                    {selected && <IconCheck size={16} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}

              {(editSet?.paletteIds.length ?? 0) > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={s.fieldLabel}>Order (slot assignment)</Text>
                  {editSet!.paletteIds.map((id, i) => {
                    const pal = customPalettes.find(p => p.id === id);
                    return (
                      <View key={id} style={s.orderRow}>
                        <Text style={[s.hint, { width: 24 }]}>#{i + 1}</Text>
                        <View style={s.swatchRow}>
                          {pal?.colors.slice(0, 4).map((c, j) => <View key={j} style={[s.swatch, { backgroundColor: c }]} />)}
                        </View>
                        <Text style={{ flex: 1, color: colors.textPrimary, fontSize: 13 }}>{pal?.name}</Text>
                        <TouchableOpacity disabled={i === 0} onPress={() => movePaletteInSet(i, i - 1)}>
                          <Text style={[s.orderBtn, i === 0 && { opacity: 0.3 }]}>▲</Text>
                        </TouchableOpacity>
                        <TouchableOpacity disabled={i === editSet!.paletteIds.length - 1} onPress={() => movePaletteInSet(i, i + 1)}>
                          <Text style={[s.orderBtn, i === editSet!.paletteIds.length - 1 && { opacity: 0.3 }]}>▼</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={s.modalBtns}>
                <TouchableOpacity style={s.btn} onPress={() => setEditSet(null)}>
                  <Text style={s.btnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={saveSet}>
                  <Text style={[s.btnText, { color: '#fff' }]}>Save Set</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:       { flex: 1, backgroundColor: c.background },
  tabBar:          { flexDirection: 'row', backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  tab:             { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:       { borderBottomColor: c.primary },
  tabText:         { color: c.textMuted, fontWeight: '600', fontSize: 14 },
  tabTextActive:   { color: c.primary },
  list:            { padding: 16, gap: 10, paddingBottom: 40 },
  empty:           { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyText:       { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
  hint:            { color: c.textMuted, fontSize: 12, textAlign: 'center' },
  card:            { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, gap: 10 },
  cardTitle:       { color: c.textPrimary, fontSize: 14, fontWeight: '500', marginBottom: 4 },
  swatchRow:       { flexDirection: 'row', gap: 3, flexWrap: 'wrap', marginTop: 4 },
  swatch:          { width: 16, height: 16, borderRadius: 3 },
  iconBtn:         { padding: 6 },
  addBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.primary, borderStyle: 'dashed' },
  addBtnText:      { color: c.primary, fontWeight: '600' },
  overlay:         { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  modal:           { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%', borderWidth: 1, borderColor: c.border },
  modalContent:    { padding: 20, gap: 10 },
  modalTitle:      { color: c.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  fieldLabel:      { color: c.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8 },
  input:           { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 10, fontSize: 15 },
  gradientPreview: { height: 32, borderRadius: 8, flexDirection: 'row', overflow: 'hidden', marginVertical: 8, borderWidth: 1, borderColor: c.border },
  colorGrid:       { gap: 12 },
  colorCell:       { backgroundColor: c.background, borderRadius: 8, padding: 10, gap: 6 },
  colorSwatch:     { height: 40, borderRadius: 6, justifyContent: 'flex-end', padding: 6 },
  colorHex:        { color: '#fff', fontSize: 11, fontFamily: 'monospace', textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 },
  presetColor:     { width: 22, height: 22, borderRadius: 4, marginRight: 4, borderWidth: 1, borderColor: '#ffffff22' },
  removeColorBtn:  { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: c.danger },
  removeColorBtnText: { color: c.danger, fontSize: 11 },
  addColorBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: c.primary, borderStyle: 'dashed', justifyContent: 'center' },
  addColorBtnText: { color: c.primary, fontWeight: '500', fontSize: 13 },
  modalBtns:       { flexDirection: 'row', gap: 8, marginTop: 16 },
  btn:             { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt },
  btnPrimary:      { backgroundColor: c.primary, borderColor: c.primary },
  btnText:         { color: c.textMuted, fontWeight: '600', fontSize: 14 },
  setPaletteRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  badge:           { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  orderRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border },
  orderBtn:        { color: c.textSecondary, fontSize: 16, padding: 4 },
});
