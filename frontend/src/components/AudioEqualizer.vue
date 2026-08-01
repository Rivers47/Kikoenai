<template>
  <!--
    AudioEqualizer – kept for the flipLeftRightChannel function.
    UI will be added later.
  -->
  <div style="display: none"></div>
</template>

<script>

export default {
  name: 'AudioEqualizer',

  methods: {
    /**
     * Flip or restore left/right audio channels.
     * @param {boolean} flip - true to swap channels, false to restore.
     * Requires this.$store.state.AudioPlayer.audioAnalyser to be set.
     */
    flipLeftRightChannel(flip) {
      // The audio analyser is stored in the store by AudioElement after the future UI initializes it
      const analyser = this.$store.state.AudioPlayer.audioAnalyser;
      if (!analyser) return;
      const {audioSrc, merger, splitter, audioCtx, left, right} = analyser;
      if (flip) {
        // disconnect direct source
        audioSrc.disconnect(audioCtx.destination);

        // analyser flip
        splitter.disconnect();
        splitter.connect(right, 0); // 0 for output of right
        splitter.connect(left, 1); // 1 for output of left

        // audio flip and merge
        splitter.connect(merger, 0, 1);
        splitter.connect(merger, 1, 0);
        merger.connect(audioCtx.destination);

      } else {
        // disconnect flipped source
        merger.disconnect();

        splitter.disconnect(); // break up analyser and merger

        // reconnect analyser
        splitter.connect(left, 0);
        splitter.connect(right, 1);

        // normal source
        audioSrc.connect(audioCtx.destination);
      }
    }
  }
}
</script>

<style scoped lang="scss">
</style>