// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte'
import HomeFloatingActions from '../../src/components/HomeFloatingActions.svelte'
import AdminPageHeader from '../../src/components/admin/AdminPageHeader.svelte'
import { transferStore } from '../../src/lib/stores/transferStore'

afterEach(cleanup)

describe('Transfer Integration', () => {
  beforeEach(() => {
    transferStore.reset()
  })

  it('does not show transfer button on home when not authenticated', () => {
    render(HomeFloatingActions, {
      props: {
        isAuthenticated: false,
      },
    })
    expect(screen.queryByTestId('home-transfer-button')).toBeNull()
  })

  it('shows transfer button on home when authenticated and opens drawer on click', async () => {
    render(HomeFloatingActions, {
      props: {
        isAuthenticated: true,
      },
    })
    const btn = screen.getByTestId('home-transfer-button')
    expect(btn).toBeDefined()

    expect(transferStore.subscribe).toBeDefined()
    await fireEvent.click(btn)

    let isOpen = false
    const unsub = transferStore.subscribe((s) => {
      isOpen = s.drawerOpen
    })
    expect(isOpen).toBe(true)
    unsub()
  })

  it('shows transfer button on admin header and opens drawer on click', async () => {
    render(AdminPageHeader, {
      props: {
        isAuthenticated: true,
      },
    })
    const btn = screen.getByTestId('admin-transfer-button')
    expect(btn).toBeDefined()

    await fireEvent.click(btn)
    let isOpen = false
    const unsub = transferStore.subscribe((s) => {
      isOpen = s.drawerOpen
    })
    expect(isOpen).toBe(true)
    unsub()
  })
})
