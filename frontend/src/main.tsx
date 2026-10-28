import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import './index.css'
import { AppLayout } from '@/components/layout/AppLayout'
import { OverviewPage } from '@/pages/OverviewPage'
import { ConversationsPage } from '@/pages/ConversationsPage'
import { McpPage } from '@/pages/McpPage'
import { WebhooksPage } from '@/pages/WebhooksPage'
import { PlaygroundPage } from '@/pages/PlaygroundPage'
import { WidgetPage } from '@/pages/WidgetPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { WidgetChat } from '@/widget/WidgetChat'
import { AuthGate } from '@/components/layout/AuthGate'
import { LeadsPage } from '@/pages/LeadsPage'
import { AppointmentsPage } from '@/pages/AppointmentsPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { FlowsPage } from '@/pages/FlowsPage'
import { FlowEditorPage } from '@/pages/FlowEditorPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

const router = createBrowserRouter([
  // Customer-facing chat (website par iframe me khulta hai) — dashboard layout ke bina, login nahi
  { path: '/widget/chat', element: <WidgetChat /> },
  // Flow builder poori screen leta hai (sidebar ke bina)
  {
    path: '/flows/:id',
    element: (
      <AuthGate>
        <FlowEditorPage />
      </AuthGate>
    ),
  },
  {
    element: (
      <AuthGate>
        <AppLayout />
      </AuthGate>
    ),
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/conversations', element: <ConversationsPage /> },
      { path: '/leads', element: <LeadsPage /> },
      { path: '/appointments', element: <AppointmentsPage /> },
      { path: '/knowledge', element: <KnowledgePage /> },
      { path: '/flows', element: <FlowsPage /> },
      { path: '/mcp', element: <McpPage /> },
      { path: '/webhooks', element: <WebhooksPage /> },
      { path: '/playground', element: <PlaygroundPage /> },
      { path: '/widget', element: <WidgetPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }} />
    </QueryClientProvider>
  </StrictMode>
)
