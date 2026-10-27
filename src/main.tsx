import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/misc'
import { AuthProvider } from '@/hooks/useAuth'
import { applyTheme } from '@/hooks/useTheme'
import { ApiError } from '@/lib/api'
import App from './App'
import './index.css'

applyTheme()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Don't hammer the API on permission or validation errors; do retry flaky networks.
      retry: (count, err) => !(err instanceof ApiError) && count < 2,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TooltipProvider delayDuration={250}>
            <AuthProvider>
              <App />
            </AuthProvider>
          </TooltipProvider>
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
