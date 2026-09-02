import { Box } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

/**
 * Master/detail responsive shell.
 * Desktop/tablet landscape (>= breakpoint): sidebar + detail side by side,
 *   sidebar width fixed at sidebarWidth.
 * Mobile/narrow (< breakpoint): single column. Shows the sidebar (list) OR
 *   the detail pane, never both, switching based on `showDetail`.
 *   Caller is responsible for providing a "back" affordance in the detail
 *   pane since this component does not know about selection state.
 *
 * breakpoint: CSS media query string, default matches app-wide isNarrow.
 */
export function MasterDetail({
  sidebar,
  detail,
  showDetail,
  sidebarWidth = 320,
  breakpoint = '(max-width: 48em)',
}) {
  const isNarrow = useMediaQuery(breakpoint);

  if (!isNarrow) {
    return (
      <Box style={{ display: 'flex', height: '100%', minWidth: 0 }}>
        <Box w={sidebarWidth} style={{ flexShrink: 0, minWidth: 0, height: '100%' }}>
          {sidebar}
        </Box>
        <Box style={{ flex: 1, minWidth: 0, height: '100%' }}>
          {detail}
        </Box>
      </Box>
    );
  }

  return (
    <Box style={{ height: '100%', minWidth: 0 }}>
      {showDetail ? detail : sidebar}
    </Box>
  );
}
