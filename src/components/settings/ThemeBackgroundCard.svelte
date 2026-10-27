<svelte:options runes />

<script lang="ts">
  import { tick, untrack } from 'svelte'
  import type { BackgroundSetting } from '../../../shared/types'
  import {
    backgroundTypeOptions,
    defaultDarkBackground,
    defaultDarkGradient,
    defaultLightBackground,
    defaultLightGradient,
    normalizeBackgroundValueForType,
  } from '../../lib/settingsForm'
  import ColorAlphaInput from '../ColorAlphaInput.svelte'
  import GradientBackgroundInput from '../GradientBackgroundInput.svelte'
  import InputGroup from '../ui/InputGroup.svelte'
  import Slider from '../ui/Slider.svelte'
  import Tooltip from '../ui/Tooltip.svelte'

  interface Props {
    theme: 'light' | 'dark'
    background: BackgroundSetting
    valid?: boolean
    uploadHost?: string
    /** 原 `change` 事件；参数即原 e.detail（当前背景的浅拷贝）。 */
    onchange?: (background: BackgroundSetting) => void
    /** 原 `upload` 事件。 */
    onupload?: () => void
  }

  let { theme, background: backgroundProp, valid = true, uploadHost = '', onchange, onupload }: Props = $props()

  // legacy 可变 prop 语义：子组件经 `bind:` 写回字段后本组件立即按新字段重渲染（如遮罩透明度
  // 同时绑在 ColorAlphaInput 与 Slider 上），本地整体替换（切换类型）后保持本地值，父组件传入新对象时整体替换。
  // runes 下普通 prop 的字段写入不触发更新，故以深层 $state 承接；父组件传入的若已是 $state 代理则直接沿用同一个代理。
  let background: BackgroundSetting = $state(untrack(() => backgroundProp))
  let receivedBackground = untrack(() => backgroundProp)
  $effect.pre(() => {
    const next = backgroundProp
    untrack(() => {
      if (next === receivedBackground) return
      receivedBackground = next
      background = next
    })
  })

  const isLight = $derived(theme === 'light')
  const title = $derived(isLight ? '浅色模式背景' : '深色模式背景')
  const badge = $derived(isLight ? 'Light' : 'Dark')
  const imagePlaceholder = '请输入图片 URL 或点击右侧上传'
  const colorPlaceholder = $derived(isLight ? '#f8fafc' : '#0f172a')
  const imageInputLabel = $derived(isLight ? '浅色背景图片地址' : '深色背景图片地址')
  const gradientDefaults = $derived(isLight ? defaultLightGradient : defaultDarkGradient)
  const defaults = $derived(isLight
    ? {
        color: defaultLightBackground.value,
        gradientStart: defaultLightGradient.start,
        gradientEnd: defaultLightGradient.end,
      }
    : {
        color: defaultDarkBackground.value,
        gradientStart: defaultDarkGradient.start,
        gradientEnd: defaultDarkGradient.end,
      })

  async function syncBackground(): Promise<void> {
    await tick()
    onchange?.({ ...background })
  }

  function updateBackgroundType(nextType: BackgroundSetting['type']): void {
    background = {
      ...background,
      type: nextType,
      value: normalizeBackgroundValueForType(background.value, nextType, defaults),
    }
    onchange?.({ ...background })
  }
</script>

<section class="theme-background-card">
  <div class="theme-background-header">
    <strong>{title}</strong>
    <span>{badge}</span>
  </div>

  <div class="background-form">
    <div class="background-main-row">
      <div class="field background-type-field">
        <span>背景类型</span>
        <div class="background-type-options" role="radiogroup" aria-label={`${title}背景类型`}>
          {#each backgroundTypeOptions as option}
            <label class:active={background.type === option.value} title={option.hint}>
              <input
                type="radio"
                name={`${theme}-background-type`}
                value={option.value}
                checked={background.type === option.value}
                onchange={() => updateBackgroundType(option.value)}
              />
              <span>{option.label}</span>
            </label>
          {/each}
        </div>
      </div>

      <div class="field background-value-field">
        <span>背景值</span>
        {#if background.type === 'color'}
          <ColorAlphaInput
            bind:value={background.value}
            onchange={() => void syncBackground()}
            placeholder={colorPlaceholder}
            inputLabel={`${title}颜色值`}
            swatchTitle={`选择${title}颜色`}
            alphaText={`${title}透明度`}
          />
        {:else if background.type === 'gradient'}
          <GradientBackgroundInput
            bind:value={background.value}
            onchange={() => void syncBackground()}
            defaultStart={gradientDefaults.start}
            defaultEnd={gradientDefaults.end}
            startLabel="起始颜色"
            endLabel="结束颜色"
          />
        {:else}
          <InputGroup
            type="url"
            bind:value={background.value}
            placeholder={imagePlaceholder}
            ariaLabel={imageInputLabel}
            oninput={() => void syncBackground()}
          >
            {#snippet suffix()}
              {#if uploadHost}
                <button type="button" class="ghost-button" onclick={() => onupload?.()}>
                  打开图床上传 ↗
                </button>
              {/if}
            {/snippet}
          </InputGroup>
        {/if}
        {#if !valid}
          <small class="warn">请填写{isLight ? '浅色' : '深色'}模式背景值。</small>
        {/if}
      </div>
    </div>

    <div class="background-range-grid">
      <div class="field background-mask-field">
        <span>遮罩颜色 <Tooltip text="覆盖在背景图上的蒙层颜色，浅色模式推荐白/浅灰，深色推荐黑/深蓝。" /></span>
        <ColorAlphaInput
          bind:value={background.maskColor}
          bind:alpha={background.mask}
          onchange={() => void syncBackground()}
          placeholder={isLight ? '#ffffff' : '#000000'}
          inputLabel={`${title}遮罩颜色值`}
          swatchTitle={`选择${title}遮罩颜色`}
          alphaText={`${title}遮罩透明度`}
        />
      </div>

      <div class="field">
        <Slider
          label="模糊度"
          format="px"
          min={0}
          max={40}
          step={1}
          bind:value={background.blur}
          oninput={() => void syncBackground()}
        />
      </div>

      <div class="field">
        <Slider
          label="遮罩透明度"
          format="ratio-percent"
          min={0}
          max={1}
          step={0.05}
          bind:value={background.mask}
          oninput={() => void syncBackground()}
        />
      </div>
    </div>
  </div>
</section>

<style>
  .theme-background-card {
    display: grid;
    gap: 10px;
    min-width: 0;
    border: 1px solid var(--sp-theme-card-border);
    border-radius: 14px;
    padding: 12px;
    background: var(--sp-theme-card-bg);
  }

  .theme-background-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .theme-background-header strong {
    color: var(--sp-heading);
    font-size: 14px;
  }

  .theme-background-header span {
    border-radius: 999px;
    background: var(--sp-chip-sky-bg);
    color: var(--sp-chip-sky-text);
    font-size: 12px;
    font-weight: 600;
    padding: 3px 8px;
  }

  .background-form {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  .background-main-row {
    display: grid;
    grid-template-columns: minmax(120px, 0.5fr) minmax(240px, 1.5fr);
    gap: 10px;
    min-width: 0;
    align-items: start;
  }

  .background-range-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    min-width: 0;
  }

  .field {
    display: grid;
    gap: 6px;
  }

  .background-type-field,
  .background-value-field {
    min-width: 0;
    align-content: start;
  }

  .background-value-field {
    min-width: 0;
  }

  .background-type-options {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    border: 1px solid var(--sp-input-border);
    border-radius: 10px;
    padding: 3px;
    background: var(--sp-input-bg);
  }

  .background-type-options label {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 32px;
    border-radius: 7px;
    color: var(--sp-muted);
    font-size: 12px;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .background-type-options label.active {
    background: var(--sp-chip-bg);
    color: var(--sp-chip-text);
    font-weight: 650;
  }

  .background-type-options label span {
    color: inherit;
    font-size: 12px;
    font-weight: inherit;
  }

  .background-type-options input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .background-type-options label:focus-within {
    outline: 2px solid var(--sp-accent);
    outline-offset: 1px;
  }

  .background-mask-field {
    min-width: 0;
  }

  .background-value-field .ghost-button {
    flex: 0 0 auto;
    padding-inline: 12px;
  }

  .field span {
    color: var(--sp-label);
    font-size: 14px;
    font-weight: 600;
  }

  small {
    color: var(--sp-muted);
    line-height: 1.55;
  }

  small.warn {
    color: var(--sp-warn);
  }

  input:not([type='radio']):not([type='checkbox']) {
    --select-hover-border: var(--sp-input-hover-border);
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--sp-input-border);
    border-radius: 10px;
    padding: 9px 11px;
    font-size: 14px;
    color: var(--sp-input-text);
    background-color: var(--sp-input-bg);
    font-family: inherit;
    transition:
      border-color var(--transition-base),
      box-shadow var(--transition-base),
      background var(--transition-base);
  }

  input:focus-visible {
    outline: none;
    border-color: var(--sp-accent);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .ghost-button {
    border: 1px solid var(--sp-input-border);
    border-radius: 10px;
    background: var(--sp-input-bg);
    color: var(--sp-text);
    padding: 10px 16px;
    font-size: 14px;
    cursor: pointer;
    transition:
      border-color var(--transition-base),
      background var(--transition-base),
      color var(--transition-base),
      transform var(--transition-base);
    white-space: nowrap;
  }

  .ghost-button:hover:not(:disabled) {
    border-color: var(--sp-input-hover-border);
    background: var(--sp-toggle-hover-bg);
  }

  .ghost-button:disabled,
  input:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  @media (max-width: 720px) {
    .background-main-row,
    .background-range-grid {
      grid-template-columns: 1fr;
    }

    .background-type-field,
    .background-type-options {
      width: 100%;
      min-width: 0;
    }
    .background-value-field .ghost-button {
      width: 100%;
    }
  }

  @container settings-editor (max-width: 660px) {
    .background-main-row,
    .background-range-grid {
      grid-template-columns: 1fr;
    }
    .background-value-field .ghost-button {
      width: 100%;
    }
  }
</style>
