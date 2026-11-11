// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
 LONG_CANVAS_LIMIT_KEY, canvasLimitOverride, computeTileCuts,
} from './long-image-export'

beforeEach(() => localStorage.clear())

describe('tile cut planning', () => {
 it('keeps the whole page on one tile when it fits', () => {
 expect(computeTileCuts([100,200],1000,2000)).toEqual([0,1000])
 })

 it('cuts at measured module boundaries below the limit', () => {
 expect(computeTileCuts([1000,2000,3000],4000,1500)).toEqual([0,1000,2000,3000,4000])
 })

 it('falls back to the limit when no boundary is available', () => {
 expect(computeTileCuts([],2000,800)).toEqual([0,800,1600,2000])
 })

 it('never returns a cut beyond the page or at zero', () => {
 expect(computeTileCuts([0,2000,2000],2000,1200)).toEqual([0,1200,2000])
 })
})

describe('test-only canvas limit override', () => {
 it('accepts a valid override and rejects malformed values', () => {
 localStorage.setItem(LONG_CANVAS_LIMIT_KEY, JSON.stringify({ maxEdge:1200, maxArea:2000000 }))
 expect(canvasLimitOverride()).toEqual({ maxEdge:1200, maxArea:2000000 })
 for (const value of ['{', JSON.stringify({ maxEdge:100 }), JSON.stringify({ maxEdge:1200, maxArea:-1 })]) {
 localStorage.setItem(LONG_CANVAS_LIMIT_KEY, value)
 expect(canvasLimitOverride()).toBeNull()
 }
 })
})
