import next from "eslint-config-next";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts",
      "forex-analyzer/**",
    ],
  },
  ...next,
];

export default config;
