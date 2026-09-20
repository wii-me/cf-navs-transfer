<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import {
    clampAlpha,
    cssColorIncludesAlpha,
    formatAlpha,
    formatCssColor,
    normalizeHexColor,
    parseCssColor,
  } from '../lib/color'

  export let value = '#ffffff'
  export let alpha: number | null = null
  export let placeholder = '#ffffff'
  export let inputLabel = '颜色值'
  export let swatchTitle = '打开颜色选择器'
  export let alphaText = '透明度'

  const dispatch = createEventDispatcher<{ change: string }>()

  let pickerOpen = false
  let pickerHex = '#ffffff'
  let internalAlpha = 1
  let lastParsedSource = ''

  $: effectiveAlpha = alpha ?? internalAlpha

  $: if (value !== lastParsedSource) {
    lastParsedSource = value
    const parsed = parseCssColor(value)
    if (parsed) {
      pickerHex = parsed.hex
      if (alpha === null) {
        internalAlpha = parsed.alpha
      }
    }
  }

  function updateValueFromPicker(nextHex: string, nextAlpha = effectiveAlpha) {
    const normalized = normalizeHexColor(nextHex) ?? pickerHex
    pickerHex = normalized

    if (alpha === null) {
      internalAlpha = clampAlpha(nextAlpha)
      value = formatCssColor(normalized, internalAlpha)
      dispatch('change', value)
      return
    }

    alpha = clampAlpha(nextAlpha)
    value = normalized
    dispatch('change', value)
  }

  function handleTextInput(event: Event) {
    const nextValue = (event.currentTarget as HTMLInputElement).value
    value = nextValue

    const parsed = parseCssColor(nextValue)
    if (parsed && alpha !== null && cssColorIncludesAlpha(nextValue)) {
      alpha = parsed.alpha
    }
    dispatch('change', value)
  }

  function handleColorInput(event: Event) {
    updateValueFromPicker((event.currentTarget as HTMLInputElement).value)
  }

  function handleAlphaInput(event: Event) {
    updateValueFromPicker(pickerHex, Number((event.currentTarget as HTMLInputElement).value))
  }

  function togglePicker() {
    pickerOpen = !pickerOpen
  }

  function closePicker() {
    pickerOpen = false
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closePicker()
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="color-input-shell">
  <div class="color-picker-row">
    <input
      value={value}
      type="text"
      {placeholder}
      maxlength="40"
      aria-label={inputLabel}
      on:input={handleTextInput}
    />
    <button
      type="button"
      class="color-swatch"
      style="--swatch-color: {value};"
      title={swatchTitle}
      aria-label={swatchTitle}
      aria-expanded={pickerOpen}
      on:click={togglePicker}
    ></button>
  </div>

  {#if pickerOpen}
    <div class="picker-popover">
      <label class="picker-field">
        <span>颜色</span>
        <input value={pickerHex} type="color" on:input={handleColorInput} />
      </label>

      <label class="picker-field">
        <span>{alphaText} <em>{formatAlpha(effectiveAlpha)}</em></span>
        <input value={effectiveAlpha} type="range" min="0" max="1" step="0.01" on:input={handleAlphaInput} />
      </label>
    </div>
  {/if}
</div>

<style>
  .color-input-shell {
    position: relative;
    min-width: 0;
  }

  .color-picker-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .color-picker-row input[type='text'] {
    width: 100%;
    box-sizing: border-box;
    flex: 1;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 14px;
    color: #0f172a;
    background: #ffffff;
    font-family: inherit;
  }

  .color-picker-row input[type='text']:focus-visible {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .color-swatch {
    width: 38px;
    height: 38px;
    flex: 0 0 38px;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    background:
      linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
      linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
      linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
    background-color: #ffffff;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    background-size: 12px 12px;
    cursor: pointer;
    padding: 0;
    overflow: hidden;
    box-shadow: inset 0 0 0 3px #ffffff;
  }

  .color-swatch::after {
    content: '';
    display: block;
    width: 100%;
    height: 100%;
    background: var(--swatch-color);
  }

  .color-swatch:hover,
  .color-swatch:focus-visible {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px var(--focus-ring), inset 0 0 0 3px #ffffff;
    outline: none;
  }

  .picker-popover {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 20;
    width: min(280px, 80vw);
    box-sizing: border-box;
    display: grid;
    gap: 12px;
    border: 1px solid #dbe3ef;
    border-radius: 14px;
    background: #ffffff;
    box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14);
    padding: 14px;
  }

  .picker-field {
    display: grid;
    gap: 8px;
  }

  .picker-field span {
    color: #334155;
    font-size: 13px;
    font-weight: 600;
  }

  .picker-field span em {
    color: #2563eb;
    font-style: normal;
  }

  .picker-field input[type='color'] {
    width: 100%;
    height: 42px;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    background: #ffffff;
    padding: 4px;
    cursor: pointer;
  }

  .picker-field input[type='range'] {
    width: 100%;
    padding: 0;
    accent-color: #2563eb;
  }
</style>
