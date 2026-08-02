import { StyleSheet } from 'react-native';

type Colors = ReturnType<typeof import('../../utils/theme').useTheme>['colors'];

export const moreStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { padding: 16, gap: 16 },
  section: { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, gap: 14 },
  sectionTitle: { color: c.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  sectionHint: { color: c.textMuted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { color: c.textPrimary, fontSize: 14, fontWeight: '500' },
  rowHint: { color: c.textMuted, fontSize: 12, flex: 1 },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt },
  themeBtnText: { color: c.textMuted, fontSize: 13, fontWeight: '500' },
  recallRow: { gap: 6 },
  recallBtns: { flexDirection: 'row', gap: 6 },
  recallBtn: { flex: 1, padding: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt, alignItems: 'center' },
  recallBtnText: { color: c.textMuted, fontSize: 11, fontWeight: '600' },
  dataBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surfaceAlt, padding: 12, borderRadius: 8 },
  dataBtnText: { color: c.primary, fontWeight: '600' },
  reconnectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.surfaceAlt, padding: 12, borderRadius: 8 },
  reconnectBtnText: { color: c.primary, fontWeight: '600' },
  wledField: { gap: 6 },
  wledInput: { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 10, fontSize: 14 },
});
