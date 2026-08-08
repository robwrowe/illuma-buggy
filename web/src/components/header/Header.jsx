import {
  Box,
  Burger,
  Button,
  Container,
  Divider,
  Drawer,
  FileButton,
  Group,
  ScrollArea,
  Stack,
  Tabs,
  Title,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import classes from './HeaderTabs.module.css';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_TABS, tabFromPathname } from '../../lib/routes';

export function HeaderTabs({
  openProfiles,
  exportJSON,
  importJSON,
  setShowBoardSync,
  profiles,
  onOpenShotBox,
}) {
  const [opened, { toggle, close }] = useDisclosure(false);

  const location = useLocation();
  const navigate = useNavigate();
  const tab = tabFromPathname(location.pathname);
  const isNarrow = useMediaQuery('(max-width: 48em)');

  const openShotBox = () => {
    close();
    if (location.pathname !== '/presets' && !location.pathname.startsWith('/presets/')) {
      navigate('/presets');
    }
    onOpenShotBox?.();
  };

  const headerActions = (
    <>
      <Button size="xs" onClick={() => { close(); setShowBoardSync(true); }}>
        📡 Board
      </Button>
      <Button size="xs" onClick={() => { close(); openProfiles(); }}>
        🗂 {Object.keys(profiles).length > 0 ? `(${Object.keys(profiles).length})` : ''}
      </Button>
      <FileButton onChange={(f) => { close(); importJSON(f); }} accept=".json">
        {(props) => (
          <Button size="xs" {...props}>
            📥 Import
          </Button>
        )}
      </FileButton>
      <Button size="xs" onClick={() => { close(); exportJSON(); }} color="lime">
        📤 Export
      </Button>
    </>
  );

  return (
    <div className={classes.header}>
      <Container className={classes.mainSection} size="md">
        <Group justify="space-between">
          <Title order={5} className={classes.brand}>
            🔦 Illuma Buggy
          </Title>

          <Burger
            opened={opened}
            onClick={toggle}
            style={{ display: isNarrow ? 'block' : 'none' }}
            size="sm"
            aria-label="Toggle navigation"
          />

          <Group gap="xs" style={{ display: isNarrow ? 'none' : 'flex' }}>
            {headerActions}
          </Group>
        </Group>
      </Container>
      <Container size="md">
        <Tabs
          defaultValue="Home"
          variant="outline"
          style={{ display: isNarrow ? 'none' : 'block' }}
          value={tab}
          classNames={{
            root: classes.tabs,
            list: classes.tabsList,
            tab: classes.tab,
          }}
        >
          <Tabs.List grow>
            {APP_TABS.map((t) => (
              <Tabs.Tab key={t.path} value={t.path} onClick={() => navigate(t.path)}>
                {isNarrow ? t.icon : `${t.icon} ${t.label}`}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </Container>

      <Drawer
        opened={opened}
        onClose={close}
        size="100%"
        padding="md"
        title="Navigation"
        zIndex={1000000}
      >
        <ScrollArea h="calc(100vh - 80px)" mx="-md">
          <Divider my="sm" />
          <Box px="md" mb="sm">
            <Button fullWidth variant="light" onClick={openShotBox}>
              🎯 Shot Box
            </Button>
          </Box>
          {APP_TABS.map((t) => (
            <a
              href="#"
              key={t.path}
              className={classes.drawerLink}
              onClick={(event) => {
                event.preventDefault();
                navigate(t.path);
                close();
              }}
            >
              {t.icon} {t.label}
            </a>
          ))}
          <Divider my="sm" />
          <Stack gap="xs" px="md" pb="md">
            {headerActions}
          </Stack>
        </ScrollArea>
      </Drawer>
    </div>
  );
}
