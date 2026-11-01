<script lang="ts">
  import { onMount } from 'svelte';
  import type { Session } from '@supabase/supabase-js';
  import PickCard from './lib/components/PickCard.svelte';
  import ReasonSheet from './lib/components/ReasonSheet.svelte';
  import SignIn from './lib/components/SignIn.svelte';
  import { addFeedback, cached, forget, load, undoFeedback, type Snapshot } from './lib/data';
  import { demoPicks, demoRun } from './lib/demo';
  import { ago, chooseTonight, hiddenKeys } from './lib/engine';
  import { MOODS, REASONS, WINDOWS, type Feedback, type Mood, type Pick, type Reason } from './lib/model';
  import { configured, signOut, supabase } from './lib/supabase';

  const demo = new URLSearchParams(location.search).has('demo');

  let session = $state<Session | null>(null);
  let ready = $state(false);
  let snap = $state<Snapshot | null>(demo ? { household: 'demo', run: demoRun, picks: demoPicks, feedback: [] } : cached());
  let error = $state('');
  let rejecting = $state<Pick | null>(null);
  let toast = $state<{ text: string; undo?: () => void } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // The time and mood chips are remembered on this phone only.
  const saved = (k: string, fallback: string) => {
    try {
      return localStorage.getItem(k) ?? fallback;
    } catch {
      return fallback;
    }
  };
  let windowIndex = $state(Number(saved('watch-pick:window', '1')));
  let mood = $state<Mood | 'any'>(saved('watch-pick:mood', 'any') as Mood | 'any');
  let page = $state(0);
  // 0 is the refresh's own ranking; any other value is a shuffle.
  let seed = $state(0);
  let now = $state(new Date());

  $effect(() => {
    try {
      localStorage.setItem('watch-pick:window', String(windowIndex));
      localStorage.setItem('watch-pick:mood', mood);
    } catch {
      // Not remembering the chips is fine.
    }
  });

  const minutes = $derived(WINDOWS[windowIndex]?.minutes ?? 90);
  const hidden = $derived(hiddenKeys(snap?.feedback ?? [], now));
  const tonight = $derived(chooseTonight(snap?.picks ?? [], hidden, minutes, mood, page, seed));
  const stale = $derived(snap?.run ? Date.now() - Date.parse(snap.run.ran_at) > 10 * 86_400_000 : false);
  const MOOD_WORD: Record<Mood, string> = { laugh: 'funny', tense: 'tense', mystery: 'mystery', cozy: 'cozy' };
  const moodLabel = $derived(mood === 'any' ? '' : MOOD_WORD[mood]);

  async function refresh() {
    if (demo || !session) return;
    now = new Date();
    try {
      snap = await load();
      error = '';
    } catch (e) {
      error = snap ? 'Offline: showing the last picks this phone saw.' : e instanceof Error ? e.message : String(e);
    }
  }

  onMount(() => {
    if (demo || !supabase) {
      ready = true;
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      session = data.session;
      ready = true;
      refresh();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const signedIn = !session && s;
      session = s;
      if (signedIn) refresh();
    });
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  function say(text: string, undo?: () => void) {
    clearTimeout(toastTimer);
    toast = { text, undo };
    toastTimer = setTimeout(() => (toast = null), 6000);
  }

  async function reject(pick: Pick, reason: Reason) {
    rejecting = null;
    if (!snap) return;
    let row: Feedback;
    try {
      row = demo
        ? { id: crypto.randomUUID(), user_id: 'demo', key: pick.key, title: pick.title, reason, created_at: new Date().toISOString() }
        : await addFeedback(snap.household!, pick, reason);
    } catch (e) {
      say(`Couldn't save that: ${e instanceof Error ? e.message : e}`);
      return;
    }
    snap.feedback = [...snap.feedback, row];
    const label = REASONS.find((r) => r.id === reason)?.label ?? 'Hidden';
    say(`${label}: ${pick.title} is hidden.`, async () => {
      if (!snap) return;
      if (!demo) await undoFeedback(row.id).catch(() => say("Couldn't undo; try again with a signal."));
      snap.feedback = snap.feedback.filter((f) => f.id !== row.id);
      toast = null;
    });
  }

  async function leave() {
    forget();
    snap = null;
    await signOut();
  }
</script>

<main>
  <header>
    <h1>Tonight</h1>
    {#if snap?.run}
      <p class="muted">Picks updated {ago(snap.run.ran_at, now)}{demo ? ' (demo)' : ''}</p>
    {/if}
  </header>

  {#if !configured && !demo}
    <section class="card"><p>This build has no Supabase settings. Open it with <code>?demo</code> to look around.</p></section>
  {:else if !ready}
    <p class="muted center">Loading…</p>
  {:else if !session && !demo}
    <SignIn />
  {:else}
    <section class="chips" aria-label="How long have you got?">
      {#each WINDOWS as w, i (w.label)}
        <button class:on={windowIndex === i} aria-pressed={windowIndex === i} onclick={() => ((windowIndex = i), (page = 0))}>{w.label}</button>
      {/each}
    </section>
    <section class="chips" aria-label="In the mood for">
      {#each MOODS as m (m.id)}
        <button class:on={mood === m.id} aria-pressed={mood === m.id} onclick={() => ((mood = m.id), (page = 0))}>{m.label}</button>
      {/each}
    </section>

    {#if error}<p class="flag">{error}</p>{/if}
    {#if stale}<p class="flag">These picks are over 10 days old: the weekly refresh on the home PC hasn't run.</p>{/if}

    {#if !snap?.run}
      <section class="card"><p>No picks yet. They arrive after the first weekly refresh on the home PC.</p></section>
    {:else}
      {#if tonight.resume}
        <PickCard pick={tonight.resume} onreject={(p) => (rejecting = p)} />
      {/if}
      {#each tonight.cards as c (c.key)}
        <PickCard pick={c} onreject={(p) => (rejecting = p)} />
      {:else}
        <section class="card"><p>Nothing this week fits that. Try more time or another mood.</p></section>
      {/each}
      {#if tonight.topped && mood !== 'any'}
        <p class="muted small">Only a few {moodLabel} picks this week, so others fill in.</p>
      {/if}
      {#if tonight.more > 0}
        <div class="more">
          <button class="ghost" onclick={() => page++}>Show three others</button>
          <button class="ghost" onclick={() => ((seed = 1 + Math.floor(Math.random() * 2 ** 30)), (page = 0))}>Shuffle</button>
        </div>
        {#if seed}
          <button class="link back" onclick={() => ((seed = 0), (page = 0))}>Back to the top picks</button>
        {/if}
      {/if}
    {/if}

    {#if !demo}
      <footer><button class="link" onclick={leave}>Sign out</button></footer>
    {/if}
  {/if}
</main>

<ReasonSheet pick={rejecting} onchoose={reject} oncancel={() => (rejecting = null)} />

{#if toast}
  <div class="toast" role="status">
    <span>{toast.text}</span>
    {#if toast.undo}<button class="link" onclick={toast.undo}>Undo</button>{/if}
  </div>
{/if}
