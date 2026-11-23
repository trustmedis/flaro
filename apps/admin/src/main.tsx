import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import './index.css';
import '@/siteplane/components/code/code-highlight';
import { SiteplaneUIProvider } from '@/siteplane/system/provider/siteplane-ui-provider';
import { ToastProvider } from '@/siteplane/components/toast';
import App from './app';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY — set it in apps/admin/.env');
}

const root = document.getElementById('root');
if (!root) {throw new Error('missing #root element');}
createRoot(root).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/admin/">
      <SiteplaneUIProvider data-theme="light">
        <ToastProvider>
          <App />
        </ToastProvider>
      </SiteplaneUIProvider>
    </ClerkProvider>
  </StrictMode>,
);
