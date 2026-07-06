import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { App } from './App.jsx';
import { ROUTER_BASENAME } from './lib/routes.js';
import { appTheme, cssVariablesResolver } from './styles/theme.js';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <MantineProvider
        theme={appTheme}
        defaultColorScheme="dark"
        cssVariablesResolver={cssVariablesResolver}
      >
        <App />
      </MantineProvider>
    </BrowserRouter>
  </StrictMode>,
);
