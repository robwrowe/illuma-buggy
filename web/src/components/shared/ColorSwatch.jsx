export function ColorSwatch({ colors, size = 14, gap = 3, max = 999 }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap }}>
    {colors.slice(0, max).map((c, i) => <div key={i} style={{ width: size, height: size, borderRadius: 3, background: c, border: '1px solid #ffffff22' }} />)}
  </div>;
}
