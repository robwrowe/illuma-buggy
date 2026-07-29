import { useCallback, useEffect, useState } from 'react';
import cx from 'clsx';
import {
  Avatar,
  Burger,
  Button,
  Container,
  Divider,
  Drawer,
  FileButton,
  Group,
  Menu,
  ScrollArea,
  Tabs,
  Text,
  Title,
  UnstyledButton,
  useMantineTheme,
} from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import classes from './HeaderTabs.module.css';
import { LS_KEY, LS_PROFILES, migrateConfig } from '../../lib/config';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_TABS, tabFromPathname } from '../../lib/routes';
import { loadGoogleMaps } from '../../lib/googleMaps';

const user = {
  name: 'Jane Spoonfighter',
  email: 'janspoon@fighter.dev',
  image: 'https://raw.githubusercontent.com/mantinedev/mantine/master/.demo/avatars/avatar-5.png',
};

const tabs = [
  'Home',
  'Orders',
  'Education',
  'Community',
  'Forums',
  'Support',
  'Account',
  'Helpdesk',
];

export function HeaderTabs({ openProfiles, exportJSON, importJSON, setShowBoardSync, profiles }) {
  const [opened, { toggle, close }] = useDisclosure(false);

  const location = useLocation();
  const navigate = useNavigate();
  const tab = tabFromPathname(location.pathname);
  const isNarrow = useMediaQuery('(max-width: 48em)');


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
            hiddenFrom="xs"
            size="sm"
            aria-label="Toggle navigation"
          />

          <Group visibleFrom="sm" gap="xs">
            <Button size="xs" variant="" onClick={() => setShowBoardSync(true)}>
              📡 Board
            </Button>
            <Button size="xs" variant="" onClick={openProfiles}>
              🗂 {Object.keys(profiles).length > 0 ? `(${Object.keys(profiles).length})` : ''}
            </Button>
            <FileButton onChange={importJSON} accept=".json">
              {(props) => (
                <Button size="xs" variant="" {...props}>
                  📥
                </Button>
              )}
            </FileButton>
            <Button size="xs" onClick={exportJSON} variant="default">
              📤
            </Button>
          </Group>
        </Group>
      </Container>
      <Container size="md">
        <Tabs
          defaultValue="Home"
          variant="outline"
          visibleFrom="sm"
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
        hiddenFrom="xs"
        zIndex={1000000}
      >
        <ScrollArea h="calc(100vh - 80px" mx="-md">
          <Divider my="sm" />
          {tabs.map((tab) => (
            <a
              href="#"
              key={tab}
              className={classes.drawerLink}
              onClick={(event) => event.preventDefault()}
            >
              {tab}
            </a>
          ))}
        </ScrollArea>
      </Drawer>
    </div>
  );
}
