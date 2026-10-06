'use strict';

// One media element keeps quotations from playing over one another.
class QuoteAudio {
  constructor(audio, onChange) {
    this.audio = audio;
    this.onChange = onChange;
    this.state = null;
    this.generation = 0;
    this.timer = null;
    this.pendingSeek = false;
    audio.addEventListener('loadedmetadata', () => {
      if (!this.state) return;
      if (!Number.isFinite(audio.duration) || this.state.start >= audio.duration) {
        this.fail();return;
      }
      this.state.end = Math.min(this.state.end, audio.duration);
      if (this.pendingSeek) this.seekStart();
    });
    audio.addEventListener('playing', () => {
      if (!this.state || this.state.status !== 'loading') return;
      this.state.status = 'playing';
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 50);
      this.changed();
    });
    audio.addEventListener('waiting', () => {
      if (this.state?.status === 'playing') {this.state.status = 'loading';this.changed();}
    });
    audio.addEventListener('pause', () => {
      if (audio.paused && this.state && ['playing', 'loading'].includes(this.state.status)) {
        if (!this.pendingSeek && audio.currentTime >= this.state.end) this.finish();
        else this.pause();
      }
    });
    audio.addEventListener('timeupdate', () => this.tick());
    audio.addEventListener('ended', () => this.finish());
    audio.addEventListener('error', () => {if (this.state) this.fail();});
  }
  changed() {this.onChange(this.state);}
  seekStart() {
    try {this.audio.currentTime = this.state.start;this.pendingSeek = false;}
    catch {this.pendingSeek = true;}
  }
  toggle(quote, episode) {
    if (!episode?.audio_url || !Number.isFinite(quote.start) || !Number.isFinite(quote.end) || quote.end <= quote.start) return;
    if (this.state?.id === quote.id && ['playing', 'loading'].includes(this.state.status)) {
      this.pause();return;
    }
    const resume = this.state?.id === quote.id && this.state.status === 'paused';
    if (!resume) {
      this.reset();
      this.state = {id: quote.id, start: quote.start, end: quote.end, status: 'loading', elapsed: 0};
      this.pendingSeek = true;
      // Media fragments also request the initial seek before playback on mobile.
      this.audio.src = `${episode.audio_url}#t=${quote.start},${quote.end}`;
      this.seekStart();
    } else {
      this.state.status = 'loading';
      if (this.audio.currentTime < this.state.start || this.audio.currentTime >= this.state.end) this.seekStart();
    }
    const generation = ++this.generation;
    this.changed();
    // Keep play() inside the user's click so Safari permits playback.
    try {
      const playing = this.audio.play();
      playing?.catch(() => {if (generation === this.generation) this.fail();});
    } catch {if (generation === this.generation) this.fail();}
  }
  pause() {
    if (!this.state) return;
    ++this.generation;
    clearInterval(this.timer);this.timer = null;
    this.state.status = 'paused';
    this.audio.pause();
    this.changed();
  }
  tick() {
    if (!this.state || this.pendingSeek || this.state.status === 'error') return;
    this.state.elapsed = Math.max(0, Math.min(this.audio.currentTime, this.state.end) - this.state.start);
    if (this.audio.currentTime >= this.state.end && ['playing', 'loading'].includes(this.state.status)) {
      this.finish();return;
    }
    this.changed();
  }
  finish() {
    if (!this.state) return;
    ++this.generation;
    clearInterval(this.timer);this.timer = null;
    this.state.status = 'ended';this.state.elapsed = this.state.end - this.state.start;
    this.audio.pause();
    this.changed();
  }
  fail() {
    if (!this.state) return;
    ++this.generation;
    clearInterval(this.timer);this.timer = null;
    this.state.status = 'error';
    this.audio.pause();
    this.changed();
  }
  reset() {
    ++this.generation;
    clearInterval(this.timer);this.timer = null;
    if (!this.state) return;
    this.state = null;this.pendingSeek = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.changed();
  }
}
