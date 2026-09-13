import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { Site } from './site'
import { isConsolePath } from './console-path'
import { Spinner } from '@zhiji/design/spinner'
import '@zhiji/theme/globals.css'
import './site.css'
import './site-theme.css'
import './home.css'

const ConsoleApp = lazy(async () => import('./console').then(module => ({ default: module.ConsoleApp })))

function WebApp() {
  return isConsolePath(location.pathname)
    ? <Suspense fallback={<main className="min-h-screen flex items-center justify-center gap-3 text-muted-foreground" aria-live="polite"><Spinner />正在加载管理台…</main>}><ConsoleApp /></Suspense>
    : <Site />
}

createRoot(document.getElementById('root')!).render(<StrictMode><WebApp /></StrictMode>)
