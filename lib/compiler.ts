// Single source of truth: this used to be a hand-maintained copy of
// plexo-sdk/src/utilities/compiler.ts that could silently drift from the
// compiler the drag-and-drop builder itself ships. Re-exporting the published
// package instead guarantees the server compiles designJson exactly the way
// the builder (and its editable blocks) expect.
export * from '@charisol/plexo-sdk/compiler';
