import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

// Extend window interface for token storage
declare global {
  interface Window {
    pulsehr_token?: string;
    pulsehr_refresh_token?: string;
  }
}

// Global fetch interceptor for automatic token refreshing and 401 handling
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  // Automatically inject Bearer token if present
  if (window.pulsehr_token) {
    const newInit = init || {};
    const headers = new Headers(newInit.headers || {});
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${window.pulsehr_token}`);
      newInit.headers = headers;
    }
    init = newInit;
  }

  let response = await originalFetch(input, init);

  if (response.status === 401 && !input.toString().includes('/auth/login') && !input.toString().includes('/auth/refresh')) {
    const storedRefresh = window.pulsehr_refresh_token;
    if (storedRefresh) {
      try {
        const refreshResponse = await originalFetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: storedRefresh })
        });
        
        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          window.pulsehr_token = refreshData.access_token;
          window.pulsehr_refresh_token = refreshData.refresh_token;

          // Retry the original request
          if (init && init.headers) {
            const headers = new Headers(init.headers);
            headers.set('Authorization', `Bearer ${refreshData.access_token}`);
            init.headers = headers;
          }
          return originalFetch(input, init);
        }
      } catch (err) {
        console.error("Fetch interceptor token refresh crash:", err);
      }
    }

    // Refresh failed or no refresh token - broadcast unauthorized trigger
    window.dispatchEvent(new Event('pulsehr_unauthorized'));
  }

  return response;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
