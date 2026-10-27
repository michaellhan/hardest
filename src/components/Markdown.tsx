import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { cn } from '@/lib/cn'

/**
 * Safe statement renderer: Markdown + GFM + KaTeX. Raw HTML is never rendered (no rehype-raw), URLs pass
 * through react-markdown's sanitizer, images must be https, and KaTeX runs with trust disabled and size
 * limits so user-supplied LaTeX can't inject links, styles, or run away.
 */
const katexOptions = { throwOnError: false, strict: 'ignore' as const, trust: false, maxSize: 20, maxExpand: 300, output: 'htmlAndMathml' as const }

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === 'string' && /^https:\/\//.test(src) ? <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" /> : <span className="text-faint">[image: {alt || 'not shown'}]</span>,
}

function urlTransform(url: string) {
  const safe = defaultUrlTransform(url)
  return /^(https?:|mailto:|#|\/)/i.test(safe) ? safe : ''
}

export default function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-statement', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]} rehypePlugins={[[rehypeKatex, katexOptions]]} components={components} urlTransform={urlTransform} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  )
}
