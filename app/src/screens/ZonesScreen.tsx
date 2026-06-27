/**
 * ZonesScreen.tsx
 * Full zone management: draw, edit, view, delete zones.
 * Shows active zones. Pin dragging via long-press selection.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, FlatList, Alert, TextInput, Switch, ScrollView,
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Polygon, Marker, MapPressEvent, Circle } from 'react-native-maps';
import { useAppStore, Zone, IndoorZone, LatLng } from '../stores/store';
import { polygonsOverlap, pointInPolygon, generateId } from '../utils/utils';
import { useTheme } from '../utils/theme';

type DrawMode  = 'none' | 'preset' | 'indoor';
type EditMode  = 'none' | 'zone' | 'indoor';

const ZONE_COLORS  = ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f97316'];
const INDOOR_COLOR = '#60a5fa';

export default function ZonesScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const {
    zones, indoorZones, presets,
    addZone, updateZone, removeZone,
    addIndoorZone, updateIndoorZone, removeIndoorZone,
    saveToStorage,
  } = useAppStore();

  const mapRef = useRef<MapView>(null);

  // Location
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [activeZoneIds, setActiveZoneIds] = useState<string[]>([]);

  // Drawing
  const [drawMode, setDrawMode]   = useState<DrawMode>('none');
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([]);
  const [selectedPinIdx, setSelectedPinIdx] = useState<number | null>(null);

  // Zone form
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [newZoneName, setNewZoneName]   = useState('');
  const [newZonePreset, setNewZonePreset] = useState('');

  // Zone editing
  const [editingZone, setEditingZone]       = useState<Zone | null>(null);
  const [editingIndoor, setEditingIndoor]   = useState<IndoorZone | null>(null);
  const [editMode, setEditMode]             = useState<EditMode>('none');
  const [showEditModal, setShowEditModal]   = useState(false);

  // List modal
  const [showList, setShowList]   = useState(false);
  const [listMode, setListMode]   = useState<'preset' | 'indoor'>('preset');

  // Auto-locate and track active zones
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(coord);
      mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 800);

      // Watch for active zone updates
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 5 },
        (loc) => {
          const pt = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUserLocation(pt);
          const active = zones.filter(z => z.enabled && pointInPolygon(pt, z.polygon)).map(z => z.id);
          setActiveZoneIds(active);
        }
      );
    })();
    return () => { sub?.remove(); };
  }, [zones]);

  // ── Drawing ──

  const onMapPress = useCallback((e: MapPressEvent) => {
    if (drawMode === 'none') return;
    // If a pin is selected, deselect instead of adding new point
    if (selectedPinIdx !== null) { setSelectedPinIdx(null); return; }
    setDrawPoints(prev => [...prev, e.nativeEvent.coordinate]);
  }, [drawMode, selectedPinIdx]);

  const undoLastPin = () => {
    setDrawPoints(prev => prev.slice(0, -1));
    setSelectedPinIdx(null);
  };

  const onPinPress = (i: number) => {
    // Tap pin to select it for moving
    setSelectedPinIdx(selectedPinIdx === i ? null : i);
  };

  // Move selected pin to tapped map location
  const onMapPressForMove = useCallback((e: MapPressEvent) => {
    if (selectedPinIdx !== null) {
      const coord = e.nativeEvent.coordinate;
      setDrawPoints(prev => {
        const updated = [...prev];
        updated[selectedPinIdx] = coord;
        return updated;
      });
      setSelectedPinIdx(null);
      return;
    }
    if (drawMode !== 'none') {
      setDrawPoints(prev => [...prev, e.nativeEvent.coordinate]);
    }
  }, [selectedPinIdx, drawMode]);

  const finishDrawing = () => {
    if (drawPoints.length < 3) { Alert.alert('Too few points', 'Draw at least 3 points.'); return; }
    setShowZoneForm(true);
  };

  const cancelDrawing = () => {
    setDrawMode('none');
    setDrawPoints([]);
    setShowZoneForm(false);
    setSelectedPinIdx(null);
    setNewZoneName('');
    setNewZonePreset('');
  };

  const commitPresetZone = () => {
    if (!newZoneName.trim() || !newZonePreset) { Alert.alert('Required', 'Enter a name and select a preset.'); return; }
    const overlapping = zones.find(z => polygonsOverlap(drawPoints, z.polygon));
    const save = () => {
      addZone({ id: generateId(), name: newZoneName.trim(), polygon: drawPoints, presetId: newZonePreset, enabled: true });
      saveToStorage();
      cancelDrawing();
    };
    if (overlapping) {
      Alert.alert('Overlap Detected', `Overlaps with "${overlapping.name}". Continue?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save Anyway', onPress: save },
      ]);
    } else save();
  };

  const commitIndoorZone = () => {
    if (!newZoneName.trim()) { Alert.alert('Required', 'Enter a name.'); return; }
    addIndoorZone({ id: generateId(), name: newZoneName.trim(), polygon: drawPoints, enabled: true });
    saveToStorage();
    cancelDrawing();
  };

  // ── Zone editing ──

  const openZoneEdit = (z: Zone) => {
    setEditingZone({ ...z, polygon: [...z.polygon] });
    setEditMode('zone');
    setShowEditModal(true);
  };

  const openIndoorEdit = (z: IndoorZone) => {
    setEditingIndoor({ ...z, polygon: [...z.polygon] });
    setEditMode('indoor');
    setShowEditModal(true);
  };

  const saveZoneEdit = () => {
    if (editingZone) { updateZone(editingZone.id, editingZone); saveToStorage(); }
    if (editingIndoor) { updateIndoorZone(editingIndoor.id, editingIndoor); saveToStorage(); }
    setShowEditModal(false);
    setEditingZone(null);
    setEditingIndoor(null);
    setEditMode('none');
  };

  const deleteZone   = (id: string) => { removeZone(id); saveToStorage(); };
  const deleteIndoor = (id: string) => { removeIndoorZone(id); saveToStorage(); };

  const isDrawing = drawMode !== 'none';

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={s.map}
        onPress={isDrawing ? onMapPressForMove : undefined}
        showsUserLocation
        showsMyLocationButton
        mapType="satellite"
      >
        {/* Existing preset zones */}
        {zones.map((zone, i) => {
          const color = ZONE_COLORS[i % ZONE_COLORS.length];
          const isActive = activeZoneIds.includes(zone.id);
          return (
            <Polygon
              key={zone.id}
              coordinates={zone.polygon}
              fillColor={color + (isActive ? '55' : '28')}
              strokeColor={zone.enabled ? color : '#4a4a6a'}
              strokeWidth={isActive ? 3 : 2}
              tappable
              onPress={() => openZoneEdit(zone)}
            />
          );
        })}

        {/* Indoor zones */}
        {indoorZones.map(zone => (
          <Polygon
            key={zone.id}
            coordinates={zone.polygon}
            fillColor={INDOOR_COLOR + '22'}
            strokeColor={zone.enabled ? INDOOR_COLOR : '#4a4a6a'}
            strokeWidth={2}
            lineDashPattern={[6, 4]}
            tappable
            onPress={() => openIndoorEdit(zone)}
          />
        ))}

        {/* Drawing points */}
        {drawPoints.map((pt, i) => {
          const isSelected = selectedPinIdx === i;
          const isLast = i === drawPoints.length - 1;
          return (
            <Marker
              key={`pin-${i}`}
              coordinate={pt}
              pinColor={isSelected ? '#ffffff' : isLast ? '#22c55e' : '#a78bfa'}
              zIndex={isSelected ? 2000 : 1000 + i}
              onPress={() => onPinPress(i)}
              title={isSelected ? 'Tap map to move' : `Pin ${i + 1} — tap to select`}
            />
          );
        })}

        {/* Drawing preview */}
        {drawPoints.length >= 3 && (
          <Polygon
            coordinates={drawPoints}
            fillColor="#a78bfa22"
            strokeColor="#a78bfa"
            strokeWidth={2}
          />
        )}
      </MapView>

      {/* Active zones banner */}
      {activeZoneIds.length > 0 && !isDrawing && (
        <View style={s.activeBanner}>
          <Text style={s.activeBannerTitle}>📍 In zone{activeZoneIds.length > 1 ? 's' : ''}:</Text>
          {activeZoneIds.map(id => {
            const z = zones.find(z => z.id === id);
            const preset = presets.find(p => p.id === z?.presetId);
            return z ? (
              <Text key={id} style={s.activeBannerItem}>
                {z.name}{preset ? ` → ${preset.name}` : ''}
              </Text>
            ) : null;
          })}
        </View>
      )}

      {/* Selected pin hint */}
      {selectedPinIdx !== null && (
        <View style={[s.activeBanner, { backgroundColor: '#ffffff22' }]}>
          <Text style={s.activeBannerTitle}>Pin {selectedPinIdx + 1} selected — tap map to move it</Text>
        </View>
      )}

      {/* Toolbar */}
      {!isDrawing ? (
        <View style={s.toolbar}>
          <TouchableOpacity style={s.toolBtn} onPress={() => setDrawMode('preset')}>
            <Text style={s.toolBtnText}>＋ Preset Zone</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.toolBtn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setDrawMode('indoor')}>
            <Text style={[s.toolBtnText, { color: INDOOR_COLOR }]}>＋ Indoor Zone</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.listBtn} onPress={() => { setListMode('preset'); setShowList(true); }}>
            <Text style={s.listBtnText}>≡</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.toolbar}>
          <Text style={s.drawHint}>
            {selectedPinIdx !== null
              ? `Pin ${selectedPinIdx + 1} selected — tap map to move`
              : `Tap map to add pins (${drawPoints.length} placed)`}
          </Text>
          {drawPoints.length > 0 && (
            <TouchableOpacity style={[s.toolBtn, { backgroundColor: colors.surfaceAlt }]} onPress={undoLastPin}>
              <Text style={s.toolBtnText}>↩</Text>
            </TouchableOpacity>
          )}
          {drawPoints.length >= 3 && (
            <TouchableOpacity style={s.toolBtn} onPress={finishDrawing}>
              <Text style={s.toolBtnText}>✓ Done</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[s.toolBtn, { backgroundColor: colors.danger + '33' }]} onPress={cancelDrawing}>
            <Text style={[s.toolBtnText, { color: colors.danger }]}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Zone save form */}
      <Modal visible={showZoneForm} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{drawMode === 'preset' ? 'New Preset Zone' : 'New Indoor Zone'}</Text>
            <Text style={s.fieldLabel}>Name</Text>
            <TextInput style={s.input} value={newZoneName} onChangeText={setNewZoneName}
              placeholder={drawMode === 'preset' ? 'e.g. Fantasyland' : 'e.g. Inside castle'}
              placeholderTextColor={colors.textMuted} autoFocus />
            {drawMode === 'preset' && (
              <>
                <Text style={s.fieldLabel}>Preset</Text>
                <ScrollView style={{ maxHeight: 180 }}>
                  {presets.length === 0
                    ? <Text style={s.hint}>No presets yet — create one in Library tab first.</Text>
                    : presets.map(p => (
                      <TouchableOpacity key={p.id}
                        style={[s.option, newZonePreset === p.id && s.optionActive]}
                        onPress={() => setNewZonePreset(p.id)}>
                        <Text style={[s.optionText, newZonePreset === p.id && { color: colors.primary }]}>{p.name}</Text>
                      </TouchableOpacity>
                    ))
                  }
                </ScrollView>
              </>
            )}
            <View style={s.modalRow}>
              <TouchableOpacity style={s.cancelBtn} onPress={cancelDrawing}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={drawMode === 'preset' ? commitPresetZone : commitIndoorZone}>
                <Text style={s.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit zone modal */}
      <Modal visible={showEditModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>
              Edit {editMode === 'zone' ? 'Preset' : 'Indoor'} Zone
            </Text>
            {editingZone && (
              <>
                <Text style={s.fieldLabel}>Name</Text>
                <TextInput style={s.input} value={editingZone.name}
                  onChangeText={v => setEditingZone({ ...editingZone, name: v })}
                  placeholderTextColor={colors.textMuted} />
                <Text style={s.fieldLabel}>Preset</Text>
                <ScrollView style={{ maxHeight: 160 }}>
                  {presets.map(p => (
                    <TouchableOpacity key={p.id}
                      style={[s.option, editingZone.presetId === p.id && s.optionActive]}
                      onPress={() => setEditingZone({ ...editingZone, presetId: p.id })}>
                      <Text style={[s.optionText, editingZone.presetId === p.id && { color: colors.primary }]}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={s.row}>
                  <Text style={s.fieldLabel}>Enabled</Text>
                  <Switch value={editingZone.enabled}
                    onValueChange={v => setEditingZone({ ...editingZone, enabled: v })}
                    trackColor={{ false: colors.borderFocus, true: colors.primary }} />
                </View>
              </>
            )}
            {editingIndoor && (
              <>
                <Text style={s.fieldLabel}>Name</Text>
                <TextInput style={s.input} value={editingIndoor.name}
                  onChangeText={v => setEditingIndoor({ ...editingIndoor, name: v })}
                  placeholderTextColor={colors.textMuted} />
                <View style={s.row}>
                  <Text style={s.fieldLabel}>Enabled</Text>
                  <Switch value={editingIndoor.enabled}
                    onValueChange={v => setEditingIndoor({ ...editingIndoor, enabled: v })}
                    trackColor={{ false: colors.borderFocus, true: colors.primary }} />
                </View>
              </>
            )}
            <View style={s.modalRow}>
              <TouchableOpacity style={[s.cancelBtn, { backgroundColor: colors.danger + '22' }]}
                onPress={() => {
                  Alert.alert('Delete Zone', 'Delete this zone?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => {
                      if (editingZone) deleteZone(editingZone.id);
                      if (editingIndoor) deleteIndoor(editingIndoor.id);
                      setShowEditModal(false);
                    }},
                  ]);
                }}>
                <Text style={[s.cancelBtnText, { color: colors.danger }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowEditModal(false)}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={saveZoneEdit}>
                <Text style={s.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Zone list modal */}
      <Modal visible={showList} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modal, { maxHeight: '80%' }]}>
            <View style={s.modalRow}>
              {(['preset', 'indoor'] as const).map(m => (
                <TouchableOpacity key={m} onPress={() => setListMode(m)}>
                  <Text style={[s.tabLabel, listMode === m && s.tabLabelActive]}>
                    {m === 'preset' ? 'Preset Zones' : 'Indoor Zones'}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={{ marginLeft: 'auto' }} onPress={() => setShowList(false)}>
                <Text style={{ color: colors.textMuted, fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={listMode === 'preset' ? zones : indoorZones}
              keyExtractor={z => z.id}
              ListEmptyComponent={<Text style={s.hint}>No zones yet.</Text>}
              renderItem={({ item: z }) => (
                <View style={s.zoneRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.zoneName}>{z.name}</Text>
                    {'presetId' in z && (
                      <Text style={s.hint}>{presets.find(p => p.id === (z as Zone).presetId)?.name ?? 'No preset'}</Text>
                    )}
                  </View>
                  <Switch
                    value={z.enabled}
                    onValueChange={v => listMode === 'preset' ? toggleZone(z.id, v) : toggleIndoor(z.id, v)}
                    trackColor={{ false: colors.borderFocus, true: colors.primary }}
                  />
                  <TouchableOpacity onPress={() => {
                    listMode === 'preset' ? openZoneEdit(z as Zone) : openIndoorEdit(z as IndoorZone);
                    setShowList(false);
                  }}>
                    <Text style={{ color: colors.primary, fontSize: 14, padding: 4 }}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => {
                    Alert.alert('Delete', `Delete "${z.name}"?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => listMode === 'preset' ? deleteZone(z.id) : deleteIndoor(z.id) },
                    ]);
                  }}>
                    <Text style={{ color: colors.danger, fontSize: 16, padding: 4 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );

  function toggleZone(id: string, v: boolean) { updateZone(id, { enabled: v }); saveToStorage(); }
  function toggleIndoor(id: string, v: boolean) { updateIndoorZone(id, { enabled: v }); saveToStorage(); }
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:        { flex: 1, backgroundColor: c.background },
  map:              { flex: 1 },
  toolbar:          { position: 'absolute', bottom: 24, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface + 'ee', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: c.border },
  toolBtn:          { backgroundColor: c.primary + '33', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.primary },
  toolBtnText:      { color: c.primary, fontWeight: '600', fontSize: 13 },
  listBtn:          { marginLeft: 'auto', backgroundColor: c.surfaceAlt, width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listBtnText:      { color: c.textSecondary, fontSize: 20 },
  drawHint:         { color: c.textSecondary, fontSize: 12, flex: 1 },
  activeBanner:     { position: 'absolute', top: 12, left: 16, right: 16, backgroundColor: c.success + '22', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: c.success },
  activeBannerTitle: { color: c.success, fontWeight: '700', fontSize: 13 },
  activeBannerItem: { color: c.textPrimary, fontSize: 12, marginTop: 2 },
  modalOverlay:     { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  modal:            { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, borderWidth: 1, borderColor: c.border },
  modalTitle:       { color: c.textPrimary, fontSize: 17, fontWeight: '600' },
  modalRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel:       { color: c.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  input:            { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 10, fontSize: 15 },
  hint:             { color: c.textMuted, fontSize: 12, padding: 8 },
  option:           { padding: 10, borderRadius: 8, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, marginBottom: 4 },
  optionActive:     { borderColor: c.primary, backgroundColor: c.primaryDim },
  optionText:       { color: c.textSecondary, fontSize: 14 },
  cancelBtn:        { flex: 1, padding: 12, borderRadius: 8, backgroundColor: c.surfaceAlt, alignItems: 'center' },
  cancelBtnText:    { color: c.textMuted, fontWeight: '600' },
  saveBtn:          { flex: 1, padding: 12, borderRadius: 8, backgroundColor: c.primary, alignItems: 'center' },
  saveBtnText:      { color: '#fff', fontWeight: '600' },
  tabLabel:         { color: c.textMuted, fontSize: 14, fontWeight: '600', paddingVertical: 4, paddingHorizontal: 8 },
  tabLabelActive:   { color: c.primary },
  zoneRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  zoneName:         { color: c.textPrimary, fontSize: 14, fontWeight: '500' },
});
