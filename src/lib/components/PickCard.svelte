<script lang="ts">
  import { ratingLabel, runtimeLabel } from '../engine';
  import { SLOT_LABEL, type Pick } from '../model';

  let { pick, onreject }: { pick: Pick; onreject: (p: Pick) => void } = $props();

  const SERVICE = { prime: 'Prime Video', plex: 'On Plex', shudder: 'Shudder on Prime' };
  const OPEN = { prime: 'Open in Prime', plex: 'Open in Plex', shudder: 'Open in Prime' };
  const service = $derived(SERVICE[pick.service]);
  const open = $derived(OPEN[pick.service]);
  const meta = $derived([runtimeLabel(pick), ratingLabel(pick)].filter(Boolean).join(' · '));
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
    <p class="badge" data-service={pick.service}>{service}</p>
    <p class="why">{pick.why}</p>
  </div>
  <div class="actions">
    {#if pick.link}
      <a class="button primary" href={pick.link} target="_blank" rel="noopener">{open}</a>
    {/if}
    <button class="ghost" onclick={() => onreject(pick)}>{pick.slot === 'resume' ? "Wasn't us…" : 'Not for us…'}</button>
  </div>
</article>
