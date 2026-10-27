import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useNavigate, useSearchParams } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { Skeleton } from '@/components/ui/misc'
import { useAuth } from '@/hooks/useAuth'
import HomePage from '@/pages/HomePage'
import CoursePage from '@/pages/course/CoursePage'
import UniversityPage from '@/pages/UniversityPage'
import NotFoundPage from '@/pages/NotFoundPage'

// Less-visited pages load on demand.
const UploadPage = lazy(() => import('@/pages/upload/UploadPage'))
const ContributePage = lazy(() => import('@/pages/ContributePage'))
const MePage = lazy(() => import('@/pages/MePage'))
const ModerationPage = lazy(() => import('@/pages/ModerationPage'))
const AboutPage = lazy(() => import('@/pages/AboutPage'))

/** After a magic-link / OAuth round trip we land on /?next=…; send the user back where they were. */
function AuthReturn() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { ready } = useAuth()
  const next = params.get('next')
  useEffect(() => {
    if (!ready || !next) return
    // Only same-app paths: never redirect to another origin.
    const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/'
    navigate(safe, { replace: true })
  }, [ready, next, navigate])
  return null
}

function PageFallback() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-6 h-64" />
    </div>
  )
}

export default function App() {
  return (
    <>
      <AuthReturn />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="contribute" element={<ContributePage />} />
            <Route path="me" element={<MePage />} />
            <Route path="moderation" element={<ModerationPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path=":uni" element={<UniversityPage />} />
            <Route path=":uni/:course/:offering?/:assignment?/:problem?" element={<CoursePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}
