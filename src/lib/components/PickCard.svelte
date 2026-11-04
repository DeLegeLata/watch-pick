<script lang="ts">
  import { ratingLabel, runtimeLabel } from '../engine';
  import { OPEN_LABEL, SERVICE_LABEL, SLOT_LABEL, type Pick } from '../model';

  let {
    pick,
    saved = false,
    onreject,
    onsave
  }: { pick: Pick; saved?: boolean; onreject: (p: Pick) => void; onsave?: (p: Pick) => void } = $props();

  const meta = $derived([runtimeLabel(pick), ratingLabel(pick)].filter(Boolean).join(' · '));
  // A show they're partway through needs no saving for later.
  const canSave = $derived(!!onsave && pick.slot !== 'resume');
  let posterFailed = $state(false);
</script>

<article class="card pick" class:resume={pick.slot === 'resume'}>
  <div class="poster" aria-hidden="true">
    {#if pick.poster && !posterFailed}
      <img src={pick.poster} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (posterFailed = true)} />
    {:else}
      <span>{pick.title.slice(0, 1)}</span>
    {/if}
  </div>
  <div class="body">
    <p class="slot">{SLOT_LABEL[pick.slot]}</p>
    <h3>{pick.title}{#if pick.year}<span class="year">{` ${pick.year}`}</span>{/if}</h3>
    <p class="meta">{meta}</p>
    <p class="badge" data-service={pick.service}>{SERVICE_LABEL[pick.service]}</p>
    <p class="why">{pick.why}</p>
  </div>
  <div class="actions" class:three={pick.link && canSave}>
    {#if pick.link}
      <a class="button primary" href={pick.link} target="_blank" rel="noopener">{OPEN_LABEL[pick.service]}</a>
    {/if}
    {#if canSave}
      <button
        class="ghost save"
        class:on={saved}
        aria-pressed={saved}
        aria-label={saved ? 'On the watchlist (tap to take it off)' : 'Save to the watchlist'}
        onclick={() => onsave?.(pick)}>{saved ? '✓ Saved' : 'Save'}</button
      >
    {/if}
    <button class="ghost" onclick={() => onreject(pick)}>{pick.slot === 'resume' ? "Wasn't us…" : 'Not for us…'}</button>
  </div>
</article>
