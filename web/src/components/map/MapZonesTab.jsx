import { useState, useEffect, useRef, useMemo } from 'react';
import {
  ActionIcon,
  Box,
  Checkbox,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ParksPanel } from './ParksPanel';
import { Field } from '../shared/Field';
import { Modal, ModalBtns } from '../shared/Modal';
import { SearchableSelect } from '../shared/SearchableSelect';
import { AppButton } from '../shared/styles';
import { groupZonesByPark, parkSelectOptions } from '../../lib/map/themeParks';
import { focusMapOnPolygon, generateId, normalizePolygon, presetSelectOptions } from '../../lib/utils';

export function MapZonesTab({ data, update, mapsReady }) {
  const gmap = useRef(null);
  const mapDiv = useRef(null);
  const zonePoly = useRef([]);
  const pinMarkers = useRef([]);
  const previewPoly = useRef(null);
  const editPinMarkers = useRef([]);
  const editPreviewPoly = useRef(null);

  const [drawMode, setDrawMode] = useState('none');
  const [insertMode, setInsertMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState([]);
  const [editPoints, setEditPoints] = useState([]);
  const [editInsertMode, setEditInsertMode] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPreset, setFormPreset] = useState('');
  const [formParkId, setFormParkId] = useState('');
  const [collapsedParkSections, setCollapsedParkSections] = useState({});
  const [editZone, setEditZone] = useState(null);
  const [editIndoor, setEditIndoor] = useState(null);
  const [mapType, setMapType] = useState('satellite');
  const [locationSearch, setLocationSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [highlightZoneId, setHighlightZoneId] = useState(null);
  const didFitAllRef = useRef(false);

  const presetOptions = useMemo(() => presetSelectOptions(data.presets), [data.presets]);
  const parkOptions = useMemo(() => parkSelectOptions(data.parks), [data.parks]);
  const presetZoneGroups = useMemo(() => groupZonesByPark(data.zones, data.parks), [data.zones, data.parks]);
  const indoorZoneGroups = useMemo(() => groupZonesByPark(data.indoorZones, data.parks), [data.indoorZones, data.parks]);

  const toggleParkSection = (key) => {
    setCollapsedParkSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderZoneRow = (z, colorIndex, isIndoor = false) => {
    const COLORS = ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f97316'];
    const c = isIndoor ? '#60a5fa' : COLORS[colorIndex % COLORS.length];
    const preset = !isIndoor ? data.presets.find(p => p.id === z.presetId) : null;
    const park = z.parkId ? (data.parks || []).find(p => p.id === z.parkId) : null;
    const highlighted = highlightZoneId === z.id;
    return (
      <Paper
        key={z.id}
        onClick={() => flyToZone(z, isIndoor)}
        p="xs"
        radius="md"
        mb={6}
        style={{
          background: highlighted ? 'var(--primary-dim)' : 'var(--surface2)',
          borderLeft: `3px solid ${c}`,
          cursor: 'pointer',
          border: highlighted ? '1px solid var(--primary)' : '1px solid transparent',
        }}
      >
        <Group align="flex-start" gap={6} wrap="nowrap">
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600}>{z.name}</Text>
            {!isIndoor && <Text size="xs" c="dimmed">{preset?.name || 'Boundary only'}</Text>}
            {park && <Text size="xs" c="violet">{park.name}</Text>}
            <Text size="xs" c={z.enabled ? 'green' : 'dimmed'}>{z.enabled ? 'Enabled' : 'Disabled'}</Text>
          </Stack>
          <AppButton
            type="button"
            title="Edit zone"
            variant="default"
            size="compact-xs"
            onClick={e => { e.stopPropagation(); isIndoor ? openIndoorEdit(z) : openZoneEdit(z); }}
            style={{ flexShrink: 0 }}
          >
            ✎
          </AppButton>
        </Group>
      </Paper>
    );
  };

  // Keep refs current to use inside Google Maps callbacks
  const drawModeRef = useRef('none');
  const drawPtsRef = useRef([]);
  drawModeRef.current = drawMode;
  drawPtsRef.current = drawPoints;
  const insertModeRef = useRef(false);
  insertModeRef.current = insertMode;
  const editPtsRef = useRef([]);
  const editInsertModeRef = useRef(false);
  const editingActiveRef = useRef(false);
  editPtsRef.current = editPoints;
  editInsertModeRef.current = editInsertMode;
  editingActiveRef.current = !!(editZone || editIndoor);

  const addDrawPointRef = useRef((lat, lng) => { });
  addDrawPointRef.current = (lat, lng) => {
    if (drawModeRef.current === 'none') return;
    const pts = drawPtsRef.current;
    if (insertModeRef.current && pts.length >= 2) {
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const midLat = (a.lat + b.lat) / 2, midLng = (a.lng + b.lng) / 2;
        const d = Math.pow(lat - midLat, 2) + Math.pow(lng - midLng, 2);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      setDrawPoints(prev => {
        const u = [...prev];
        u.splice(bestIdx + 1, 0, { lat, lng });
        return u;
      });
    } else {
      setDrawPoints(prev => [...prev, { lat, lng }]);
    }
  };

  const openZoneEdit = (zone) => {
    const paths = normalizePolygon(zone.polygon);
    setHighlightZoneId(zone.id);
    setEditZone({ ...zone, polygon: paths });
    setEditIndoor(null);
    setEditPoints(paths.map(p => ({ ...p })));
    setEditInsertMode(false);
    focusMapOnPolygon(gmap, paths);
  };

  const openIndoorEdit = (zone) => {
    const paths = normalizePolygon(zone.polygon);
    setHighlightZoneId(zone.id);
    setEditIndoor({ ...zone, polygon: paths });
    setEditZone(null);
    setEditPoints(paths.map(p => ({ ...p })));
    setEditInsertMode(false);
    focusMapOnPolygon(gmap, paths);
  };

  const closeZoneEdit = () => {
    setEditZone(null);
    setEditIndoor(null);
    setEditPoints([]);
    setEditInsertMode(false);
  };

  // Init map once Google Maps API is available
  useEffect(() => {
    if (!mapsReady || gmap.current || !mapDiv.current) return;
    if (!window.google?.maps) return;

    gmap.current = new google.maps.Map(mapDiv.current, {
      center: { lat: 28.4177, lng: -81.5812 },
      zoom: 15,
      mapTypeId: 'satellite',
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControlOptions: { position: google.maps.ControlPosition.TOP_LEFT },
    });
    setMapReady(true);
    gmap.current.addListener('click', (e) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      if (editingActiveRef.current) {
        const pts = editPtsRef.current;
        if (editInsertModeRef.current && pts.length >= 2) {
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const midLat = (a.lat + b.lat) / 2;
            const midLng = (a.lng + b.lng) / 2;
            const d = Math.pow(lat - midLat, 2) + Math.pow(lng - midLng, 2);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          setEditPoints((prev) => {
            const u = [...prev];
            u.splice(bestIdx + 1, 0, { lat, lng });
            return u;
          });
        } else {
          setEditPoints((prev) => [...prev, { lat, lng }]);
        }
        return;
      }
      if (drawModeRef.current === 'none') return;
      addDrawPointRef.current(lat, lng);
    });
  }, [mapsReady]);

  // Redraw zone polygons
  useEffect(() => {
    if (!gmap.current || !mapReady) return;
    zonePoly.current.forEach(p => p.setMap(null));
    zonePoly.current = [];
    const COLORS = ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#ec4899', '#14b8a6'];
    data.zones.forEach((z, i) => {
      if (editZone?.id === z.id) return;
      const paths = normalizePolygon(z.polygon);
      if (paths.length < 3) return;
      const c = COLORS[i % COLORS.length];
      const highlighted = highlightZoneId === z.id;
      const poly = new google.maps.Polygon({
        paths,
        fillColor: c, fillOpacity: highlighted ? 0.35 : 0.2,
        strokeColor: z.enabled ? c : '#666',
        strokeWeight: highlighted ? 4 : 2,
        map: gmap.current,
        zIndex: highlighted ? 2 : 1,
      });
      poly.addListener('click', (e) => {
        if (drawModeRef.current !== 'none') {
          addDrawPointRef.current(e.latLng.lat(), e.latLng.lng());
          return;
        }
        openZoneEdit({ ...z, polygon: paths });
      });
      zonePoly.current.push(poly);
    });
    data.indoorZones.forEach(z => {
      if (editIndoor?.id === z.id) return;
      const paths = normalizePolygon(z.polygon);
      if (paths.length < 3) return;
      const highlighted = highlightZoneId === z.id;
      const poly = new google.maps.Polygon({
        paths,
        fillColor: '#60a5fa', fillOpacity: highlighted ? 0.28 : 0.15,
        strokeColor: z.enabled ? '#60a5fa' : '#666',
        strokeWeight: highlighted ? 4 : 2,
        map: gmap.current,
        zIndex: highlighted ? 2 : 1,
      });
      poly.addListener('click', (e) => {
        if (drawModeRef.current !== 'none') {
          addDrawPointRef.current(e.latLng.lat(), e.latLng.lng());
          return;
        }
        openIndoorEdit({ ...z, polygon: paths });
      });
      zonePoly.current.push(poly);
    });
  }, [data.zones, data.indoorZones, mapReady, highlightZoneId, editZone?.id, editIndoor?.id]);

  // Fit map to all zones once when map first becomes ready
  useEffect(() => {
    if (!mapReady || !gmap.current || didFitAllRef.current) return;
    const all = [...data.zones, ...data.indoorZones];
    const polys = all.map(z => normalizePolygon(z.polygon)).filter(p => p.length >= 3);
    if (!polys.length) return;
    const bounds = new google.maps.LatLngBounds();
    polys.forEach(poly => poly.forEach(p => bounds.extend(p)));
    gmap.current.fitBounds(bounds, 80);
    didFitAllRef.current = true;
  }, [mapReady, data.zones, data.indoorZones]);

  // Redraw draggable pin markers
  useEffect(() => {
    if (!gmap.current || !mapReady) return;
    pinMarkers.current.forEach(m => m.setMap(null));
    pinMarkers.current = [];
    if (previewPoly.current) { previewPoly.current.setMap(null); previewPoly.current = null; }

    drawPoints.forEach((pt, i) => {
      const isLast = i === drawPoints.length - 1;
      const m = new google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map: gmap.current,
        draggable: true,
        label: { text: String(i + 1), color: '#fff', fontWeight: 'bold', fontSize: '11px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: isLast ? '#22c55e' : '#a78bfa',
          fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 11,
        },
        zIndex: 1000 + i,
        title: `Pin ${i + 1} — drag to move or right-click to delete`,
        cursor: 'move',
      });
      // Drag to move
      m.addListener('dragend', e => {
        const lat = e.latLng.lat(), lng = e.latLng.lng();
        setDrawPoints(prev => { const u = [...prev]; u[i] = { lat, lng }; return u; });
      });
      // Right-click to delete pin
      m.addListener('rightclick', () => {
        setDrawPoints(prev => prev.filter((_, j) => j !== i));
      });
      pinMarkers.current.push(m);
    });

    if (drawPoints.length >= 3) {
      previewPoly.current = new google.maps.Polygon({
        paths: drawPoints.map(p => ({ lat: p.lat, lng: p.lng })),
        fillColor: '#a78bfa', fillOpacity: 0.15,
        strokeColor: '#a78bfa', strokeWeight: 2, strokeDashOffset: 0,
        map: gmap.current,
      });
    }
  }, [drawPoints, mapReady]);

  // Draggable pins while editing an existing zone
  useEffect(() => {
    if (!gmap.current || !mapReady) return;
    editPinMarkers.current.forEach(m => m.setMap(null));
    editPinMarkers.current = [];
    if (editPreviewPoly.current) { editPreviewPoly.current.setMap(null); editPreviewPoly.current = null; }
    if (!editZone && !editIndoor) return;

    const stroke = editZone ? '#a78bfa' : '#60a5fa';
    editPoints.forEach((pt, i) => {
      const m = new google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map: gmap.current,
        draggable: true,
        label: { text: String(i + 1), color: '#fff', fontWeight: 'bold', fontSize: '11px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#f59e0b',
          fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 11,
        },
        zIndex: 2000 + i,
        title: `Pin ${i + 1} — drag to move, right-click to delete`,
        cursor: 'move',
      });
      m.addListener('dragend', e => {
        const lat = e.latLng.lat(), lng = e.latLng.lng();
        setEditPoints(prev => { const u = [...prev]; u[i] = { lat, lng }; return u; });
      });
      m.addListener('rightclick', () => {
        setEditPoints(prev => (prev.length <= 3 ? prev : prev.filter((_, j) => j !== i)));
      });
      editPinMarkers.current.push(m);
    });

    if (editPoints.length >= 3) {
      editPreviewPoly.current = new google.maps.Polygon({
        paths: editPoints.map(p => ({ lat: p.lat, lng: p.lng })),
        fillColor: stroke, fillOpacity: 0.22,
        strokeColor: stroke, strokeWeight: 3,
        map: gmap.current,
        zIndex: 3,
      });
    }
  }, [editPoints, editZone, editIndoor, mapReady]);

  const flyToZone = (zone, isIndoor = false) => {
    setHighlightZoneId(zone.id);
    focusMapOnPolygon(gmap, zone.polygon);
    if (isIndoor) setEditIndoor(null);
    else setEditZone(null);
  };

  const commitZone = () => {
    if (!formName.trim()) return alert('Enter a name');
    if (drawPoints.length < 3) return alert('Draw at least 3 points');
    if (drawMode === 'preset') {
      const zone = { id: generateId(), name: formName, polygon: normalizePolygon(drawPoints), presetId: formPreset || '', enabled: true };
      if (formParkId) zone.parkId = formParkId;
      update({ zones: [...data.zones, zone] });
    } else {
      const zone = { id: generateId(), name: formName, polygon: normalizePolygon(drawPoints), enabled: true };
      if (formParkId) zone.parkId = formParkId;
      update({ indoorZones: [...data.indoorZones, zone] });
    }
    setShowForm(false); setDrawPoints([]); setDrawMode('none'); setFormName(''); setFormPreset(''); setFormParkId('');
  };

  const saveZoneEdit = () => {
    const poly = normalizePolygon(editPoints);
    if (poly.length < 3) return alert('Zone needs at least 3 points');
    if (editZone) update({ zones: data.zones.map(z => z.id === editZone.id ? { ...editZone, polygon: poly } : z) });
    if (editIndoor) update({ indoorZones: data.indoorZones.map(z => z.id === editIndoor.id ? { ...editIndoor, polygon: poly } : z) });
    closeZoneEdit();
  };

  const deleteZoneEdit = () => {
    if (editZone) update({ zones: data.zones.filter(z => z.id !== editZone.id) });
    if (editIndoor) update({ indoorZones: data.indoorZones.filter(z => z.id !== editIndoor.id) });
    closeZoneEdit();
  };

  const searchLocation = async () => {
    if (!locationSearch.trim() || !gmap.current) return;
    setSearching(true);
    try {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: locationSearch }, (results, status) => {
        setSearching(false);
        if (status === 'OK' && results[0]) {
          const loc = results[0].geometry.location;
          gmap.current.setCenter(loc);
          gmap.current.setZoom(17);
          new google.maps.Marker({
            position: loc, map: gmap.current,
            title: results[0].formatted_address,
            icon: { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 6, fillColor: '#f59e0b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          });
        } else {
          alert('Location not found. Try "Magic Kingdom, Orlando" or a full address.');
        }
      });
    } catch (e) { setSearching(false); alert('Search failed'); }
  };

  return (
    <Box style={{ display: 'flex', height: '100%' }}>
      {/* Sidebar */}
      <ScrollArea
        h="100%"
        style={{
          width: editZone || editIndoor ? 280 : 240,
          flexShrink: 0,
          transition: 'width 0.15s ease',
          borderRight: '1px solid var(--border)',
        }}
      >
        <Stack gap="xs" p="sm" bg="var(--surface)" style={{ minHeight: '100%' }}>

          {/* Zone edit — sidebar panel (no modal overlay; map stays interactive) */}
          {(editZone || editIndoor) && (
            <Paper
              p="sm"
              radius="md"
              mb={4}
              style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary)' }}
            >
              <Stack gap="xs">
                <Group justify="space-between" align="center">
                  <Text fw={700} size="sm" c="violet">
                    {editZone ? 'Edit Preset Zone' : 'Edit Indoor Zone'}
                  </Text>
                  <ActionIcon variant="subtle" color="gray" onClick={closeZoneEdit} title="Close" size="sm">
                    ×
                  </ActionIcon>
                </Group>
                <Text size="xs" c="dimmed" lh={1.45}>
                  Drag numbered pins on the map. Click map to add; right-click pin to remove (min 3).
                </Text>
                <Group gap={6} wrap="wrap">
                  {editPoints.length >= 3 && (
                    <AppButton
                      type="button"
                      variant="default"
                      size="compact-xs"
                      onClick={() => setEditInsertMode(v => !v)}
                      style={{
                        borderColor: editInsertMode ? 'var(--warning)' : undefined,
                        color: editInsertMode ? 'var(--warning)' : undefined,
                      }}
                    >
                      {editInsertMode ? '⊕ Insert on edge' : '⊕ Insert between'}
                    </AppButton>
                  )}
                  {editPoints.length > 0 && (
                    <AppButton type="button" variant="default" size="compact-xs" onClick={() => setEditPoints(p => p.slice(0, -1))}>
                      ↩ Undo
                    </AppButton>
                  )}
                  <AppButton type="button" variant="default" size="compact-xs" onClick={() => focusMapOnPolygon(gmap, editPoints)}>
                    Fit map
                  </AppButton>
                  <Text size="xs" c="dimmed" style={{ alignSelf: 'center' }}>
                    {editPoints.length} pin{editPoints.length !== 1 ? 's' : ''}
                  </Text>
                </Group>
                {editZone && (
                  <>
                    <Field label="Name">
                      <TextInput value={editZone.name} onChange={e => setEditZone({ ...editZone, name: e.target.value })} />
                    </Field>
                    <Field label="Preset (optional)">
                      <SearchableSelect value={editZone.presetId || ''} onChange={v => setEditZone({ ...editZone, presetId: v })}
                        placeholder="None — boundary only" allowEmpty={true} maxListHeight={200}
                        options={presetOptions} />
                    </Field>
                    <Text size="xs" c="dimmed" lh={1.4} mt={-4} mb="xs">
                      Boundary-only zones are used for show locations and park grouping — no preset fires on enter.
                    </Text>
                    <Field label="Park">
                      <SearchableSelect value={editZone.parkId || ''} onChange={v => setEditZone({ ...editZone, parkId: v || undefined })}
                        placeholder="Ungrouped" allowEmpty={true} options={parkOptions} />
                    </Field>
                    <Checkbox
                      label="Enabled"
                      size="xs"
                      checked={editZone.enabled}
                      onChange={e => setEditZone({ ...editZone, enabled: e.target.checked })}
                    />
                  </>
                )}
                {editIndoor && (
                  <>
                    <Field label="Name">
                      <TextInput value={editIndoor.name} onChange={e => setEditIndoor({ ...editIndoor, name: e.target.value })} />
                    </Field>
                    <Field label="Park">
                      <SearchableSelect value={editIndoor.parkId || ''} onChange={v => setEditIndoor({ ...editIndoor, parkId: v || undefined })}
                        placeholder="Ungrouped" allowEmpty={true} options={parkOptions} />
                    </Field>
                    <Checkbox
                      label="Enabled"
                      size="xs"
                      checked={editIndoor.enabled}
                      onChange={e => setEditIndoor({ ...editIndoor, enabled: e.target.checked })}
                    />
                  </>
                )}
                <Group gap={6}>
                  <AppButton type="button" variant="danger" size="compact-xs" style={{ flex: 1 }} onClick={deleteZoneEdit}>
                    Delete
                  </AppButton>
                  <AppButton type="button" variant="default" size="compact-xs" style={{ flex: 1 }} onClick={closeZoneEdit}>
                    Cancel
                  </AppButton>
                  <AppButton type="button" variant="primary" size="compact-xs" style={{ flex: 1 }} onClick={saveZoneEdit}>
                    Save
                  </AppButton>
                </Group>
              </Stack>
            </Paper>
          )}

          {/* Location search */}
          <Title order={6} c="dimmed" tt="uppercase" lts={1}>Search Location</Title>
          <Group gap={4} wrap="nowrap">
            <TextInput
              value={locationSearch}
              onChange={e => setLocationSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchLocation()}
              placeholder="e.g. Fantasyland"
              size="xs"
              style={{ flex: 1 }}
            />
            <AppButton variant="primary" size="compact-xs" onClick={searchLocation} disabled={searching}>
              {searching ? '…' : '🔍'}
            </AppButton>
          </Group>

          {/* Draw controls */}
          <Title order={6} c="dimmed" tt="uppercase" lts={1} mt={4}>Draw Zone</Title>
          {drawMode === 'none' ? (
            <>
              <AppButton variant="primary" fullWidth onClick={() => setDrawMode('preset')}>+ Preset Zone</AppButton>
              <AppButton
                variant="default"
                fullWidth
                onClick={() => setDrawMode('indoor')}
                style={{ color: 'var(--indoor)', borderColor: 'var(--indoor)' }}
              >
                + Indoor Zone
              </AppButton>
              <SearchableSelect value={mapType} onChange={v => { setMapType(v); gmap.current?.setMapTypeId(v); }}
                placeholder="Map type" allowEmpty={false}
                options={[
                  { value: 'satellite', label: 'Satellite', searchText: 'satellite' },
                  { value: 'hybrid', label: 'Hybrid', searchText: 'hybrid' },
                  { value: 'roadmap', label: 'Roadmap', searchText: 'roadmap' },
                ]} />
            </>
          ) : (
            <>
              <Text size="xs" c="dimmed" lh={1.5}>
                Click map to place pins.<br />
                <Text span fw={700}>Drag</Text> pins to reposition.<br />
                <Text span fw={700}>Right-click</Text> pin to delete.
              </Text>
              <Text size="xs" c="dimmed">{drawPoints.length} pin{drawPoints.length !== 1 ? 's' : ''} placed</Text>
              {drawPoints.length >= 3 && (
                <AppButton
                  variant="default"
                  fullWidth
                  size="compact-sm"
                  mb={4}
                  onClick={() => setInsertMode(v => !v)}
                  style={{
                    borderColor: insertMode ? 'var(--warning)' : undefined,
                    color: insertMode ? 'var(--warning)' : undefined,
                  }}
                >
                  {insertMode ? '⊕ Insert Mode ON — click to insert' : '⊕ Insert Between Pins'}
                </AppButton>
              )}
              {drawPoints.length > 0 && (
                <AppButton variant="default" fullWidth size="compact-sm" mb={4} onClick={() => setDrawPoints(p => p.slice(0, -1))}>
                  ↩ Undo Last
                </AppButton>
              )}
              {drawPoints.length >= 3 && (
                <AppButton variant="primary" fullWidth size="compact-sm" mb={4} onClick={() => setShowForm(true)}>
                  ✓ Done
                </AppButton>
              )}
              <AppButton variant="danger" fullWidth size="compact-sm" onClick={() => { setDrawMode('none'); setDrawPoints([]); }}>
                ✕ Cancel
              </AppButton>
            </>
          )}

          <ParksPanel parks={data.parks} data={data} update={update} gmap={gmap} />

          {/* Zone list — grouped by park */}
          <Title order={6} c="dimmed" tt="uppercase" lts={1} mt="sm">
            Preset Zones ({data.zones.length})
          </Title>
          {data.zones.length === 0 && <Text size="xs" c="dimmed">None yet</Text>}
          {presetZoneGroups.map(group => {
            if (!group.zones.length) return null;
            const collapsed = collapsedParkSections[`preset-${group.key}`];
            return (
              <Box key={`preset-${group.key}`} mb={6}>
                <AppButton
                  type="button"
                  variant="default"
                  fullWidth
                  size="compact-xs"
                  mb={4}
                  onClick={() => toggleParkSection(`preset-${group.key}`)}
                  styles={{ root: { justifyContent: 'flex-start' } }}
                >
                  {collapsed ? '▸' : '▾'} {group.label} ({group.zones.length})
                </AppButton>
                {!collapsed && group.zones.map((z, i) => renderZoneRow(z, i, false))}
              </Box>
            );
          })}
          <Title order={6} c="dimmed" tt="uppercase" lts={1} mt={4}>
            Indoor Zones ({data.indoorZones.length})
          </Title>
          {data.indoorZones.length === 0 && <Text size="xs" c="dimmed">None yet</Text>}
          {indoorZoneGroups.map(group => {
            if (!group.zones.length) return null;
            const collapsed = collapsedParkSections[`indoor-${group.key}`];
            return (
              <Box key={`indoor-${group.key}`} mb={6}>
                <AppButton
                  type="button"
                  variant="default"
                  fullWidth
                  size="compact-xs"
                  mb={4}
                  onClick={() => toggleParkSection(`indoor-${group.key}`)}
                  styles={{ inner: { justifyContent: 'flex-start' } }}
                >
                  {collapsed ? '▸' : '▾'} {group.label} ({group.zones.length})
                </AppButton>
                {!collapsed && group.zones.map((z, i) => renderZoneRow(z, i, true))}
              </Box>
            );
          })}
        </Stack>
      </ScrollArea>

      {/* Map */}
      <Box style={{ flex: 1, position: 'relative' }}>
        <div ref={mapDiv} id="map-container" style={{ width: '100%', height: '100%' }} />
        {!mapsReady && (
          <Box
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface)',
            }}
          >
            <Text size="sm" c="dimmed" ta="center" px="md">
              Loading Google Maps…
            </Text>
          </Box>
        )}
      </Box>

      {/* Zone save form */}
      {showForm && (
        <Modal title={drawMode === 'preset' ? 'New Preset Zone' : 'New Indoor Zone'} onClose={() => setShowForm(false)}>
          <Field label="Name">
            <TextInput
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder={drawMode === 'preset' ? 'e.g. Fantasyland' : 'e.g. Inside castle'}
              autoFocus
            />
          </Field>
          {drawMode === 'preset' && (
            <Field label="Preset (optional)">
              <SearchableSelect value={formPreset} onChange={setFormPreset} placeholder="None — boundary only"
                allowEmpty={true} maxListHeight={280} options={presetOptions} />
              <Text size="xs" c="dimmed" mt={6} lh={1.4}>
                Leave empty for parade routes / show scoping only — no effect when you enter the zone.
              </Text>
            </Field>
          )}
          <Field label="Park (optional)">
            <SearchableSelect value={formParkId} onChange={setFormParkId} placeholder="Ungrouped" allowEmpty={true} options={parkOptions} />
          </Field>
          <ModalBtns onCancel={() => setShowForm(false)} onSave={commitZone} />
        </Modal>
      )}
    </Box>
  );
}
