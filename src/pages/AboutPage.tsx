import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { useTheme } from '@/hooks/useTheme'
import { useTitle } from '@/hooks/useMisc'
import { difficultyColor, DIFFICULTY_LABELS } from '@/lib/scale'
import { BAYES_M, LOW_SAMPLE } from '@/lib/stats'
import { config } from '@/lib/env'

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-20 text-lg font-semibold tracking-tight">
      {children}
    </h2>
  )
}

export default function AboutPage() {
  useTitle('How it works')
  const { theme } = useTheme()
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [hash])

  return (
    <article className="mx-auto max-w-2xl px-4 py-10 text-[15px] leading-relaxed sm:px-6 [&_p]:mt-3 [&_li]:mt-1.5">
      <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>
      <p className="text-muted">
        hardest collects one difficulty rating per student per problem and shows the aggregate. It’s built for students deciding when to start a problem set, which
        problems to bring to office hours, and which course to take.
      </p>

      <H id="scale">The scale</H>
      <p>Ratings run from 1 to 10. The color scale moves from muted green through amber to red; it is never used for anything else on the site.</p>
      <div className="mt-4 grid grid-cols-5 gap-1 sm:grid-cols-10">
        {Array.from({ length: 10 }, (_, i) => {
          const sw = difficultyColor(i + 1, theme)
          return (
            <div key={i} className="rounded-md px-1 py-2 text-center" style={{ backgroundColor: sw.bg, color: sw.fg }}>
              <div className="text-sm font-semibold">{i + 1}</div>
              <div className="text-[9px] leading-tight opacity-80">{DIFFICULTY_LABELS[i + 1]}</div>
            </div>
          )
        })}
      </div>
      <ul className="mt-4 list-disc pl-5 text-sm text-muted">
        <li>
          <span className="font-medium text-text">Unrated</span> cells are neutral with a dashed border. They are never colored as easy.
        </li>
        <li>
          <span className="font-medium text-text">Blank space</span> means the assignment has no problem in that position.
        </li>
        <li>
          <span className="font-medium text-text">Hatched</span> cells rest on fewer than {LOW_SAMPLE} ratings, so treat them with caution.
        </li>
      </ul>

      <H id="methodology">How numbers are computed</H>
      <ul className="list-disc pl-5">
        <li>
          <span className="font-medium">Problem average</span>: the mean of its ratings. The median, the count and an approximate 95% interval (±1.96 standard errors) are shown alongside it.
        </li>
        <li>
          <span className="font-medium">Problems with parts</span>: you rate each part. The problem’s cell shows the mean of its rated parts’ averages.
        </li>
        <li>
          <span className="font-medium">Assignment average</span>: the mean of its problems’ averages. Unrated problems are excluded rather than counted as zero, so a set with one rated problem isn’t
          “easy”.
        </li>
        <li>
          <span className="font-medium">Hardest lists</span>: problems are ranked by a Bayesian-adjusted average, which shrinks each mean toward the semester-wide average as if it had {BAYES_M}{' '}
          extra ratings at that average. One person’s 10/10 can’t top the list.
        </li>
        <li>
          <span className="font-medium">Time</span>: the median of the reported times. An assignment’s workload is the sum of its problems’ median times, and it’s shown only when at least half its problems have time data.
        </li>
        <li>
          <span className="font-medium">Edits</span>: when a problem’s wording changes materially, earlier ratings stop counting and raters are asked to rate again. Typo fixes keep ratings.
        </li>
      </ul>

      <H id="privacy">Privacy</H>
      <ul className="list-disc pl-5">
        <li>Individual ratings are private. Only aggregates are shown, and there are no per-user pages, leaderboards, or “who rated this”.</li>
        <li>The database enforces this with row-level security. Your ratings can only be read by you; public pages see only aggregate statistics.</li>
        <li>Sign-in is passwordless (email link or code). Your email is never shown to other users.</li>
        <li>Uploaded files are private by default: only you and moderators can open them unless you choose to share them.</li>
        <li>Edit history is shown without names unless a contributor opts in.</li>
      </ul>

      <H id="content">Content policy</H>
      <ul className="list-disc pl-5">
        <li>Post assignment questions only, never solutions. Don’t post anything the course marked confidential, or exams that are still in use.</li>
        <li>Only upload material you have the right to share. You can publish problem numbers alone (metadata only) and leave out the statements.</li>
        <li>Statements are rendered safely: Markdown and LaTeX only, no HTML or scripts.</li>
        <li>Use “Report” on any problem to flag errors, duplicates, or content concerns. Moderators review reports, can revert any edit, and can merge duplicates without losing ratings.</li>
        <li>Rights holders can request removal through the feedback link; we act promptly.</li>
      </ul>

      <H id="demo">Demo data</H>
      <p>
        {config.demo ? 'This site is currently running as a demo sandbox. ' : ''}
        The demo is clearly labeled wherever it appears. Every assignment, problem statement and rating in it is <span className="font-medium">synthetic</span>, and the
        statements are original, generic exercises rather than copies of real course materials. The course catalog (codes and names) is real. Demo data is stored
        separately and can be removed with one script, without touching real contributions.
      </p>

      <p className="mt-10 text-sm text-muted">
        Questions or a course to add? <Link to="/contribute" className="underline underline-offset-2">Add a course</Link> or use the feedback link at the bottom of any page.
      </p>
    </article>
  )
}
