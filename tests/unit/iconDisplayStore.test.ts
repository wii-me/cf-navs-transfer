import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { applyIconDisplayOverride, createIconDisplayStore, type IconDisplayOverride } from '../../src/lib/iconDisplayStore'

const epoch = 'a'.repeat(32)
const revision = 'sha256-' + 'b'.repeat(64)
const override = (patch: Partial<IconDisplayOverride> = {}): IconDisplayOverride => ({
  dataset_epoch: epoch, icon_revision: revision, icon_write_epoch: 2, icon_display: 'image', ...patch,
})

describe('applyIconDisplayOverride', () => {
  const row = { id: 1, icon: 'https://a.example/i.png', icon_blob: null, icon_cached: 0, icon_write_epoch: 1 }

  it('returns the same row when there is nothing to apply', () => {
    expect(applyIconDisplayOverride(row, undefined)).toBe(row)
    expect(applyIconDisplayOverride({ ...row, icon_write_epoch: 3 }, override()).icon_write_epoch).toBe(3)
    const same = { ...row, icon_revision: revision, icon_write_epoch: 2, icon_display: 'image' as const }
    expect(applyIconDisplayOverride(same, override())).toBe(same)
  })

  it('applies the verified identity, and clears bodies for empty icons', () => {
    expect(applyIconDisplayOverride(row, override())).toEqual({ ...row, icon_revision: revision, icon_write_epoch: 2, icon_display: 'image', icon_cached: true })
    expect(applyIconDisplayOverride(row, override({ icon_display: 'empty', icon_revision: null }))).toMatchObject({ icon: null, icon_blob: null, icon_cached: false, icon_display: 'empty' })
    expect(applyIconDisplayOverride(row, override({ icon_display: 'text', icon_revision: null }))).toMatchObject({ icon: row.icon, icon_cached: false, icon_display: 'text' })
  })
})

describe('createIconDisplayStore', () => {
  it('scopes notifications per id and returns a stable store per id', () => {
    const store = createIconDisplayStore()
    expect(store.watch(1)).toBe(store.watch(1))
    const one: unknown[] = []
    const two: unknown[] = []
    const stopOne = store.watch(1).subscribe((value) => one.push(value))
    const stopTwo = store.watch(2).subscribe((value) => two.push(value))
    store.set(1, override())
    store.set(1, override()) // 内容相同不通知
    store.set(1, override({ icon_write_epoch: 3 }))
    expect(one).toEqual([undefined, override(), override({ icon_write_epoch: 3 })])
    expect(two).toEqual([undefined])
    expect(get(store.watch(1))).toEqual(override({ icon_write_epoch: 3 }))
    stopOne(); stopTwo()
    store.set(1, override({ icon_write_epoch: 4 }))
    expect(one).toHaveLength(3)
  })

  it('applies to arrays without changing identity when nothing applies', () => {
    const store = createIconDisplayStore()
    const rows = [{ id: 1 }, { id: 2 }]
    expect(store.applyTo(rows)).toBe(rows)
    store.set(3, override())
    expect(store.applyTo(rows)).toBe(rows)
    store.set(2, override())
    const merged = store.applyTo(rows)
    expect(merged).not.toBe(rows)
    expect(merged[0]).toBe(rows[0])
    expect(merged[1]).toMatchObject({ id: 2, icon_display: 'image' })
  })

  it('prunes and clears with notifications', () => {
    const store = createIconDisplayStore()
    const seen: unknown[] = []
    store.watch(1).subscribe((value) => seen.push(value))
    store.set(1, override())
    store.set(2, override())
    store.prune((id) => id !== 2)
    expect(store.size).toBe(1)
    store.clear()
    expect(store.size).toBe(0)
    expect(seen).toEqual([undefined, override(), undefined])
  })
})
