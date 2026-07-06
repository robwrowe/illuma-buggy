import { formatSegLabel } from '../../lib/wled/capture';

export function SegmentBar({ segments }) {
  if (!segments?.length) return null;
  const colors = ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#ec4899', '#84cc16'];
  return (
    <div style={{ height: 14, borderRadius: 4, overflow: 'hidden', display: 'flex', background: '#111', border: '1px solid var(--border)' }}>
      {segments.map((s, i) => (
        <div key={i} title={formatSegLabel(s)}
          style={{ flex: Math.max(1, s.stop - s.start), background: colors[s.id % colors.length], minWidth: 2 }} />
      ))}
    </div>
  );
}
