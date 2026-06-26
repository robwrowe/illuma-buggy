/**
 * ZonesScreen.tsx
 * Map-based polygon drawing for preset zones and indoor brightness zones.
 * First-entered priority, overlap prevention warnings.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, FlatList, Alert, TextInput, Switch,
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Polygon, Marker, MapPressEvent } from 'react-native-maps';
import { useAppStore, Zone, IndoorZone, LatLng } from '../stores/store';
import { polygonsOverlap, generateId } from '../utils/utils';
import { useTheme } from '../utils/theme';

type DrawMode = 'none' | 'preset' | 'indoor';

const ZONE_COLORS    = ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f97316'];
const INDOOR_COLOR   = '#60a5fa';

export default function ZonesScreen() {
  const {
    zones, indoorZones, presets,
    addZone, updateZone, removeZone,
    addIndoorZone, updateIndoorZone, removeIndoorZone,
    saveToStorage,
  } = useAppStore();

  const mapRef = useRef<MapView>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);

  // Auto-locate on mount
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(coord);
      mapRef.current?.animateToRegion({
        ...coord,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }, 800);
    })();
  }, []);

  // Drawing state
  const [drawMode, setDrawMode]     = useState<DrawMode>('none');
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([]);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [showList, setShowList]     = useState(false);
  const [listMode, setListMode]     = useState<'preset' | 'indoor'>('preset');

  // New zone form
  const [newZoneName,    setNewZoneName]    = useState('');
  const [newZonePreset,  setNewZonePreset]  = useState('');
  const [showZoneForm,   setShowZoneForm]   = useState(false);

  // ── Map tap → add drawing point ──

  const onMapPress = useCallback((e: MapPressEvent) => {
    if (drawMode === 'none') return;
    const coord = e.nativeEvent.coordinate;
    setDrawPoints((prev) => [...prev, coord]);
  }, [drawMode]);

  const undoLastPin = () => {
    setDrawPoints(prev => prev.slice(0, -1));
  };

  const onMarkerDragEnd = (index: number, coord: LatLng) => {
    setDrawPoints(prev => {
      const updated = [...prev];
      updated[index] = coord;
      return updated;
    });
  };

  // ── Finish drawing ──

  const finishDrawing = () => {
    if (drawPoints.length < 3) {
      Alert.alert('Too few points', 'Draw at least 3 points to form a polygon.');
      return;
    }
    setShowZoneForm(true);
  };

  const cancelDrawing = () => {
    setDrawMode('none');
    setDrawPoints([]);
    setShowZoneForm(false);
    setNewZoneName('');
    setNewZonePreset('');
  };

  // ── Save new zone ──

  const savePresetZone = () => {
    if (!newZoneName.trim() || !newZonePreset) {
      Alert.alert('Required', 'Enter a name and select a preset.');
      return;
    }

    // Overlap check
    const overlapping = zones.find((z) => polygonsOverlap(drawPoints, z.polygon));
    if (overlapping) {
      Alert.alert(
        'Overlap Detected',
        `This zone overlaps with "${overlapping.name}". Overlapping zones use first-entered priority. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save Anyway', onPress: () => commitPresetZone() },
        ]
      );
      return;
    }
    commitPresetZone();
  };

  const commitPresetZone = () => {
    const zone: Zone = {
      id:       generateId(),
      name:     newZoneName.trim(),
      polygon:  drawPoints,
      presetId: newZonePreset,
      enabled:  true,
    };
    addZone(zone);
    saveToStorage();
    cancelDrawing();
  };

  const saveIndoorZone = () => {
    if (!newZoneName.trim()) {
      Alert.alert('Required', 'Enter a name for this indoor zone.');
      return;
    }
    const zone: IndoorZone = {
      id:      generateId(),
      name:    newZoneName.trim(),
      polygon: drawPoints,
      enabled: true,
    };
    addIndoorZone(zone);
    saveToStorage();
    cancelDrawing();
  };

  const onSaveZone = drawMode === 'preset' ? savePresetZone : saveIndoorZone;

  // ── Zone list actions ──

  const toggleZone = (id: string, enabled: boolean) => {
    updateZone(id, { enabled });
    saveToStorage();
  };
  const toggleIndoor = (id: string, enabled: boolean) => {
    updateIndoorZone(id, { enabled });
    saveToStorage();
  };
  const deleteZone = (id: string) => { removeZone(id); saveToStorage(); };
  const deleteIndoor = (id: string) => { removeIndoorZone(id); saveToStorage(); };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        onPress={onMapPress}
        showsUserLocation
        showsMyLocationButton
        mapType="satellite"
        scrollEnabled={!isDragging}
        pitchEnabled={!isDragging}
        rotateEnabled={!isDragging}
      >
        {/* Preset zones */}
        {zones.map((zone, i) => (
          <Polygon
            key={zone.id}
            coordinates={zone.polygon}
            fillColor={ZONE_COLORS[i % ZONE_COLORS.length] + '33'}
            strokeColor={zone.enabled ? ZONE_COLORS[i % ZONE_COLORS.length] : '#4a4a6a'}
            strokeWidth={2}
          />
        ))}

        {/* Indoor zones */}
        {indoorZones.map((zone) => (
          <Polygon
            key={zone.id}
            coordinates={zone.polygon}
            fillColor={INDOOR_COLOR + '22'}
            strokeColor={zone.enabled ? INDOOR_COLOR : '#4a4a6a'}
            strokeWidth={2}
            lineDashPattern={[6, 4]}
          />
        ))}

        {/* Drawing points — draggable to move */}
        {drawPoints.map((pt, i) => (
          <Marker
            key={i}
            coordinate={pt}
            pinColor={i === drawPoints.length - 1 ? '#22c55e' : '#a78bfa'}
            draggable
            onDragStart={() => setIsDragging(true)}
            onDragEnd={(e) => {
              setIsDragging(false);
              onMarkerDragEnd(i, e.nativeEvent.coordinate);
            }}
            title={`Pin ${i + 1}`}
          />
        ))}

        {/* Drawing preview polygon */}
        {drawPoints.length >= 3 && (
          <Polygon
            coordinates={drawPoints}
            fillColor="#a78bfa22"
            strokeColor="#a78bfa"
            strokeWidth={2}
          />
        )}
      </MapView>

      {/* Drawing toolbar */}
      {drawMode === 'none' ? (
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.toolBtn} onPress={() => setDrawMode('preset')}>
            <Text style={styles.toolBtnText}>＋ Preset Zone</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, { backgroundColor: '#1a2a3e' }]} onPress={() => setDrawMode('indoor')}>
            <Text style={[styles.toolBtnText, { color: INDOOR_COLOR }]}>＋ Indoor Zone</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.listBtn} onPress={() => { setListMode('preset'); setShowList(true); }}>
            <Text style={styles.listBtnText}>≡</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.toolbar}>
          <Text style={styles.drawHint}>
            {drawMode === 'preset' ? 'Tap to add · drag pins to move' : 'Tap to add · drag pins to move'}
            {drawPoints.length > 0 && ` (${drawPoints.length} pts)`}
          </Text>
          {drawPoints.length > 0 && (
            <TouchableOpacity style={[styles.toolBtn, { backgroundColor: '#1a1a2e' }]} onPress={undoLastPin}>
              <Text style={styles.toolBtnText}>↩ Undo</Text>
            </TouchableOpacity>
          )}
          {drawPoints.length >= 3 && (
            <TouchableOpacity style={styles.toolBtn} onPress={finishDrawing}>
              <Text style={styles.toolBtnText}>✓ Done</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.toolBtn, { backgroundColor: '#2a1a1e' }]} onPress={cancelDrawing}>
            <Text style={[styles.toolBtnText, { color: '#ef4444' }]}>✕ Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Zone save form */}
      <Modal visible={showZoneForm} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {drawMode === 'preset' ? 'New Preset Zone' : 'New Indoor Zone'}
            </Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={newZoneName}
              onChangeText={setNewZoneName}
              placeholder={drawMode === 'preset' ? 'e.g. Fantasyland' : 'e.g. Inside castle'}
              placeholderTextColor="#4a4a6a"
              autoFocus
            />

            {drawMode === 'preset' && (
              <>
                <Text style={styles.fieldLabel}>Preset</Text>
                {presets.length === 0 ? (
                  <Text style={styles.hint}>No presets saved yet. Create one in Presets tab first.</Text>
                ) : (
                  presets.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.presetOption, newZonePreset === p.id && styles.presetOptionActive]}
                      onPress={() => setNewZonePreset(p.id)}
                    >
                      <Text style={[styles.presetOptionText, newZonePreset === p.id && { color: '#a78bfa' }]}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </>
            )}

            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelModalBtn} onPress={cancelDrawing}>
                <Text style={styles.cancelModalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveModalBtn} onPress={onSaveZone}>
                <Text style={styles.saveModalBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Zone list modal */}
      <Modal visible={showList} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { maxHeight: '80%' }]}>
            <View style={styles.modalRow}>
              <TouchableOpacity onPress={() => setListMode('preset')}>
                <Text style={[styles.tabLabel, listMode === 'preset' && styles.tabLabelActive]}>Preset Zones</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setListMode('indoor')}>
                <Text style={[styles.tabLabel, listMode === 'indoor' && styles.tabLabelActive]}>Indoor Zones</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ marginLeft: 'auto' }} onPress={() => setShowList(false)}>
                <Text style={{ color: '#9090b0', fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {listMode === 'preset' ? (
              <FlatList
                data={zones}
                keyExtractor={(z) => z.id}
                ListEmptyComponent={<Text style={styles.hint}>No preset zones yet.</Text>}
                renderItem={({ item: z }) => (
                  <View style={styles.zoneRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.zoneName}>{z.name}</Text>
                      <Text style={styles.hint}>
                        {presets.find((p) => p.id === z.presetId)?.name ?? z.presetId}
                      </Text>
                    </View>
                    <Switch
                      value={z.enabled}
                      onValueChange={(v) => toggleZone(z.id, v)}
                      trackColor={{ false: '#2a2a3e', true: '#a78bfa' }}
                    />
                    <TouchableOpacity onPress={() => { deleteZone(z.id); }}>
                      <Text style={styles.deleteText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            ) : (
              <FlatList
                data={indoorZones}
                keyExtractor={(z) => z.id}
                ListEmptyComponent={<Text style={styles.hint}>No indoor zones yet.</Text>}
                renderItem={({ item: z }) => (
                  <View style={styles.zoneRow}>
                    <Text style={[styles.zoneName, { flex: 1 }]}>{z.name}</Text>
                    <Switch
                      value={z.enabled}
                      onValueChange={(v) => toggleIndoor(z.id, v)}
                      trackColor={{ false: '#2a2a3e', true: INDOOR_COLOR }}
                    />
                    <TouchableOpacity onPress={() => { deleteIndoor(z.id); }}>
                      <Text style={styles.deleteText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  map:       { flex: 1 },

  toolbar: {
    position:        'absolute',
    bottom:          24,
    left:            16,
    right:           16,
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    backgroundColor: '#12121eee',
    borderRadius:    14,
    padding:         10,
    borderWidth:     1,
    borderColor:     '#1a1a2e',
  },
  toolBtn:     { backgroundColor: '#1a1a2e', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  toolBtnText: { color: '#a78bfa', fontWeight: '600', fontSize: 14 },
  listBtn:     { marginLeft: 'auto', backgroundColor: '#1a1a2e', width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listBtnText: { color: '#9090b0', fontSize: 20 },
  drawHint:    { color: '#9090b0', fontSize: 13, flex: 1 },

  modalOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#12121e',
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    padding:         24,
    gap:             12,
    borderWidth:     1,
    borderColor:     '#1a1a2e',
  },
  modalTitle:   { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  modalRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldLabel:   { color: '#9090b0', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    backgroundColor: '#0a0a0f',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     '#2a2a3e',
    color:           '#ffffff',
    padding:         10,
    fontSize:        15,
  },
  hint:        { color: '#4a4a6a', fontSize: 12 },
  presetOption: {
    padding:         10,
    borderRadius:    8,
    backgroundColor: '#0a0a0f',
    borderWidth:     1,
    borderColor:     '#2a2a3e',
  },
  presetOptionActive:  { borderColor: '#a78bfa', backgroundColor: '#a78bfa11' },
  presetOptionText:    { color: '#9090b0', fontSize: 14 },
  cancelModalBtn:      { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#1a1a2e', alignItems: 'center' },
  cancelModalBtnText:  { color: '#9090b0', fontWeight: '600' },
  saveModalBtn:        { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#a78bfa', alignItems: 'center' },
  saveModalBtnText:    { color: '#ffffff', fontWeight: '600' },

  tabLabel:        { color: '#4a4a6a', fontSize: 14, fontWeight: '600', paddingVertical: 4, paddingHorizontal: 8 },
  tabLabelActive:  { color: '#a78bfa', borderBottomWidth: 2, borderBottomColor: '#a78bfa' },
  zoneRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  zoneName:        { color: '#ffffff', fontSize: 14, fontWeight: '500' },
  deleteText:      { color: '#ef4444', fontSize: 16, padding: 4 },
});
