// Vuex 4.1.0's package.json `exports` has no `types` condition, so bundler
// module resolution finds no declarations and every vuex import is `any`.
declare module 'vuex' {
  export * from 'vuex/types/index.d.ts'
}
