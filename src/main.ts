import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { bootstrapMobileViewport } from "./services/mobileViewport";
import { bootstrapUiState } from "./services/uiState";
import { pinia } from "./stores";
import { useOnboardingStore } from "./stores/onboarding";
import { useSessionStore } from "./stores/session";
import "./styles/main.css";

const app = createApp(App);

app.use(pinia);
bootstrapMobileViewport();
await bootstrapUiState();
await useSessionStore(pinia).bootstrap();
await useOnboardingStore(pinia).bootstrap();
app.use(router);
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__APP_ROUTER__ = router;
  (window as unknown as Record<string, unknown>).__APP_PINIA__ = pinia;
}
app.mount("#app");
