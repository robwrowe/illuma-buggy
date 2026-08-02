import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAppStore } from '../../stores/store';
import { useTheme } from '../../utils/theme';
import BrightnessField from './BrightnessField';
import { moreStyles } from './moreStyles';

export default function BrightnessScreen() {
  const { colors } = useTheme();
  const s = moreStyles(colors);
  const { brightnessConfig, setBrightnessConfig, saveToStorage } = useAppStore();
  const update = (key: keyof typeof brightnessConfig, value: string) => {
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      setBrightnessConfig({ [key]: parsed });
      saveToStorage();
    }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Brightness</Text>
        <BrightnessField label="Daytime" hint="Sun above threshold (0–255)" value={brightnessConfig.daytime} onChange={v => update('daytime', v)} colors={colors} />
        <BrightnessField label="Nighttime" hint="Sun below threshold (0–255)" value={brightnessConfig.nighttime} onChange={v => update('nighttime', v)} colors={colors} />
        <BrightnessField label="Indoor" hint="Inside indoor zones (0–255)" value={brightnessConfig.indoor} onChange={v => update('indoor', v)} colors={colors} />
        <BrightnessField label="Threshold (°)" hint="Solar elevation for day/night" value={brightnessConfig.solarThresholdDeg} onChange={v => update('solarThresholdDeg', v)} colors={colors} />
        <BrightnessField label="Transition (min)" hint="Ramp duration at threshold" value={brightnessConfig.transitionMinutes} onChange={v => update('transitionMinutes', v)} colors={colors} />
      </View>
    </ScrollView>
  );
}
