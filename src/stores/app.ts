import { defineStore } from "pinia";

export const useAppStore = defineStore("app", {
  state: () => ({
    projectName: "Web3 Wallet",
    status: "Scaffolded",
    targetPlatforms: ["Desktop", "Android", "iOS"] as string[],
  }),
});

