import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { AppearanceProvider } from '@/lib/appearance-provider'
import { ToastProvider } from '@/components/ui/toaster'
import { router } from '@/router'
import { bootSiteFont } from '@/lib/site-font'

// Register the cached @font-face immediately, then refresh the active
// record — an admin replacing the font lands on this visit, not the next.
bootSiteFont()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppearanceProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AppearanceProvider>
  </StrictMode>,
)
