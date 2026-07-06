import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { App } from './App.jsx';
import { appTheme } from './styles/theme.js';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MantineProvider theme={appTheme} defaultColorScheme="dark" forceColorScheme="dark">
      <App />
    </MantineProvider>
  </StrictMode>,
);
