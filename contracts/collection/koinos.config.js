module.exports = {
  class: "OuroCollection",
  version: "1.0.0",
  supportAbi1: true,
  proto: ["./proto/collection.proto"],
  files: ["./OuroCollection.ts"],
  sourceDir: "./assembly",
  buildDir: "./build",
  // Pull in the audited base contract so its entry points (mint, transfer,
  // approve, metadata, royalties …) land in this ABI too.
  filesImport: [
    {
      dependency: "@koinosbox/contracts",
      path: "../node_modules/@koinosbox/contracts/assembly/nft/Nft.ts",
    },
  ],
  protoImport: [
    {
      name: "@koinosbox/contracts",
      path: "../node_modules/@koinosbox/contracts/koinosbox-proto",
      exclude: ["vapor"],
    },
    {
      name: "@koinos/sdk-as",
      path: "../node_modules/koinos-precompiler-as/koinos-proto/koinos",
    },
    {
      name: "__",
      path: "../node_modules/koinos-precompiler-as/koinos-proto/google",
    },
  ],
  deployOptions: {},
};
