module.exports = {
  class: "Market",
  version: "1.0.0",
  supportAbi1: true,
  proto: ["./proto/market.proto"],
  files: ["./Market.ts"],
  sourceDir: "./assembly",
  buildDir: "./build",
  filesImport: [],
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
