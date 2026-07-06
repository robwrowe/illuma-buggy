import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { App } from './App.jsx';
import { appTheme, cssVariablesResolver } from './styles/theme.js';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MantineProvider
      theme={appTheme}
      defaultColorScheme="dark"
      cssVariablesResolver={cssVariablesResolver}
    >
      <App />
    </MantineProvider>
  </StrictMode>,
);
