import type { Term } from '../types'

/**
 * The real catalog skeleton: universities, courses, and offerings. This is genuine structure (no ratings,
 * no assignments) and matches supabase/seed.sql. Course descriptions are our own one-line summaries.
 */
export interface CatalogCourse {
  key: string
  code: string
  name: string
  slug: string
  department: string
  description: string
  offerings: Array<{ key: string; term: Term; year: number; instructor?: string }>
}

export const HARVARD = {
  key: 'harvard',
  name: 'Harvard University',
  short_name: 'Harvard',
  slug: 'harvard',
  domain: 'harvard.edu',
}

export const CATALOG: CatalogCourse[] = [
  {
    key: 'math55a',
    code: 'MATH 55A',
    name: 'Studies in Algebra and Group Theory',
    slug: 'math-55a',
    department: 'Mathematics',
    description: 'Intensive first-semester course in abstract algebra and linear algebra: groups, vector spaces, linear maps, multilinear algebra, and an introduction to representation theory.',
    offerings: [
      { key: 'f26', term: 'fall', year: 2026 },
      { key: 'f25', term: 'fall', year: 2025 },
    ],
  },
  {
    key: 'math55b',
    code: 'MATH 55B',
    name: 'Studies in Real and Complex Analysis',
    slug: 'math-55b',
    department: 'Mathematics',
    description: 'Continuation of Math 55a: metric spaces, real analysis, and complex analysis.',
    offerings: [{ key: 's27', term: 'spring', year: 2027 }],
  },
  {
    key: 'stat110',
    code: 'STAT 110',
    name: 'Probability',
    slug: 'stat-110',
    department: 'Statistics',
    description: 'Probability: counting, conditional probability, random variables, expectation, common distributions, joint distributions, and limit theorems.',
    offerings: [{ key: 'f26', term: 'fall', year: 2026 }],
  },
  {
    key: 'cs1210',
    code: 'CS 1210',
    name: 'Introduction to Theoretical Computer Science',
    slug: 'cs-1210',
    department: 'Computer Science',
    description: 'Models of computation, automata, computability, and complexity.',
    offerings: [{ key: 'f26', term: 'fall', year: 2026 }],
  },
  {
    key: 'econ10a',
    code: 'ECON 10A',
    name: 'Principles of Economics (Microeconomics)',
    slug: 'econ-10a',
    department: 'Economics',
    description: 'Introductory microeconomics: markets, consumer and firm behavior, welfare, and policy.',
    offerings: [{ key: 'f26', term: 'fall', year: 2026 }],
  },
  {
    key: 'physics15a',
    code: 'PHYSICS 15A',
    name: 'Introductory Mechanics and Relativity',
    slug: 'physics-15a',
    department: 'Physics',
    description: 'Calculus-based mechanics: Newtonian dynamics, conservation laws, oscillations, and special relativity.',
    offerings: [{ key: 'f26', term: 'fall', year: 2026 }],
  },
  {
    key: 'expos20',
    code: 'EXPOS 20',
    name: 'Expository Writing',
    slug: 'expos-20',
    department: 'Writing Program',
    description: 'First-year writing seminar built around a sequence of argumentative essays and revisions.',
    offerings: [{ key: 'f26', term: 'fall', year: 2026 }],
  },
]
