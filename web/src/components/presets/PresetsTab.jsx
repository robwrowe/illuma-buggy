import { useMemo, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { normalizePreset } from '../../lib/ble/mbMapping';
import { duplicateTaggedName, itemMatchesTagFilter } from '../../lib/tags';
import {
  DEFAULT_WLED_CAPTURE_OPTS,
  applyWledStateCapture,
  fetchWledFullStateFromIp,
} from '../../lib/wled/capture';
import { fetchWledCatalog } from '../../lib/wled/catalog';
import { MasterDetail } from '../shared/MasterDetail';
import { PresetCaptureModal } from './PresetCaptureModal';
import { PresetEditor } from './PresetEditor';
import { PresetListPanel } from './PresetListPanel';
import { PresetMapEditorModal } from './PresetMapEditorModal';
import { blankPreset, duplicatePresetRecord } from './presetModel';
import { usePresetWled } from './usePresetWled';

export function PresetsTab({ data, update, onOpenShotBox }) {
  const [sel, setSel] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [ptab, setPtab] = useState('effect');
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [showCapture, setShowCapture] = useState(false);
  const [captureOpts, setCaptureOpts] = useState(() => ({ ...DEFAULT_WLED_CAPTURE_OPTS }));
  const [captureUpdateMemory, setCaptureUpdateMemory] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [captureErr, setCaptureErr] = useState('');
  const [showMapEditor, setShowMapEditor] = useState(false);

  const segmentMaps = data.mbMapping?.segmentMaps || [];
  const mb = data.mbMapping;

  const filteredPresets = useMemo(
    () => (data.presets || []).filter((p) => itemMatchesTagFilter(p, search, activeTag)),
    [data.presets, search, activeTag],
  );

  const wled = usePresetWled(data, sel);

  const setGlobal = (k, v) => setSel((s) => ({ ...s, global: { ...s.global, [k]: v } }));
  const setMemory = (k, v) => setSel((s) => ({ ...s, memory: { ...s.memory, [k]: v } }));

  const selectPreset = (p) => {
    const normalized = normalizePreset(p) || p;
    setSel({
      ...normalized,
      global: { ...normalized.global },
      segmentOverrides: { ...(normalized.segmentOverrides || {}) },
      memory: { ...normalized.memory },
    });
    setIsNew(false);
    setPtab('effect');
    wled.resetTestStatus();
  };

  const duplicatePreset = (p) => {
    const copy = duplicatePresetRecord(p, duplicateTaggedName(p.name));
    update({ presets: [...data.presets, copy] });
    setSel(copy);
    setIsNew(false);
    setPtab('effect');
  };

  const save = () => {
    if (!sel.name.trim()) return alert('Enter a name');
    const normalized = normalizePreset(sel);
    if (!normalized) return alert('Invalid preset');
    update({
      presets: isNew
        ? [...data.presets, normalized]
        : data.presets.map((p) => (p.id === sel.id ? normalized : p)),
    });
    setSel(null);
  };

  const del = (id) => {
    if (confirm('Delete this preset?')) {
      update({ presets: data.presets.filter((p) => p.id !== id) });
      setSel(null);
    }
  };

  const applyPalettePick = (v) => {
    if (!v) {
      setSel((s) => ({ ...s, global: { ...s.global, pal: undefined, palName: '' } }));
      return;
    }
    if (v.startsWith('wled:')) {
      const id = parseInt(v.slice(5), 10);
      const pal = wled.wledPalettes.find((p) => p.id === id);
      setSel((s) => ({
        ...s,
        global: { ...s.global, pal: id, palName: pal?.name || s.global.palName },
      }));
    }
  };

  const toggleCaptureOpt = (k) => setCaptureOpts((o) => ({ ...o, [k]: !o[k] }));
  const setAllCaptureOpts = (v) =>
    setCaptureOpts(Object.fromEntries(Object.keys(DEFAULT_WLED_CAPTURE_OPTS).map((k) => [k, v])));

  const runCaptureFromWled = async () => {
    if (!Object.values(captureOpts).some(Boolean)) {
      setCaptureErr('Select at least one property to import.');
      return;
    }
    setCapturing(true);
    setCaptureErr('');
    try {
      const ip = wled.wledIp.trim();
      if (!ip) throw new Error('Enter a WLED IP in WLED Connect (left panel).');
      localStorage.setItem('wled-ip', ip);
      let effects = wled.wledEffects;
      let palettes = wled.wledPalettes;
      const state = await fetchWledFullStateFromIp(ip);
      if (!effects.length || !palettes.length) {
        try {
          const cat = await fetchWledCatalog(ip);
          effects = cat.effects;
          palettes = cat.palettes;
          wled.setWledEffects(effects);
          wled.setWledPalettes(palettes);
          wled.setWledStatus('connected');
        } catch { /* names may fall back to IDs */ }
      }
      setSel((s) => applyWledStateCapture(s, state, { effects, palettes }, captureOpts, captureUpdateMemory));
      setShowCapture(false);
      setCaptureErr('');
    } catch (e) {
      setCaptureErr(e.message || 'Capture failed');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <>
      <MasterDetail
        sidebarWidth={320}
        showDetail={!!sel}
        sidebar={
          <PresetListPanel
            presets={data.presets}
            filteredPresets={filteredPresets}
            selectedId={sel?.id}
            segmentMaps={segmentMaps}
            search={search}
            onSearchChange={setSearch}
            activeTag={activeTag}
            onActiveTagChange={setActiveTag}
            wledIp={wled.wledIp}
            onWledIpChange={wled.setWledIp}
            wledStatus={wled.wledStatus}
            wledEffectsCount={wled.wledEffects.length}
            wledPalettesCount={wled.wledPalettes.length}
            onConnectWled={wled.connectWled}
            onNew={() => { setSel(blankPreset()); setIsNew(true); setPtab('effect'); }}
            onSelect={selectPreset}
            onDuplicate={duplicatePreset}
            onTest={wled.testPreset}
            onOpenShotBox={onOpenShotBox}
          />
        }
        detail={
          sel ? (
            <PresetEditor
              sel={sel}
              setSel={setSel}
              isNew={isNew}
              ptab={ptab}
              onPtabChange={setPtab}
              setGlobal={setGlobal}
              setMemory={setMemory}
              wledIp={wled.wledIp}
              wledEffects={wled.wledEffects}
              wledPalettes={wled.wledPalettes}
              effectFilter={wled.effectFilter}
              onEffectFilterChange={wled.setEffectFilter}
              filteredEffects={wled.filteredEffects}
              paletteOptions={wled.paletteOptions}
              onApplyPalettePick={applyPalettePick}
              segmentMaps={segmentMaps}
              zones={data.zones}
              presetTestStatus={wled.presetTestStatus}
              presetTestErr={wled.presetTestErr}
              onImportFromWled={() => {
                setCaptureOpts({ ...DEFAULT_WLED_CAPTURE_OPTS });
                setCaptureErr('');
                setShowCapture(true);
              }}
              onTest={wled.testPreset}
              onDelete={del}
              onDuplicate={duplicatePreset}
              onCancel={() => setSel(null)}
              onBack={() => setSel(null)}
              onSave={save}
              onOpenMapEditor={() => setShowMapEditor(true)}
              onWledIpChange={wled.setWledIp}
            />
          ) : (
            <Stack h="100%" align="center" justify="center">
              <Text size="sm" c="dimmed">Select a preset or tap + New</Text>
            </Stack>
          )
        }
      />

      <PresetCaptureModal
        open={showCapture && !!sel}
        wledIp={wled.wledIp}
        captureOpts={captureOpts}
        onToggleOpt={toggleCaptureOpt}
        onSetAllOpts={setAllCaptureOpts}
        captureUpdateMemory={captureUpdateMemory}
        onCaptureUpdateMemoryChange={setCaptureUpdateMemory}
        capturing={capturing}
        captureErr={captureErr}
        onClose={() => { setShowCapture(false); setCaptureErr(''); }}
        onImport={runCaptureFromWled}
      />

      <PresetMapEditorModal
        open={showMapEditor}
        onClose={() => setShowMapEditor(false)}
        wledIp={wled.wledIp}
        onWledIpChange={wled.setWledIpPersisted}
        mb={mb}
        presets={data.presets || []}
        wledEffects={wled.wledEffects}
        wledPalettes={wled.wledPalettes}
        onMbChange={(next) => update({ mbMapping: next })}
        onPresetsChange={(nextPresets) => {
          update({ presets: nextPresets });
          if (sel) {
            const updated = nextPresets.find((p) => p.id === sel.id);
            if (updated) setSel((s) => ({ ...s, segmentMapId: updated.segmentMapId }));
          }
        }}
      />
    </>
  );
}
