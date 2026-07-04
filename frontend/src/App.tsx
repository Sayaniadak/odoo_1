import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthPage } from './components/AuthPage';
import { DashboardLayout } from './components/DashboardLayout';

interface UserMeta {
  id: string;
  email: string;
  role: string;
  full_name: string;
}

interface ToastMeta {
  message: string;
  type: 'success' | 'error' | 'info';
}

function App() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserMeta | null>(null);
  const [toast, setToast] = useState<ToastMeta | null>(null);

  // Listen to global unauthorized events (from global fetch interceptor)
  useEffect(() => {
    const handleUnauthorized = () => {
      setToken(null);
      setUser(null);
      window.pulsehr_token = undefined;
      window.pulsehr_refresh_token = undefined;
      queryClient.clear();
    };
    window.addEventListener('pulsehr_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('pulsehr_unauthorized', handleUnauthorized);
  }, [queryClient]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const handleLoginSuccess = (newToken: string, newRefreshToken: string, newUser: UserMeta) => {
    setToken(newToken);
    setUser(newUser);
    window.pulsehr_token = newToken;
    window.pulsehr_refresh_token = newRefreshToken;
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    window.pulsehr_token = undefined;
    window.pulsehr_refresh_token = undefined;
    window.location.hash = '#/';
    queryClient.clear();
  };

  return (
    <>
      {toast && (
        <div className={`alert-toast ${toast.type}`}>
          <span>{toast.message}</span>
        </div>
      )}

      {token && user ? (
        <DashboardLayout user={user} token={token} showToast={showToast} onLogout={handleLogout} />
      ) : (
        <AuthPage onLoginSuccess={handleLoginSuccess} />
      )}
    </>
  );
}

export default App;
