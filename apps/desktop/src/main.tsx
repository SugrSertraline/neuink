import React from 'react';
import ReactDOM from 'react-dom/client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { BookOpeningProvider } from './modules/reader/components/book/BookOpeningProvider';
import { App } from './app/App';
import { ToastProvider } from './shared/components/ToastProvider';
import { TagPreferencesProvider } from './shared/components/TagPreferencesProvider';
import { AppearanceProvider } from './shared/components/AppearanceProvider';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <TooltipProvider>
        <TagPreferencesProvider>
          <AppearanceProvider><BookOpeningProvider><App /></BookOpeningProvider></AppearanceProvider>
        </TagPreferencesProvider>
      </TooltipProvider>
    </ToastProvider>
  </React.StrictMode>
);
