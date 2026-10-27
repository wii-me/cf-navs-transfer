import { describe, expect, it } from 'vitest'
import {
  isTypingTarget,
  resolveGlobalShortcut,
  type GlobalShortcutContext,
  type GlobalShortcutEvent,
} from '../../src/lib/appShortcuts'

function keyEvent(key: string, overrides: Partial<GlobalShortcutEvent> = {}): GlobalShortcutEvent {
  return { key, ctrlKey: false, metaKey: false, isComposing: false, target: null, ...overrides }
}

const closed: GlobalShortcutContext = { homeActive: true, spotlightOpen: false }
const open: GlobalShortcutContext = { homeActive: true, spotlightOpen: true }

describe('app global shortcuts', () => {
  it('toggles spotlight with Ctrl+K / Cmd+K, case-insensitive', () => {
    expect(resolveGlobalShortcut(keyEvent('k', { ctrlKey: true }), closed)).toBe('open-spotlight')
    expect(resolveGlobalShortcut(keyEvent('K', { metaKey: true }), closed)).toBe('open-spotlight')
    expect(resolveGlobalShortcut(keyEvent('k', { ctrlKey: true }), open)).toBe('close-spotlight')
    expect(resolveGlobalShortcut(keyEvent('k', { metaKey: true }), open)).toBe('close-spotlight')
  })

  it('ignores plain k without a modifier', () => {
    expect(resolveGlobalShortcut(keyEvent('k'), closed)).toBeNull()
  })

  it('opens with "/" only while spotlight is closed (modifiers do not matter)', () => {
    expect(resolveGlobalShortcut(keyEvent('/'), closed)).toBe('open-spotlight')
    expect(resolveGlobalShortcut(keyEvent('/', { ctrlKey: true }), closed)).toBe('open-spotlight')
    expect(resolveGlobalShortcut(keyEvent('/'), open)).toBeNull()
  })

  it('closes with Escape only while spotlight is open', () => {
    expect(resolveGlobalShortcut(keyEvent('Escape'), open)).toBe('close-spotlight')
    expect(resolveGlobalShortcut(keyEvent('Escape'), closed)).toBeNull()
  })

  it('does nothing outside the visible home view', () => {
    const away: GlobalShortcutContext = { homeActive: false, spotlightOpen: false }
    expect(resolveGlobalShortcut(keyEvent('k', { ctrlKey: true }), away)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('/'), away)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('Escape'), { homeActive: false, spotlightOpen: true })).toBeNull()
  })

  it('skips IME composition and the Process key', () => {
    expect(resolveGlobalShortcut(keyEvent('/', { isComposing: true }), closed)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('k', { ctrlKey: true, isComposing: true }), closed)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('Process'), closed)).toBeNull()
  })

  it('skips keys typed into inputs, textareas and contenteditable', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) {
      expect(isTypingTarget(target)).toBe(true)
      expect(resolveGlobalShortcut(keyEvent('/', { target }), closed)).toBeNull()
      expect(resolveGlobalShortcut(keyEvent('Escape', { target }), open)).toBeNull()
      expect(resolveGlobalShortcut(keyEvent('k', { ctrlKey: true, target }), closed)).toBeNull()
    }
  })

  it('treats non-editable targets as not typing', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isTypingTarget({})).toBe(false)
    expect(resolveGlobalShortcut(keyEvent('/', { target: { tagName: 'BUTTON' } }), closed)).toBe('open-spotlight')
  })
})
