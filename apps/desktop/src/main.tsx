import React from 'react';
import ReactDOM from 'react-dom/client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { App } from './app/App';
import { ToastProvider } from './shared/components/ToastProvider';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ToastProvider>
  </React.StrictMode>
);
