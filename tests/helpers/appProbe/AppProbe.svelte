<svelte:options runes />
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { claimProbeName, probeLog, probes, type ProbeEntry } from './registry'

  const props: Record<string, unknown> = $props()
  const name = claimProbeName()
  const entry: ProbeEntry = probes[name] ?? { name, props, updates: {}, mounts: 0, destroyed: 0 }
  probes[name] = entry
  entry.props = props
  entry.mounts += 1
  probeLog.push(`mount:${name}`)

  for (const key of Object.keys(props)) {
    if (key.startsWith('$$')) continue
    const list: unknown[] = (entry.updates[key] = entry.updates[key] ?? [])
    $effect.pre(() => {
      list.push(props[key])
    })
  }

  onDestroy(() => {
    entry.destroyed += 1
    probeLog.push(`destroy:${name}`)
  })
</script>

<div data-probe={name}></div>
