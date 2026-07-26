import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { AppLayout } from '@/components/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ChatPage } from '@/pages/ChatPage';
import { SourcesPage } from '@/pages/SourcesPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export function App() {
  return (
    // Theme sits outermost so even the error fallback is themed.
    <ThemeProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          {/* AuthProvider is inside the query provider because it is backed by a query. */}
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                {/* No /login route: AppLayout gates the content area in place. */}
                <Route element={<AppLayout />}>
                  {/* Chat is the landing screen; the library lives one click away. */}
                  <Route path="/" element={<ChatPage />} />
                  <Route path="/sources" element={<SourcesPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
