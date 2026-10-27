<svelte:options runes />

<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { cloneSettingsForm, type SettingsFormModel } from '../../lib/settingsForm'
  import Switch from '../ui/Switch.svelte'
  import Tooltip from '../ui/Tooltip.svelte'

  interface Props {
    /** SettingsPanel 以 `bind:form` 传入；写回字段或整体替换都经 bindable setter 通知父组件。 */
    form: SettingsFormModel
    saving?: boolean
  }

  let { form = $bindable(), saving = false }: Props = $props()

  // 原 `$: form.card_show_description = form.card_description_mode === 'always'`：与原语句一样先于 DOM 更新执行，
  // 父组件每次通知 form（字段写回或整体替换）都会重跑。写回只在值不同时发生——字段写回经 bindable setter
  // 再次通知父组件，同值重写会让本段无限重跑（legacy 的 `$:` 每次刷新只跑一次，没有这个问题）。
  $effect.pre(() => {
    const showDescription = form.card_description_mode === 'always'
    untrack(() => {
      if (form.card_show_description !== showDescription) form.card_show_description = showDescription
    })
  })

  async function syncForm(): Promise<void> {
    await tick()
    form = cloneSettingsForm(form)
  }
</script>

<fieldset
  id="settings-section-card"
  class="group group-wide group-card"
  disabled={saving}
  oninput={() => void syncForm()}
  onchange={() => void syncForm()}
>
  <legend>卡片展示</legend>
  <div class="settings-subsection">
    <h3>卡片风格</h3>
    <div class="radio-group card-style-group">
      <label class="radio-option">
        <input type="radio" bind:group={form.card_style} value="info" />
        <div class="radio-content">
          <strong>详情风格</strong>
          <p>图文横排</p>
        </div>
      </label>

      <label class="radio-option">
        <input type="radio" bind:group={form.card_style} value="icon" />
        <div class="radio-content">
          <strong>极简风格</strong>
          <p>纯图标网格</p>
        </div>
      </label>
    </div>
  </div>

  {#if form.card_style === 'info'}
    <div class="settings-subsection description-mode-field">
      <h3>描述显示策略 <Tooltip text="仅在「详情风格」下生效；单个书签单独配置时优先级更高。" /></h3>
      <div class="radio-group compact">
        <label class="radio-option"><input type="radio" bind:group={form.card_description_mode} value="always" /><span>始终显示</span></label>
        <label class="radio-option"><input type="radio" bind:group={form.card_description_mode} value="hover" /><span>悬停显示</span></label>
        <label class="radio-option"><input type="radio" bind:group={form.card_description_mode} value="hidden" /><span>隐藏</span></label>
      </div>
    </div>
  {:else}
    <div class="settings-subsection icon-title-setting">
      <h3>极简风格标题</h3>
      <div class="field-switch">
        <span class="switch-copy">显示极简卡片标题 <Tooltip text="在图标下方显示书签名称，仅对极简风格生效。" /></span>
        <Switch
          checked={form.card_icon_show_title}
          ariaLabel="显示极简卡片标题"
          onchange={(checked) => { form.card_icon_show_title = checked; void syncForm() }}
        />
      </div>
    </div>
  {/if}

</fieldset>

<style>
  .radio-group {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .radio-group.compact {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .radio-option {
    display: flex;
    gap: 11px;
    align-items: flex-start;
    min-width: 0;
    border: 1px solid var(--sp-radio-border);
    border-radius: 12px;
    padding: 13px 14px;
    background: var(--sp-toggle-bg);
    cursor: pointer;
    transition: border-color var(--transition-base), background var(--transition-base);
  }

  .radio-option:hover {
    border-color: color-mix(in srgb, var(--sp-accent) 42%, var(--sp-radio-border));
    background: var(--sp-toggle-hover-bg);
  }

  .radio-option:focus-within {
    outline: 2px solid var(--sp-accent);
    outline-offset: 1px;
  }

  .card-style-group .radio-option:has(input:checked) {
    border-color: var(--sp-accent);
    box-shadow: 0 0 0 1px var(--sp-accent);
  }

  .field-switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid var(--sp-toggle-border);
    border-radius: 12px;
    padding: 13px 15px;
    background: var(--sp-toggle-bg);
  }

  .switch-copy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--sp-label);
    font-size: 14px;
    font-weight: 600;
  }

  .radio-option input[type='radio'] {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    margin: 1px 0 0;
    accent-color: var(--sp-accent);
  }

  .radio-content {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .radio-content strong {
    color: var(--sp-strong);
    font-size: 14px;
  }

  .radio-content p {
    margin: 0;
    color: var(--sp-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  @media (max-width: 620px) {
    .radio-group.compact {
      grid-template-columns: 1fr;
    }
  }

  @container settings-editor (max-width: 520px) {
    .radio-group.compact {
      grid-template-columns: 1fr;
    }
  }
</style>
