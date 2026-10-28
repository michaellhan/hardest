/** Client-side assignment parser: public API. */
export type {
  Confidence,
  DraftProblem,
  ParseInput,
  ParseQuality,
  ParseResult,
  QualityStatus,
  SourceKind,
} from './types'
export { parseDocument } from './parse'
export { latexToMarkdown } from './latex'
export { normalizeForCompare, sha256Hex, textSimilarity } from './similarity'
export { nextLabel } from './labels'
export { nameProblems, suggestTitle } from './naming'
export {
  addProblem,
  flattenDrafts,
  indentProblem,
  mergeWithNext,
  moveProblem,
  outdentProblem,
  removeProblem,
  splitProblem,
  updateProblem,
  validateDrafts,
} from './editor'
