import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Group, Text } from '@mantine/core';
import { AppButton } from '../shared/styles';

/** Typed clipboard kinds for rule-editor / segment-map Copy/Paste. */
export const RULE_CLIP = {
  condition: 'condition',
  segmentSources: 'segmentSources',
  timing: 'timing',
  timingParamBinding: 'timingParamBinding',
  fallbackDuration: 'fallbackDuration',
  startTransition: 'startTransition',
  stopTransition: 'stopTransition',
  colorSources: 'colorSources',
  colorSource: 'colorSource',
  packetExtracts: 'packetExtracts',
  packetExtract: 'packetExtract',
  segment: 'segment',
};

const RuleClipContext = createContext<{
  clip: any;
  copyKind: (kind?: any, data?: any) => Promise<void>;
  hasKind: (kind?: any) => boolean;
  takeKind: (kind?: any) => any;
}>({
  clip: null,
  copyKind: async () => {},
  hasKind: () => false,
  takeKind: () => null,
});

function cloneData(data) {
  try {
    return structuredClone(data);
  } catch {
    return JSON.parse(JSON.stringify(data));
  }
}

export function RuleClipProvider({ children }) {
  const [clip, setClip] = useState<any>(null); // { kind, data }

  const copyKind = useCallback(async (kind, data) => {
    const cloned = cloneData(data);
    setClip({ kind, data: cloned });
    try {
      await navigator.clipboard.writeText(JSON.stringify({ __illumaRuleClip: kind, data: cloned }));
    } catch {
      // In-memory clip still works for Paste enablement.
    }
  }, []);

  const hasKind = useCallback((kind) => clip?.kind === kind, [clip]);

  const takeKind = useCallback((kind) => {
    if (clip?.kind !== kind) return null;
    return cloneData(clip.data);
  }, [clip]);

  const value = useMemo(
    () => ({ clip, copyKind, hasKind, takeKind }),
    [clip, copyKind, hasKind, takeKind],
  );

  return (
    <RuleClipContext.Provider value={value}>
      {children}
    </RuleClipContext.Provider>
  );
}

export function useRuleClip() {
  return useContext(RuleClipContext);
}

/**
 * Copy + Paste buttons for a typed rule clip.
 * Paste is disabled until something of this `kind` has been copied in-session.
 */
export function CopyPasteButtons({
  kind,
  getData,
  onPaste,
  pasteLabel = 'Paste',
  size = 'compact-xs',
  showStatus = true,
}) {
  const { copyKind, hasKind, takeKind } = useRuleClip();
  const [msg, setMsg] = useState('');
  const flash = (m) => {
    setMsg(m);
    window.setTimeout(() => setMsg(''), 2000);
  };
  const canPaste = hasKind(kind);

  return (
    <Group gap="xs" wrap="nowrap">
      <AppButton
        size={size}
        variant="default"
        onClick={async () => {
          try {
            const data = typeof getData === 'function' ? getData() : getData;
            await copyKind(kind, data);
            flash('Copied');
          } catch {
            flash('Copy failed');
          }
        }}
      >
        Copy
      </AppButton>
      <AppButton
        size={size}
        variant="default"
        disabled={!canPaste}
        onClick={() => {
          const data = takeKind(kind);
          if (data == null) {
            flash('Nothing to paste');
            return;
          }
          onPaste(data);
          flash('Pasted');
        }}
      >
        {pasteLabel}
      </AppButton>
      {showStatus && msg ? <Text size="xs" c="dimmed">{msg}</Text> : null}
    </Group>
  );
}
