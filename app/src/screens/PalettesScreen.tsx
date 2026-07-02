/**
 * PalettesScreen.tsx — Segment layouts + saved colors (aligned with web Palettes tab).
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, ScrollView, Alert, Switch,
} from 'react-native';
import IconPlus  from '@tabler/icons-react-native/dist/esm/icons/IconPlus';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconPencil from '@tabler/icons-react-native/dist/esm/icons/IconPencil';

import { useAppStore, CustomSegmentLayout, WledSegmentDef, summarizeLayout, buildLayoutPayload, fetchWledSegmentsFromDevice } from '../stores/store';
import { bleService } from '../services/BLEService';
import { useBLE } from '../hooks/useBLE';
import { useTheme } from '../utils/theme';
import { generateId } from '../utils/utils';

type TabType = 'segments' | 'colors';

export default function PalettesScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { isConnected } = useBLE();
  const {
    customSegmentLayouts, addCustomSegmentLayout, updateCustomSegmentLayout, removeCustomSegmentLayout,
    savedColors, addSavedColor, updateSavedColor, removeSavedColor,
    saveToStorage,
  } = useAppStore();

  const [tab, setTab]               = useState<TabType>('segments');
  const [editLayout, setEditLayout]   = useState<CustomSegmentLayout | null>(null);
  const [editColor, setEditColor]     = useState<{ id: string; name: string; hex: string } | null>(null);
  const [capturingLayout, setCapturingLayout] = useState(false);
  const [isNew, setIsNew]             = useState(false);
  const [search, setSearch]           = useState('');

  const filteredColors = useMemo(
    () => savedColors.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.hex.toLowerCase().includes(search.toLowerCase()),
    ),
    [savedColors, search],
  );

  // ── Saved colors ──

  const openNewColor = () => {
    setEditColor({ id: generateId(), name: '', hex: '#ffffff' });
    setIsNew(true);
  };

  const saveColor = () => {
    if (!editColor?.name.trim() || !editColor.hex.match(/^#[0-9a-fA-F]{6}$/)) {
      Alert.alert('Invalid color', 'Name and #RRGGBB hex required.');
      return;
    }
    if (isNew) addSavedColor(editColor);
    else updateSavedColor(editColor.id, editColor);
    saveToStorage();
    setEditColor(null);
  };

  // ── Segment layout editing ──

  const newLayout = (): CustomSegmentLayout => ({
    id: generateId(), name: '', segments: [{ id: 0, start: 0, stop: 100 }], createdAt: Date.now(),
  });

  const openNewLayout = () => { setEditLayout(newLayout()); setIsNew(true); };
  const openEditLayout = (layout: CustomSegmentLayout) => {
    setEditLayout({ ...layout, segments: layout.segments.map(seg => ({ ...seg })) });
    setIsNew(false);
  };

  const saveLayout = () => {
    if (!editLayout) return;
    if (!editLayout.name.trim()) { Alert.alert('Name required'); return; }
    if (editLayout.segments.length === 0) { Alert.alert('Add at least one segment'); return; }
    if (isNew) addCustomSegmentLayout(editLayout);
    else updateCustomSegmentLayout(editLayout.id, editLayout);
    saveToStorage();
    setEditLayout(null);
  };

  const deleteLayout = (id: string) => {
    Alert.alert('Delete Layout', 'Delete this segment layout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        removeCustomSegmentLayout(id);
        saveToStorage();
        setEditLayout(null);
      }},
    ]);
  };

  const updateLayoutSeg = (idx: number, field: keyof WledSegmentDef, val: string) => {
    if (!editLayout) return;
    const n = parseInt(val, 10);
    if (isNaN(n)) return;
    const segments = editLayout.segments.map((seg, i) => i === idx ? { ...seg, [field]: n } : seg);
    setEditLayout({ ...editLayout, segments });
  };

  const updateLayoutSegOptional = (idx: number, field: keyof WledSegmentDef, val: string) => {
    if (!editLayout) return;
    const trimmed = val.trim();
    const segments = editLayout.segments.map((seg, i) => {
      if (i !== idx) return seg;
      if (trimmed === '') {
        const next = { ...seg } as Record<string, unknown>;
        delete next[field];
        return next as WledSegmentDef;
      }
      const n = parseInt(trimmed, 10);
      if (isNaN(n)) return seg;
      return { ...seg, [field]: n };
    });
    setEditLayout({ ...editLayout, segments });
  };

  const updateLayoutSegBool = (idx: number, field: 'rev' | 'mi' | 'on', val: boolean) => {
    if (!editLayout) return;
    const segments = editLayout.segments.map((seg, i) => i === idx ? { ...seg, [field]: val } : seg);
    setEditLayout({ ...editLayout, segments });
  };

  const parseRgb = (raw: string): number[] | null => {
    const parts = raw.split(',').map(p => p.trim());
    if (parts.length !== 3) return null;
    const vals = parts.map(p => parseInt(p, 10));
    if (vals.some(v => Number.isNaN(v))) return null;
    return vals.map(v => Math.max(0, Math.min(255, v)));
  };

  const updateLayoutSegCol = (idx: number, colorIdx: number, val: string) => {
    if (!editLayout) return;
    const rgb = parseRgb(val);
    if (!rgb) return;
    const segments = editLayout.segments.map((seg, i) => {
      if (i !== idx) return seg;
      const col = Array.isArray(seg.col) ? seg.col.map(c => [...c]) : [];
      while (col.length < 3) col.push([0, 0, 0]);
      col[colorIdx] = rgb;
      return { ...seg, col };
    });
    setEditLayout({ ...editLayout, segments });
  };

  const colorString = (seg: WledSegmentDef, colorIdx: number): string => {
    const c = seg.col?.[colorIdx];
    if (!Array.isArray(c) || c.length < 3) return '0,0,0';
    return `${c[0]},${c[1]},${c[2]}`;
  };

  const captureLayoutFromDevice = async () => {
    if (!isConnected) { Alert.alert('Not connected', 'Connect to IllumaBuggy first.'); return; }
    setCapturingLayout(true);
    try {
      const segments = await fetchWledSegmentsFromDevice();
      if (segments.length === 0) {
        Alert.alert('No segments', 'WLED returned no active segments.');
        return;
      }
      if (editLayout) setEditLayout({ ...editLayout, segments });
      else setEditLayout({ ...newLayout(), segments });
    } catch (e) {
      Alert.alert('Capture failed', e instanceof Error ? e.message : 'Could not read WLED state');
    } finally {
      setCapturingLayout(false);
    }
  };

  const applyLayoutToDevice = (layout: CustomSegmentLayout) => {
    if (!isConnected) { Alert.alert('Not connected'); return; }
    bleService.sendWledRaw(buildLayoutPayload(layout));
  };

  return (
    <View style={s.container}>
      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['segments', 'colors'] as TabType[]).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'segments' ? `Segments (${customSegmentLayouts.length})` : `Colors (${savedColors.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'colors' && (
        <>
          <TextInput
            style={s.search}
            placeholder="Search saved colors…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          <FlatList
            data={filteredColors}
            keyExtractor={c => c.id}
            contentContainerStyle={s.list}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyText}>No saved colors yet</Text>
                <Text style={s.hint}>Named hex colors — same as web Palettes → Colors</Text>
              </View>
            }
            ListFooterComponent={
              <TouchableOpacity style={s.addBtn} onPress={openNewColor}>
                <IconPlus size={16} color={colors.primary} />
                <Text style={s.addBtnText}>New Color</Text>
              </TouchableOpacity>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={s.card} onPress={() => { setEditColor({ ...item }); setIsNew(false); }}>
                <View style={[s.swatch, { backgroundColor: item.hex, width: 28, height: 28 }]} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.cardTitle}>{item.name}</Text>
                  <Text style={s.hint}>{item.hex}</Text>
                </View>
                <TouchableOpacity onPress={() => { removeSavedColor(item.id); saveToStorage(); }} style={s.iconBtn}>
                  <IconTrash size={15} color={colors.danger} />
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          />
        </>
      )}

      {tab === 'segments' && (
        <FlatList
          data={customSegmentLayouts}
          keyExtractor={l => l.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyText}>No segment layouts yet</Text>
              <Text style={s.hint}>Save multi-segment WLED layouts and attach them to presets</Text>
            </View>
          }
          ListFooterComponent={
            <TouchableOpacity style={s.addBtn} onPress={openNewLayout}>
              <IconPlus size={16} color={colors.primary} />
              <Text style={s.addBtnText}>New Segment Layout</Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <View style={s.card}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => openEditLayout(item)}>
                <Text style={s.cardTitle}>{item.name}</Text>
                <Text style={s.hint}>{summarizeLayout(item)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => applyLayoutToDevice(item)} style={s.iconBtn} disabled={!isConnected}>
                <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>Apply</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openEditLayout(item)} style={s.iconBtn}>
                <IconPencil size={15} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => deleteLayout(item.id)} style={s.iconBtn}>
                <IconTrash size={15} color={colors.danger} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Edit saved color modal */}
      <Modal visible={!!editColor} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <ScrollView contentContainerStyle={s.modalContent}>
              <Text style={s.modalTitle}>{isNew ? 'New Color' : 'Edit Color'}</Text>
              <Text style={s.fieldLabel}>Name</Text>
              <TextInput style={s.input} value={editColor?.name ?? ''}
                onChangeText={v => editColor && setEditColor({ ...editColor, name: v })}
                placeholder="e.g. Mickey Red" placeholderTextColor={colors.textMuted} />
              <Text style={s.fieldLabel}>Hex</Text>
              <TextInput style={s.input} value={editColor?.hex ?? ''}
                onChangeText={v => editColor && setEditColor({ ...editColor, hex: v })}
                placeholder="#ff0000" placeholderTextColor={colors.textMuted} autoCapitalize="none" />
              <View style={s.modalBtns}>
                <TouchableOpacity style={s.btn} onPress={() => setEditColor(null)}>
                  <Text style={s.btnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={saveColor}>
                  <Text style={[s.btnText, { color: '#fff' }]}>Save</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit segment layout modal */}
      <Modal visible={!!editLayout} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <ScrollView contentContainerStyle={s.modalContent}>
              <Text style={s.modalTitle}>{isNew ? 'New Segment Layout' : 'Edit Segment Layout'}</Text>

              <Text style={s.fieldLabel}>Name</Text>
              <TextInput style={s.input} value={editLayout?.name ?? ''}
                onChangeText={v => editLayout && setEditLayout({ ...editLayout, name: v })}
                placeholder="e.g. Five corners" placeholderTextColor={colors.textMuted} />

              <TouchableOpacity style={[s.addColorBtn, !isConnected && { opacity: 0.5 }]}
                onPress={captureLayoutFromDevice} disabled={!isConnected || capturingLayout}>
                <Text style={s.addColorBtnText}>
                  {capturingLayout ? 'Capturing…' : 'Capture from WLED'}
                </Text>
              </TouchableOpacity>

              <Text style={s.fieldLabel}>Segments</Text>
              {editLayout?.segments.map((seg, idx) => (
                <View key={idx} style={s.segCard}>
                  <View style={s.segHeader}>
                    <Text style={s.segTitle}>Segment {idx + 1}</Text>
                    {editLayout.segments.length > 1 && (
                      <TouchableOpacity onPress={() => setEditLayout({
                        ...editLayout,
                        segments: editLayout.segments.filter((_, i) => i !== idx),
                      })}>
                        <IconTrash size={14} color={colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={s.segRow}>
                    <TextInput style={s.segInput} value={String(seg.id)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSeg(idx, 'id', v)} placeholder="id" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={String(seg.start)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSeg(idx, 'start', v)} placeholder="start" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={String(seg.stop)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSeg(idx, 'stop', v)} placeholder="stop" placeholderTextColor={colors.textMuted} />
                  </View>

                  <View style={s.segRow}>
                    <TextInput style={s.segInput} value={seg.fx === undefined ? '' : String(seg.fx)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'fx', v)} placeholder="fx" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={seg.pal === undefined ? '' : String(seg.pal)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'pal', v)} placeholder="pal" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={seg.bri === undefined ? '' : String(seg.bri)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'bri', v)} placeholder="bri" placeholderTextColor={colors.textMuted} />
                  </View>

                  <View style={s.segRow}>
                    <TextInput style={s.segInput} value={seg.sx === undefined ? '' : String(seg.sx)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'sx', v)} placeholder="speed (sx)" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={seg.ix === undefined ? '' : String(seg.ix)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'ix', v)} placeholder="intensity (ix)" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={seg.of === undefined ? '' : String(seg.of)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'of', v)} placeholder="offset (of)" placeholderTextColor={colors.textMuted} />
                  </View>

                  <View style={s.segRow}>
                    <TextInput style={s.segInput} value={seg.grp === undefined ? '' : String(seg.grp)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'grp', v)} placeholder="grouping (grp)" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={seg.spc === undefined ? '' : String(seg.spc)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'spc', v)} placeholder="spacing (spc)" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={seg.bm === undefined ? '' : String(seg.bm)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'bm', v)} placeholder="blend mode (bm)" placeholderTextColor={colors.textMuted} />
                  </View>

                  <View style={s.segRow}>
                    <TextInput style={s.segInput} value={seg.c1 === undefined ? '' : String(seg.c1)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'c1', v)} placeholder="c1" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={seg.c2 === undefined ? '' : String(seg.c2)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'c2', v)} placeholder="c2" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={seg.c3 === undefined ? '' : String(seg.c3)} keyboardType="number-pad"
                      onChangeText={v => updateLayoutSegOptional(idx, 'c3', v)} placeholder="c3" placeholderTextColor={colors.textMuted} />
                  </View>

                  <View style={s.segRow}>
                    <TextInput style={s.segInput} value={colorString(seg, 0)}
                      onChangeText={v => updateLayoutSegCol(idx, 0, v)} placeholder="col1 r,g,b" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={colorString(seg, 1)}
                      onChangeText={v => updateLayoutSegCol(idx, 1, v)} placeholder="col2 r,g,b" placeholderTextColor={colors.textMuted} />
                    <TextInput style={s.segInput} value={colorString(seg, 2)}
                      onChangeText={v => updateLayoutSegCol(idx, 2, v)} placeholder="col3 r,g,b" placeholderTextColor={colors.textMuted} />
                  </View>

                  <View style={s.segSwitchRow}>
                    <View style={s.segSwitchItem}>
                      <Text style={s.switchLabel}>Reverse</Text>
                      <Switch
                        value={!!seg.rev}
                        onValueChange={v => updateLayoutSegBool(idx, 'rev', v)}
                        trackColor={{ false: colors.borderFocus, true: colors.primary }}
                      />
                    </View>
                    <View style={s.segSwitchItem}>
                      <Text style={s.switchLabel}>Mirror</Text>
                      <Switch
                        value={!!seg.mi}
                        onValueChange={v => updateLayoutSegBool(idx, 'mi', v)}
                        trackColor={{ false: colors.borderFocus, true: colors.primary }}
                      />
                    </View>
                    <View style={s.segSwitchItem}>
                      <Text style={s.switchLabel}>On</Text>
                      <Switch
                        value={seg.on ?? true}
                        onValueChange={v => updateLayoutSegBool(idx, 'on', v)}
                        trackColor={{ false: colors.borderFocus, true: colors.primary }}
                      />
                    </View>
                  </View>
                </View>
              ))}

              <TouchableOpacity style={s.addColorBtn} onPress={() => editLayout && setEditLayout({
                ...editLayout,
                segments: [...editLayout.segments, {
                  id: editLayout.segments.length,
                  start: editLayout.segments[editLayout.segments.length - 1]?.stop ?? 0,
                  stop: 100,
                }],
              })}>
                <IconPlus size={14} color={colors.primary} />
                <Text style={s.addColorBtnText}>Add segment</Text>
              </TouchableOpacity>

              <View style={s.modalBtns}>
                {!isNew && editLayout && (
                  <TouchableOpacity style={[s.btn, { borderColor: colors.danger }]}
                    onPress={() => deleteLayout(editLayout.id)}>
                    <Text style={[s.btnText, { color: colors.danger }]}>Delete</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={s.btn} onPress={() => setEditLayout(null)}>
                  <Text style={s.btnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={saveLayout}>
                  <Text style={[s.btnText, { color: '#fff' }]}>Save</Text>
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
  search:          { margin: 12, backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border, color: c.textPrimary, padding: 10, fontSize: 14 },
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
  segCard:         { backgroundColor: c.background, borderRadius: 10, padding: 10, gap: 8, borderWidth: 1, borderColor: c.border },
  segHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  segTitle:        { color: c.textPrimary, fontSize: 13, fontWeight: '600' },
  segRow:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  segInput:        { flex: 1, backgroundColor: c.background, borderRadius: 6, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 8, fontSize: 12, textAlign: 'right' as const },
  segSwitchRow:    { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  segSwitchItem:   { flex: 1, alignItems: 'center', gap: 4, backgroundColor: c.surface, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: c.border },
  switchLabel:     { color: c.textSecondary, fontSize: 12, fontWeight: '500' },
});
