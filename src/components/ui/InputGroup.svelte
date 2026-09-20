<script lang="ts">
  // 数值/文本 + 后缀（单位或操作按钮）的一体化输入组。
  // 取代分散的 .inline-input + 外置按钮写法。
  // 用法：
  //   <InputGroup bind:value type="number" suffixUnit="px" />           常驻单位后缀
  //   <InputGroup bind:value>                                            默认 slot 放单位下拉
  //     <select slot="suffix" ...>...</select>
  //   </InputGroup>
  //   <InputGroup bind:value><button slot="suffix" ...>抓取</button></InputGroup>  内部后缀按钮
  import { createEventDispatcher } from 'svelte'

  export let value: string | number = ''
  export let type: 'text' | 'number' | 'url' = 'text'
  export let placeholder = ''
  export let disabled = false
  export let min: number | undefined = undefined
  export let max: number | undefined = undefined
  export let step: number | undefined = undefined
  export let ariaLabel: string | undefined = undefined
  export let inputId: string | undefined = undefined
  // 常驻单位后缀文本（如 px / %）；与 suffix slot 二选一
  export let suffixUnit: string | undefined = undefined

  const dispatch = createEventDispatcher<{ input: string | number; value: string | number }>()

  function handleInput(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value
    value = type === 'number' ? (raw === '' ? '' : Number(raw)) : raw
    // input 用于显式监听；value 让 <InputGroup bind:value> 遵循 Svelte 绑定约定。
    dispatch('value', value)
    dispatch('input', value)
  }
</script>

<div class="ui-input-group" class:disabled>
  <input
    id={inputId}
    class="ui-input-group-field"
    {type}
    {placeholder}
    {disabled}
    {min}
    {max}
    {step}
    value={value === '' ? '' : value}
    aria-label={ariaLabel}
    on:input={handleInput}
  />
  {#if suffixUnit}
    <span class="ui-input-group-unit" aria-hidden="true">{suffixUnit}</span>
  {:else}
    <span class="ui-input-group-suffix"><slot name="suffix" /></span>
  {/if}
</div>

<style>
  .ui-input-group {
    display: flex;
    align-items: stretch;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--sp-input-border, #cbd5e1);
    border-radius: 10px;
    background: var(--sp-input-bg, #ffffff);
    overflow: hidden;
    transition:
      border-color var(--transition-base),
      box-shadow var(--transition-base);
  }

  .ui-input-group:focus-within {
    border-color: var(--sp-accent, #2563eb);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .ui-input-group.disabled {
    opacity: 0.6;
  }

  .ui-input-group-field {
    flex: 1 1 0;
    min-width: 0;
    border: 0;
    padding: 9px 11px;
    font-size: 14px;
    font-family: inherit;
    color: var(--sp-input-text, #0f172a);
    background: transparent;
  }

  .ui-input-group-field:focus {
    outline: none;
  }

  .ui-input-group-unit {
    display: inline-flex;
    align-items: center;
    padding: 0 11px;
    font-size: 13px;
    color: var(--sp-muted, #64748b);
    border-left: 1px solid var(--sp-input-border, #cbd5e1);
    background: var(--sp-toggle-bg, #f8fafc);
  }

  .ui-input-group-suffix {
    display: inline-flex;
    align-items: center;
  }

  /* 后缀按钮（内部操作按钮）由 slot 提供，这里给它一个贴边样式钩子 */
  .ui-input-group-suffix :global(button),
  .ui-input-group-suffix :global(select) {
    height: 100%;
    border: 0;
    border-left: 1px solid var(--sp-input-border, #cbd5e1);
    border-radius: 0;
    background: var(--sp-toggle-bg, #f8fafc);
    color: var(--sp-text, #0f172a);
    padding: 0 12px;
    font-size: 13px;
    cursor: pointer;
  }

  .ui-input-group-suffix :global(button:disabled) {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
