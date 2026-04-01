import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { pinia } from "./stores";
import { useOnboardingStore } from "./stores/onboarding";
import { useSessionStore } from "./stores/session";
import "./styles/main.css";

const app = createApp(App);

app.use(pinia);
await useSessionStore(pinia).bootstrap();
await useOnboardingStore(pinia).bootstrap();
app.use(router);
app.mount("#app");
