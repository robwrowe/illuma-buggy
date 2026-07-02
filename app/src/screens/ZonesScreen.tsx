/**
 * ZonesScreen.tsx
 * Map zone management. Fixes:
 * - Pin selection/movement uses refs to avoid stale closures
 * - Active zone detection uses zonesRef to catch newly added zones
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, FlatList, Alert, TextInput, Switch, ScrollView,
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Polygon, Marker, MapPressEvent } from 'react-native-maps';
import { useAppStore, Zone, IndoorZone, LatLng } from '../stores/store';
import { polygonsOverlap, generateId } from '../utils/utils';
import { useTheme } from '../utils/theme';

type DrawMode = 'none' | 'preset' | 'indoor';

const ZONE_COLORS  = ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f97316'];
const INDOOR_COLOR = '#60a5fa';

export default function ZonesScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const {
    zones, indoorZones, presets, parks, activeZoneIds,
    addZone, updateZone, removeZone,
    addIndoorZone, updateIndoorZone, removeIndoorZone,
    saveToStorage,
  } = useAppStore();

  const mapRef = useRef<MapView>(null);

  // Drawing state
  const [drawMode, setDrawMode]       = useState<DrawMode>('none');
  const [drawPoints, setDrawPoints]   = useState<LatLng[]>([]);
  const [selectedPinIdx, setSelectedPinIdx] = useState<number | null>(null);
  const [insertMode, setInsertMode]   = useState(false); // tap polygon edge to insert pin

  // Refs for use inside map callbacks (avoids stale closures)
  const drawModeRef       = useRef<DrawMode>('none');
  const selectedPinRef    = useRef<number | null>(null);
  const drawPointsRef     = useRef<LatLng[]>([]);
  const insertModeRef     = useRef(false);
  const zonesRef          = useRef<Zone[]>(zones);

  drawModeRef.current    = drawMode;
  selectedPinRef.current = selectedPinIdx;
  drawPointsRef.current  = drawPoints;
  insertModeRef.current  = insertMode;
  zonesRef.current       = zones;

  // Zone form
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [newZoneName, setNewZoneName]   = useState('');
  const [newZonePreset, setNewZonePreset] = useState('');

  // Zone editing
  const [editingZone, setEditingZone]     = useState<Zone | null>(null);
  const [editingIndoor, setEditingIndoor] = useState<IndoorZone | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // List
  const [showList, setShowList] = useState(false);
  const [listMode, setListMode] = useState<'preset' | 'indoor'>('preset');

  // ── Center map on user once (GPS watch lives in useZoneManager) ──
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 800);
    })();
  }, []);

  // ── Map press — unified handler using refs ──
  const addDrawPointAt = useCallback((coord: LatLng) => {
    if (drawModeRef.current === 'none') return;
    if (insertModeRef.current && drawPointsRef.current.length >= 2) {
      const pts = drawPointsRef.current;
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const midLat = (a.latitude + b.latitude) / 2;
        const midLng = (a.longitude + b.longitude) / 2;
        const d = Math.pow(coord.latitude - midLat, 2) + Math.pow(coord.longitude - midLng, 2);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      setDrawPoints(prev => {
        const updated = [...prev];
        updated.splice(bestIdx + 1, 0, coord);
        return updated;
      });
    } else {
      setDrawPoints(prev => [...prev, coord]);
    }
  }, []);

  const onMapPress = useCallback((e: MapPressEvent) => {
    if (!e?.nativeEvent?.coordinate) return;
    const coord = e.nativeEvent.coordinate;

    // If a pin is selected, move it there
    if (selectedPinRef.current !== null) {
      const idx = selectedPinRef.current;
      setDrawPoints(prev => {
        const updated = [...prev];
        updated[idx] = coord;
        return updated;
      });
      setSelectedPinIdx(null);
      return;
    }

    addDrawPointAt(coord);
  }, [addDrawPointAt]); // empty deps — reads everything from refs

  const onPinPress = (i: number) => {
    setSelectedPinIdx(prev => prev === i ? null : i);
  };

  // Find which segment of the polygon the tap is closest to,
  // then insert a new point between those two vertices.
  const insertPinOnEdge = (tapCoord: LatLng) => {
    if (drawPoints.length < 2) return;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < drawPoints.length; i++) {
      const a = drawPoints[i];
      const b = drawPoints[(i + 1) % drawPoints.length];
      // Midpoint distance as a proxy for "closest segment"
      const midLat = (a.latitude + b.latitude) / 2;
      const midLng = (a.longitude + b.longitude) / 2;
      const dLat = tapCoord.latitude - midLat;
      const dLng = tapCoord.longitude - midLng;
      const dist = dLat * dLat + dLng * dLng;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    // Insert after bestIdx
    setDrawPoints(prev => {
      const updated = [...prev];
      updated.splice(bestIdx + 1, 0, tapCoord);
      return updated;
    });
  };

  const undoLastPin = () => {
    setDrawPoints(prev => prev.slice(0, -1));
    setSelectedPinIdx(null);
  };

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
    if (!newZoneName.trim()) { Alert.alert('Required', 'Enter a zone name.'); return; }
    const overlapping = zones.find(z => polygonsOverlap(drawPoints, z.polygon));
    const save = () => {
      addZone({
        id: generateId(),
        name: newZoneName.trim(),
        polygon: drawPoints,
        presetId: newZonePreset,
        enabled: true,
      });
      saveToStorage();
      cancelDrawing();
    };
    if (overlapping) {
      Alert.alert('Overlap', `Overlaps with "${overlapping.name}". Continue?`, [
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

  const openZoneEdit = (z: Zone) => {
    setEditingZone({ ...z }); setEditingIndoor(null); setShowEditModal(true);
  };
  const openIndoorEdit = (z: IndoorZone) => {
    setEditingIndoor({ ...z }); setEditingZone(null); setShowEditModal(true);
  };

  const saveEdit = () => {
    if (editingZone) { updateZone(editingZone.id, editingZone); saveToStorage(); }
    if (editingIndoor) { updateIndoorZone(editingIndoor.id, editingIndoor); saveToStorage(); }
    setShowEditModal(false); setEditingZone(null); setEditingIndoor(null);
  };

  const deleteEdit = () => {
    if (editingZone) { removeZone(editingZone.id); saveToStorage(); }
    if (editingIndoor) { removeIndoorZone(editingIndoor.id); saveToStorage(); }
    setShowEditModal(false); setEditingZone(null); setEditingIndoor(null);
  };

  const isDrawing = drawMode !== 'none';

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={s.map}
        onPress={onMapPress}
        showsUserLocation
        showsMyLocationButton
        mapType="satellite"
      >
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
              onPress={(e) => {
                if (drawModeRef.current !== 'none') {
                  if (e?.nativeEvent?.coordinate) addDrawPointAt(e.nativeEvent.coordinate);
                  return;
                }
                openZoneEdit(zone);
              }}
            />
          );
        })}

        {indoorZones.map(zone => (
          <Polygon
            key={zone.id}
            coordinates={zone.polygon}
            fillColor={INDOOR_COLOR + '22'}
            strokeColor={zone.enabled ? INDOOR_COLOR : '#4a4a6a'}
            strokeWidth={2}
            lineDashPattern={[6, 4]}
            tappable
            onPress={(e) => {
              if (drawModeRef.current !== 'none') {
                if (e?.nativeEvent?.coordinate) addDrawPointAt(e.nativeEvent.coordinate);
                return;
              }
              openIndoorEdit(zone);
            }}
          />
        ))}

        {/* Drawing pins — tap to select, then tap map to move */}
        {drawPoints.map((pt, i) => {
          const isSelected = selectedPinIdx === i;
          const isLast = i === drawPoints.length - 1;
          return (
            <Marker
              key={`pin-${i}`}
              coordinate={pt}
              pinColor={isSelected ? '#ffffff' : isLast ? '#22c55e' : '#a78bfa'}
              zIndex={isSelected ? 2000 : 1000 + i}
              onPress={(e) => {
                e.stopPropagation();
                onPinPress(i);
              }}
            />
          );
        })}

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
            return z ? <Text key={id} style={s.activeBannerItem}>{z.name}{preset ? ` → ${preset.name}` : ''}</Text> : null;
          })}
        </View>
      )}

      {/* Pin selection hint */}
      {selectedPinIdx !== null && (
        <View style={s.pinHint}>
          <Text style={s.pinHintText}>Pin {selectedPinIdx + 1} selected — tap anywhere on map to move it</Text>
        </View>
      )}

      {/* Toolbar */}
      {!isDrawing ? (
        <View style={s.toolbar}>
          <TouchableOpacity style={s.toolBtn} onPress={() => setDrawMode('preset')}>
            <Text style={s.toolBtnText}>＋ Preset Zone</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.toolBtn, { borderColor: INDOOR_COLOR }]} onPress={() => setDrawMode('indoor')}>
            <Text style={[s.toolBtnText, { color: INDOOR_COLOR }]}>＋ Indoor Zone</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.listBtn} onPress={() => { setListMode('preset'); setShowList(true); }}>
            <Text style={s.listBtnText}>≡</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.toolbar}>
          <View style={{ flex: 1 }}>
            <Text style={s.drawHint}>
              {selectedPinIdx !== null
                ? `Pin ${selectedPinIdx + 1} selected → tap map to move`
                : insertMode
                ? `Insert mode — tap map to add pin between nearest pins`
                : `Tap map to add pins (${drawPoints.length})`}
            </Text>
            {selectedPinIdx !== null && (
              <Text style={[s.drawHint, { fontSize: 10, opacity: 0.7 }]}>Tap pin again to deselect</Text>
            )}
          </View>
          {drawPoints.length >= 3 && (
            <TouchableOpacity
              style={[s.toolBtn, { paddingHorizontal: 10 }, insertMode && { backgroundColor: colors.warning + '33', borderColor: colors.warning }]}
              onPress={() => setInsertMode(v => !v)}>
              <Text style={[s.toolBtnText, insertMode && { color: colors.warning }]}>⊕</Text>
            </TouchableOpacity>
          )}
          {drawPoints.length > 0 && (
            <TouchableOpacity style={[s.toolBtn, { paddingHorizontal: 10 }]} onPress={undoLastPin}>
              <Text style={s.toolBtnText}>↩</Text>
            </TouchableOpacity>
          )}
          {drawPoints.length >= 3 && (
            <TouchableOpacity style={s.toolBtn} onPress={finishDrawing}>
              <Text style={s.toolBtnText}>✓ Done</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[s.toolBtn, { borderColor: colors.danger }]} onPress={cancelDrawing}>
            <Text style={[s.toolBtnText, { color: colors.danger }]}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Zone save form */}
      <Modal visible={showZoneForm} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{drawMode === 'preset' ? 'New Preset Zone' : 'New Indoor Zone'}</Text>
            <Text style={s.fieldLabel}>Name</Text>
            <TextInput style={s.input} value={newZoneName} onChangeText={setNewZoneName}
              placeholder={drawMode === 'preset' ? 'e.g. Fantasyland' : 'e.g. Inside castle'}
              placeholderTextColor={colors.textMuted} autoFocus />
            {drawMode === 'preset' && (
              <>
                <Text style={s.fieldLabel}>Preset (optional)</Text>
                <Text style={s.hint}>Leave as boundary only for show locations or park grouping — no effect on enter.</Text>
                <ScrollView style={{ maxHeight: 160 }}>
                  <TouchableOpacity
                    style={[s.option, !newZonePreset && s.optionActive]}
                    onPress={() => setNewZonePreset('')}>
                    <Text style={[s.optionText, !newZonePreset && { color: colors.primary }]}>
                      None — boundary only
                    </Text>
                  </TouchableOpacity>
                  {presets.map(p => (
                    <TouchableOpacity key={p.id}
                      style={[s.option, newZonePreset === p.id && s.optionActive]}
                      onPress={() => setNewZonePreset(p.id)}>
                      <Text style={[s.optionText, newZonePreset === p.id && { color: colors.primary }]}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
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

      {/* Edit modal */}
      <Modal visible={showEditModal} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Edit {editingZone ? 'Preset Zone' : 'Indoor Zone'}</Text>
            {editingZone && (
              <>
                <Text style={s.fieldLabel}>Name</Text>
                <TextInput style={s.input} value={editingZone.name}
                  onChangeText={v => setEditingZone({ ...editingZone, name: v })}
                  placeholderTextColor={colors.textMuted} />
                <Text style={s.fieldLabel}>Preset (optional)</Text>
                <ScrollView style={{ maxHeight: 160 }}>
                  <TouchableOpacity
                    style={[s.option, !editingZone.presetId && s.optionActive]}
                    onPress={() => setEditingZone({ ...editingZone, presetId: '' })}>
                    <Text style={[s.optionText, !editingZone.presetId && { color: colors.primary }]}>
                      None — boundary only
                    </Text>
                  </TouchableOpacity>
                  {presets.map(p => (
                    <TouchableOpacity key={p.id}
                      style={[s.option, editingZone.presetId === p.id && s.optionActive]}
                      onPress={() => setEditingZone({ ...editingZone, presetId: p.id })}>
                      <Text style={[s.optionText, editingZone.presetId === p.id && { color: colors.primary }]}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={s.switchRow}>
                  <Text style={s.fieldLabel}>Enabled</Text>
                  <Switch value={editingZone.enabled}
                    onValueChange={v => setEditingZone({ ...editingZone, enabled: v })}
                    trackColor={{ false: colors.borderFocus, true: colors.primary }} />
                </View>
                {parks.length > 0 && (
                  <>
                    <Text style={s.fieldLabel}>Park</Text>
                    <ScrollView style={{ maxHeight: 120 }}>
                      <TouchableOpacity
                        style={[s.option, !editingZone.parkId && s.optionActive]}
                        onPress={() => setEditingZone({ ...editingZone, parkId: undefined })}>
                        <Text style={[s.optionText, !editingZone.parkId && { color: colors.primary }]}>Ungrouped</Text>
                      </TouchableOpacity>
                      {parks.map(p => (
                        <TouchableOpacity key={p.id}
                          style={[s.option, editingZone.parkId === p.id && s.optionActive]}
                          onPress={() => setEditingZone({ ...editingZone, parkId: p.id })}>
                          <Text style={[s.optionText, editingZone.parkId === p.id && { color: colors.primary }]}>{p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}
              </>
            )}
            {editingIndoor && (
              <>
                <Text style={s.fieldLabel}>Name</Text>
                <TextInput style={s.input} value={editingIndoor.name}
                  onChangeText={v => setEditingIndoor({ ...editingIndoor, name: v })}
                  placeholderTextColor={colors.textMuted} />
                <View style={s.switchRow}>
                  <Text style={s.fieldLabel}>Enabled</Text>
                  <Switch value={editingIndoor.enabled}
                    onValueChange={v => setEditingIndoor({ ...editingIndoor, enabled: v })}
                    trackColor={{ false: colors.borderFocus, true: colors.primary }} />
                </View>
                {parks.length > 0 && (
                  <>
                    <Text style={s.fieldLabel}>Park</Text>
                    <ScrollView style={{ maxHeight: 120 }}>
                      <TouchableOpacity
                        style={[s.option, !editingIndoor.parkId && s.optionActive]}
                        onPress={() => setEditingIndoor({ ...editingIndoor, parkId: undefined })}>
                        <Text style={[s.optionText, !editingIndoor.parkId && { color: colors.primary }]}>Ungrouped</Text>
                      </TouchableOpacity>
                      {parks.map(p => (
                        <TouchableOpacity key={p.id}
                          style={[s.option, editingIndoor.parkId === p.id && s.optionActive]}
                          onPress={() => setEditingIndoor({ ...editingIndoor, parkId: p.id })}>
                          <Text style={[s.optionText, editingIndoor.parkId === p.id && { color: colors.primary }]}>{p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}
              </>
            )}
            <View style={s.modalRow}>
              <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.danger }]}
                onPress={() => Alert.alert('Delete', 'Delete this zone?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: deleteEdit },
                ])}>
                <Text style={[s.cancelBtnText, { color: colors.danger }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowEditModal(false)}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={saveEdit}>
                <Text style={s.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Zone list modal */}
      <Modal visible={showList} transparent animationType="slide">
        <View style={s.overlay}>
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
                <Text style={{ color: colors.textMuted, fontSize: 20 }}>✕</Text>
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
                      <Text style={s.hint}>
                        {(z as Zone).presetId
                          ? (presets.find(p => p.id === (z as Zone).presetId)?.name ?? 'Preset missing')
                          : 'Boundary only'}
                      </Text>
                    )}
                    {activeZoneIds.includes(z.id) && <Text style={{ color: colors.success, fontSize: 11 }}>● Currently inside</Text>}
                  </View>
                  <Switch
                    value={z.enabled}
                    onValueChange={v => {
                      listMode === 'preset' ? updateZone(z.id, { enabled: v }) : updateIndoorZone(z.id, { enabled: v });
                      saveToStorage();
                    }}
                    trackColor={{ false: colors.borderFocus, true: colors.primary }}
                  />
                  <TouchableOpacity onPress={() => {
                    listMode === 'preset' ? openZoneEdit(z as Zone) : openIndoorEdit(z as IndoorZone);
                    setShowList(false);
                  }}>
                    <Text style={{ color: colors.primary, fontSize: 14, padding: 6 }}>Edit</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:        { flex: 1, backgroundColor: c.background },
  map:              { flex: 1 },
  toolbar:          { position: 'absolute', bottom: 24, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface + 'ee', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: c.border },
  toolBtn:          { backgroundColor: c.primary + '22', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.primary },
  toolBtnText:      { color: c.primary, fontWeight: '600', fontSize: 13 },
  listBtn:          { marginLeft: 'auto', backgroundColor: c.surfaceAlt, width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listBtnText:      { color: c.textSecondary, fontSize: 20 },
  drawHint:         { color: c.textSecondary, fontSize: 12, flex: 1 },
  activeBanner:     { position: 'absolute', top: 12, left: 16, right: 16, backgroundColor: c.success + '22', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: c.success },
  activeBannerTitle: { color: c.success, fontWeight: '700', fontSize: 13 },
  activeBannerItem: { color: c.textPrimary, fontSize: 12, marginTop: 2 },
  pinHint:          { position: 'absolute', top: 12, left: 16, right: 16, backgroundColor: '#ffffff22', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#ffffff44' },
  pinHintText:      { color: c.textPrimary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  overlay:          { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  modal:            { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, borderWidth: 1, borderColor: c.border },
  modalTitle:       { color: c.textPrimary, fontSize: 17, fontWeight: '600' },
  modalRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel:       { color: c.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  input:            { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 10, fontSize: 15 },
  hint:             { color: c.textMuted, fontSize: 12, padding: 4 },
  option:           { padding: 10, borderRadius: 8, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, marginBottom: 4 },
  optionActive:     { borderColor: c.primary, backgroundColor: c.primaryDim },
  optionText:       { color: c.textSecondary, fontSize: 14 },
  cancelBtn:        { flex: 1, padding: 11, borderRadius: 8, backgroundColor: c.surfaceAlt, alignItems: 'center', borderWidth: 1, borderColor: c.border },
  cancelBtnText:    { color: c.textMuted, fontWeight: '600' },
  saveBtn:          { flex: 1, padding: 11, borderRadius: 8, backgroundColor: c.primary, alignItems: 'center' },
  saveBtnText:      { color: '#fff', fontWeight: '600' },
  tabLabel:         { color: c.textMuted, fontSize: 14, fontWeight: '600', paddingVertical: 4, paddingHorizontal: 8 },
  tabLabelActive:   { color: c.primary },
  zoneRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  zoneName:         { color: c.textPrimary, fontSize: 14, fontWeight: '500' },
});
