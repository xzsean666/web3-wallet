import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { bootstrapUiState } from "./services/uiState";
import { pinia } from "./stores";
import { useOnboardingStore } from "./stores/onboarding";
import { useSessionStore } from "./stores/session";
import "./styles/main.css";

const app = createApp(App);

app.use(pinia);
await bootstrapUiState();
await useSessionStore(pinia).bootstrap();
await useOnboardingStore(pinia).bootstrap();
app.use(router);
app.mount("#app");
