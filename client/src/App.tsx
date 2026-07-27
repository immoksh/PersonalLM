import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { AppLayout } from '@/components/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotebookRoute } from '@/features/notebooks/NotebookRoute';
import { ChatPage } from '@/pages/ChatPage';
import { NotebooksPage } from '@/pages/NotebooksPage';
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
                  {/* The shelf of notebooks is the landing screen — there is no
                      app-wide library to land on, since every source belongs to
                      exactly one notebook. */}
                  <Route path="/" element={<NotebooksPage />} />
                  {/* One canonical URL for the shelf, so the wordmark and the
                      sidebar's "All" link cannot disagree about where home is.
                      Kept as a redirect for existing links and bookmarks. */}
                  <Route path="/notebooks" element={<Navigate to="/" replace />} />

                  {/* Everything below is scoped to one notebook, which
                      NotebookRoute resolves before any of it renders. */}
                  <Route path="/notebooks/:notebookId" element={<NotebookRoute />}>
                    <Route index element={<ChatPage />} />
                    <Route path="sources" element={<SourcesPage />} />
                  </Route>

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
