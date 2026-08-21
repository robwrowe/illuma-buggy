import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import IconSearch from '@tabler/icons-react-native/dist/esm/icons/IconSearch';
import IconWifi from '@tabler/icons-react-native/dist/esm/icons/IconWifi';
import { BoardRoleMode, DEFAULT_BOARD_IP, useAppStore } from '../../stores/store';
import { bleService } from '../../services/BLEService';
import { discoverLogicBoardIp } from '../../services/boardDiscovery';
import { useBLE } from '../../hooks/useBLE';
import { useTheme } from '../../utils/theme';
import { moreStyles } from './moreStyles';

export default function LogicBoardScreen() {
  const { colors } = useTheme();
  const s = moreStyles(colors);
  const { isConnected } = useBLE();
  const {
    boardRole, setBoardRole, deviceStatus, wledSsid, setWledSsid, wledPass, setWledPass,
    wledIp, setWledIp, wledPort, setWledPort, boardIp, setBoardIp, saveToStorage,
  } = useAppStore();
  const [finding, setFinding] = useState(false);
  const [findMessage, setFindMessage] = useState<string | null>(null);
  const updateBoardRole = (role: BoardRoleMode) => {
    setBoardRole(role);
    if (isConnected) void bleService.sendBoardRole(role);
    saveToStorage();
  };
  const saveNetwork = () => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy before saving WLED network settings.');
      return;
    }
    const payload: { ssid?: string; pass?: string; ip?: string; port?: number } = {};
    if (wledSsid.trim()) payload.ssid = wledSsid.trim();
    if (wledPass) payload.pass = wledPass;
    if (wledIp.trim()) payload.ip = wledIp.trim();
    if (wledPort > 0) payload.port = wledPort;
    if (!payload.ssid && !payload.pass && !payload.ip && payload.port === undefined) {
      Alert.alert('Nothing to save', 'Enter at least one WLED network field.');
      return;
    }
    void bleService.sendWledNetConfig(payload.ssid, payload.pass, payload.ip, payload.port);
    saveToStorage();
    Alert.alert('Saved', 'WLED network settings sent to board. WiFi will reconnect.');
  };
  const findOnNetwork = async () => {
    if (finding) return;
    setFinding(true);
    setFindMessage(null);
    try {
      const ip = await discoverLogicBoardIp();
      if (ip) {
        setBoardIp(ip);
        saveToStorage();
        setFindMessage(`Found ${ip}`);
      } else {
        setFindMessage("Couldn't find it automatically — enter the IP manually");
      }
    } catch {
      setFindMessage("Couldn't find it automatically — enter the IP manually");
    } finally {
      setFinding(false);
    }
  };
  const dual = boardRole === 'logic_board';
  const statusText = !dual
    ? 'Standalone — local BLE scan on logic board'
    : deviceStatus?.scannerSeen
      ? `Dual-board scanner seen${deviceStatus.scannerAgeMs !== undefined ? ` ${Math.round(deviceStatus.scannerAgeMs / 1000)}s ago` : ''}`
      : 'Dual-board scanner: no signal';
  const statusColor = !dual ? colors.textMuted : deviceStatus?.scannerSeen ? colors.success : colors.danger;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Board Mode</Text>
        <Text style={s.sectionHint}>Reboot the logic board after switching modes.</Text>
        <View style={s.recallBtns}>
          {(['standalone', 'logic_board'] as BoardRoleMode[]).map(role => (
            <TouchableOpacity key={role} style={[s.recallBtn, boardRole === role && { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => updateBoardRole(role)}>
              <Text style={[s.recallBtnText, boardRole === role && { color: '#fff' }]}>{role === 'standalone' ? 'Standalone' : 'Dual-Board'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[s.rowHint, { color: statusColor }]}>{statusText}</Text>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Logic board HTTP</Text>
        <Text style={s.sectionHint}>
          Hostname used for HTTP to the board. Defaults to {DEFAULT_BOARD_IP} — tap Find if that stalls, or type an IP.
        </Text>
        <View style={s.wledField}>
          <Text style={s.rowLabel}>IP / hostname</Text>
          <TextInput
            style={s.wledInput}
            value={boardIp}
            onChangeText={setBoardIp}
            onEndEditing={() => saveToStorage()}
            placeholder={DEFAULT_BOARD_IP}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <TouchableOpacity style={s.dataBtn} onPress={() => { void findOnNetwork(); }} disabled={finding}>
          {finding
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <IconSearch size={16} color={colors.primary} />}
          <Text style={s.dataBtnText}>{finding ? 'Searching…' : 'Find on network'}</Text>
        </TouchableOpacity>
        {findMessage ? <Text style={s.rowHint}>{findMessage}</Text> : null}
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>WLED Network</Text>
        <Text style={s.sectionHint}>Saved to board NVS. {deviceStatus?.wledIp ? `Board: ${deviceStatus.wledSsid ?? '?'} @ ${deviceStatus.wledIp}:${deviceStatus.wledPort ?? 80}` : ''}</Text>
        <View style={s.wledField}><Text style={s.rowLabel}>SSID</Text><TextInput style={s.wledInput} value={wledSsid} onChangeText={setWledSsid} placeholder={deviceStatus?.wledSsid ?? 'StrollerNet'} placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} /></View>
        <View style={s.wledField}><Text style={s.rowLabel}>Password</Text><TextInput style={s.wledInput} value={wledPass} onChangeText={setWledPass} placeholder="(unchanged if empty)" placeholderTextColor={colors.textMuted} secureTextEntry autoCapitalize="none" autoCorrect={false} /></View>
        <View style={s.wledField}><Text style={s.rowLabel}>IP / hostname</Text><TextInput style={s.wledInput} value={wledIp} onChangeText={setWledIp} placeholder={deviceStatus?.wledIp ?? '4.3.2.1'} placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} /></View>
        <View style={s.row}><View style={{ flex: 1 }}><Text style={s.rowLabel}>Port</Text><Text style={s.rowHint}>HTTP port (usually 80).</Text></View><TextInput style={[s.wledInput, { width: 72, textAlign: 'right', padding: 8 }]} value={String(wledPort)} onChangeText={v => { const n = parseInt(v, 10); if (!Number.isNaN(n)) setWledPort(n); }} keyboardType="number-pad" selectTextOnFocus /></View>
        <TouchableOpacity style={s.dataBtn} onPress={saveNetwork}><IconWifi size={16} color={colors.primary} /><Text style={s.dataBtnText}>Save WLED network</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}
