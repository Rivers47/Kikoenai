/*
Async download/cache orchestration lives in src/utils/downloads.js, not here --
this store only holds the downloaded-files manifest (see module-AudioPlayer,
which follows the same pattern: components call plain functions/$axios
directly and commit mutations, no Vuex actions in use anywhere in this app).
*/
