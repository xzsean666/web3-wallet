import { createRouter, createWebHistory } from "vue-router";
import { pinia } from "../stores";
import { useOnboardingStore } from "../stores/onboarding";
import { useSessionStore } from "../stores/session";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/welcome",
    },
    {
      path: "/welcome",
      name: "welcome",
      component: () => import("../pages/WelcomePage.vue"),
      meta: { guestOnly: true },
    },
    {
      path: "/onboarding/create",
      name: "create-wallet",
      component: () => import("../pages/onboarding/CreateWalletPage.vue"),
      meta: { guestOnly: true, blocksWhenPendingDraft: true },
    },
    {
      path: "/onboarding/import",
      name: "import-wallet",
      component: () => import("../pages/onboarding/ImportWalletPage.vue"),
      meta: { guestOnly: true, blocksWhenPendingDraft: true },
    },
    {
      path: "/onboarding/backup",
      name: "backup-wallet",
      component: () => import("../pages/onboarding/BackupPhrasePage.vue"),
      meta: { requiresPendingBackup: true },
    },
    {
      path: "/unlock",
      name: "unlock",
      component: () => import("../pages/onboarding/UnlockWalletPage.vue"),
      meta: { requiresWallet: true },
    },
    {
      path: "/wallet",
      name: "wallet-home",
      component: () => import("../pages/wallet/WalletHomePage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/wallet/send",
      name: "wallet-send",
      component: () => import("../pages/wallet/SendPage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/wallet/receive",
      name: "wallet-receive",
      component: () => import("../pages/wallet/ReceivePage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/wallet/token/add",
      name: "wallet-token-add",
      component: () => import("../pages/wallet/AddTokenPage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/wallet/token/:tokenId",
      name: "wallet-token-detail",
      component: () => import("../pages/wallet/TokenDetailPage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/wallet/tx/:txHash",
      name: "wallet-tx-detail",
      component: () => import("../pages/wallet/TransactionDetailPage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/settings/networks",
      name: "network-settings",
      component: () => import("../pages/settings/NetworksPage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/settings/accounts",
      name: "account-settings",
      component: () => import("../pages/settings/AccountsPage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/settings/accounts/create",
      name: "account-create",
      component: () => import("../pages/onboarding/CreateWalletPage.vue"),
      meta: { requiresUnlocked: true, blocksWhenPendingDraft: true },
    },
    {
      path: "/settings/accounts/import",
      name: "account-import",
      component: () => import("../pages/onboarding/ImportWalletPage.vue"),
      meta: { requiresUnlocked: true, blocksWhenPendingDraft: true },
    },
    {
      path: "/settings/address-book",
      name: "address-book-settings",
      component: () => import("../pages/settings/AddressBookPage.vue"),
      meta: { requiresUnlocked: true },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../pages/settings/SettingsPage.vue"),
      meta: { requiresUnlocked: true },
    },
  ],
});

router.beforeEach((to) => {
  const sessionStore = useSessionStore(pinia);
  const onboardingStore = useOnboardingStore(pinia);

  if (to.meta.requiresPendingBackup && !onboardingStore.hasPendingBackup) {
    return sessionStore.hasWallet ? "/wallet" : "/welcome";
  }

  if (to.meta.requiresPendingBackup && sessionStore.hasWallet && !sessionStore.isUnlocked) {
    return "/unlock";
  }

  if (to.meta.requiresUnlocked) {
    if (!sessionStore.hasWallet) {
      return "/welcome";
    }

    if (!sessionStore.isUnlocked) {
      return "/unlock";
    }
  }

  if (to.meta.requiresWallet && !sessionStore.hasWallet) {
    return "/welcome";
  }

  if (to.meta.blocksWhenPendingDraft && onboardingStore.hasPendingDraft) {
    return "/onboarding/backup";
  }

  if (to.meta.guestOnly && sessionStore.hasWallet) {
    return sessionStore.isUnlocked ? "/wallet" : "/unlock";
  }

  return true;
});

router.afterEach((to) => {
  const sessionStore = useSessionStore(pinia);
  sessionStore.updateLastVisitedRoute(to.fullPath);
});
