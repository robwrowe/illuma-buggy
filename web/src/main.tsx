import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider, localStorageColorSchemeManager } from '@mantine/core';
import '@mantine/core/styles.css';
import { App } from './App';
import { ROUTER_BASENAME } from './lib/routes';
import { appTheme, cssVariablesResolver } from './styles/theme';
import './index.css';

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'illuma-buggy-color-scheme',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <MantineProvider
        theme={appTheme}
        defaultColorScheme="dark"
        colorSchemeManager={colorSchemeManager}
        cssVariablesResolver={cssVariablesResolver}
      >
        <App />
      </MantineProvider>
    </BrowserRouter>
  </StrictMode>,
);
