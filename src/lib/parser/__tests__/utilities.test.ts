import { describe, expect, it } from 'vitest'
import { nextLabel, normalizeForCompare, sha256Hex, textSimilarity } from '../index'
import { analyzeSequence, intToRoman, romanToInt } from '../labels'
import { guessDueDate, guessTitle } from '../metadata'

describe('normalizeForCompare', () => {
  it('lowercases and strips LaTeX, punctuation and whitespace runs', () => {
    expect(normalizeForCompare('Let  $G$ be a \\textbf{Group}, \n of order $\\mathbb{N}$!')).toBe('let g be a group of order n')
    expect(normalizeForCompare('\\begin{align} x &= y \\end{align}')).toBe('x y')
  })
})

describe('textSimilarity', () => {
  const a = 'Let G be a finite group of order 12. Show that G has a normal Sylow subgroup.'
  it('is 1 for identical text and ≈0 for unrelated text', () => {
    expect(textSimilarity(a, a)).toBe(1)
    expect(textSimilarity(a, 'Write an essay about the causes of the French Revolution in detail.')).toBeLessThan(0.05)
  })

  it('is high for whitespace / formatting variants and reordered sentences', () => {
    expect(textSimilarity(a, 'Let  $G$ be a finite group of order 12.\nShow that G has a normal Sylow subgroup!')).toBe(1)
    const reordered = 'Show that G has a normal Sylow subgroup. Let G be a finite group of order 12.'
    expect(textSimilarity(a, reordered)).toBeGreaterThan(0.6)
  })

  it('uses word sets for short texts', () => {
    expect(textSimilarity('prove it', 'it prove')).toBe(1)
    expect(textSimilarity('', '')).toBe(1)
    expect(textSimilarity('word', '')).toBe(0)
  })
})

describe('sha256Hex', () => {
  it('matches the known "abc" vector for strings and buffers', async () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(await sha256Hex('abc')).toBe(expected)
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer)).toBe(expected)
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('nextLabel', () => {
  it.each([
    ['3', '4'],
    ['9', '10'],
    ['a', 'b'],
    ['A', 'B'],
    ['i', 'ii'],
    ['iv', 'v'],
    ['viii', 'ix'],
    ['IV', 'V'],
    ['Q3', 'Q4'],
    ['1.2', '1.3'],
    ['3a', '3b'],
    ['z', "z'"],
    ["b'", "b''"],
    ['', '1'],
  ])('%s → %s', (input, expected) => {
    expect(nextLabel(input)).toBe(expected)
  })
})

describe('roman numerals and sequences', () => {
  it('round-trips roman numerals', () => {
    expect(intToRoman(14)).toBe('xiv')
    expect(romanToInt('xiv')).toBe(14)
    expect(romanToInt('iiii')).toBeNull()
    expect(romanToInt('Xi')).toBeNull()
  })

  it('reports gaps, duplicates and reorderings', () => {
    expect(analyzeSequence(['1', '2', '4']).issues).toEqual([null, null, 'Label sequence jumps from 2 to 4'])
    expect(analyzeSequence(['1', '2', '2']).issues[2]).toBe('Duplicate label 2')
    expect(analyzeSequence(['1', '3', '2']).issues[2]).toBe('Label 2 is out of order (follows 3)')
    expect(analyzeSequence(['I', 'II', 'III']).issues).toEqual([null, null, null])
    expect(analyzeSequence(['1.1', '1.2', '2.1']).issues).toEqual([null, null, null])
  })
})

describe('metadata guessing', () => {
  it.each([
    ['Math 55 — Problem Set 4', 'Problem Set 4', 4],
    ['CS 161 Homework #3', 'Homework 3', 3],
    ['HW 5 (Fall 2026)', 'Homework 5', 5],
    ['Pset 7', 'Problem Set 7', 7],
    ['PS7: Graphs', 'Problem Set 7', 7],
    ['Assignment 2', 'Assignment 2', 2],
    ['Lab 3: Pendulums', 'Lab 3', 3],
    ['Essay 2 Prompts', 'Essay 2', 2],
  ])('guessTitle(%s)', (line, title, number) => {
    expect(guessTitle([line])).toEqual({ title, number })
  })

  it('returns null for conflicting or missing titles', () => {
    expect(guessTitle(['Homework 3', 'see Homework 4'])).toBeNull()
    expect(guessTitle(['Introduction to Algorithms'])).toBeNull()
    expect(guessTitle(['Homework 3 (Problem Set 3)'])).toEqual({ title: 'Homework 3', number: 3 })
  })

  it.each([
    ['Due: Thursday, September 17, 2026', '2026-09-17'],
    ['Due 9/17/2026', '2026-09-17'],
    ['due on Sept. 17th, 2026 at 11:59pm', '2026-09-17'],
    ['Due date: 2026-10-01', '2026-10-01'],
    ['Deadline: 3 March 2027', '2027-03-03'],
    ['due Sept. 17', null],
    ['Due 2/30/2026', null],
    ['Released September 1, 2026', null],
  ])('guessDueDate(%s)', (line, expected) => {
    expect(guessDueDate([line])).toBe(expected)
  })

  it('returns null for conflicting due dates', () => {
    expect(guessDueDate(['Part 1 due 9/17/2026', 'Part 2 due 9/24/2026'])).toBeNull()
  })
})
