<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { useNetworksStore } from "../../stores/networks";
import { useWalletStore } from "../../stores/wallet";
import type { AddressBookEntry } from "../../types/wallet";
import { formatRelativeTime, shortenAddress } from "../../utils/format";

const networksStore = useNetworksStore();
const walletStore = useWalletStore();

const { activeNetwork } = storeToRefs(networksStore);
const { addressBookCount } = storeToRefs(walletStore);

const contactLabel = ref("");
const contactAddress = ref("");
const contactNote = ref("");
const formErrors = ref<string[]>([]);
const feedback = ref<null | { tone: "success" | "error"; message: string }>(null);
const contactFormRef = ref<HTMLElement | null>(null);
const copiedContactId = ref<string | null>(null);

const contacts = computed(() => walletStore.contactsForNetwork(activeNetwork.value.id));
const activeNetworkContactCount = computed(() => contacts.value.length);
const currentDraftMatch = computed(() =>
  walletStore.findAddressBookEntry(activeNetwork.value.id, contactAddress.value),
);

function resetForm() {
  contactLabel.value = "";
  contactAddress.value = "";
  contactNote.value = "";
  formErrors.value = [];
  feedback.value = null;
}

function editContact(entry: AddressBookEntry) {
  contactLabel.value = entry.label;
  contactAddress.value = entry.address;
  contactNote.value = entry.note;
  formErrors.value = [];
  feedback.value = null;
  contactFormRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyContactAddress(entry: AddressBookEntry) {
  try {
    await navigator.clipboard.writeText(entry.address);
    copiedContactId.value = entry.id;
    window.setTimeout(() => {
      if (copiedContactId.value === entry.id) {
        copiedContactId.value = null;
      }
    }, 2000);
  } catch {
    // Ignore clipboard failure
  }
}

function saveContact() {
  formErrors.value = [];
  feedback.value = null;

  const existingEntry = currentDraftMatch.value;
  const result = walletStore.upsertAddressBookEntry({
    networkId: activeNetwork.value.id,
    label: contactLabel.value,
    address: contactAddress.value,
    note: contactNote.value,
  });

  if (!result.ok) {
    formErrors.value = result.errors;
    return;
  }

  feedback.value = {
    tone: "success",
    message: existingEntry ? "联系人已更新" : "联系人已保存到本地地址簿",
  };
  contactLabel.value = "";
  contactAddress.value = "";
  contactNote.value = "";
  formErrors.value = [];
}

function deleteContact(entry: AddressBookEntry) {
  walletStore.removeAddressBookEntry(entry.id);

  if (contactAddress.value.trim().toLowerCase() === entry.address.toLowerCase()) {
    resetForm();
  }

  feedback.value = {
    tone: "success",
    message: "联系人已从本地地址簿移除",
  };
}
</script>

<template>
  <WalletChrome
    eyebrow="常用联系人"
    title="地址簿"
    subtitle="管理常用收款地址与联系人备注，转账时一键填入"
    :show-nav="false"
  >
    <template #actions>
      <RouterLink class="button button--secondary button--small" :to="{ name: 'wallet-send' }">去转账</RouterLink>
      <RouterLink class="button button--ghost button--small" to="/settings">返回设置</RouterLink>
    </template>

    <!-- Top Compact Network Indicator -->
    <section class="section-card" style="padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="meta-pill">{{ activeNetwork.name }}</span>
        <span style="font-size: 0.8rem; color: var(--text-secondary);">
          当前网络共 <strong>{{ activeNetworkContactCount }}</strong> 位联系人
        </span>
      </div>
      <span style="font-size: 0.74rem; color: var(--text-muted);">
        本地总计 {{ addressBookCount }} 个联系人
      </span>
    </section>

    <!-- Saved Contacts List (Top Priority) -->
    <section class="page-grid page-grid--1">
      <SectionCard title="已保存联系人" :description="`${activeNetwork.name} 网络下的联系人列表`">
        <div v-if="contacts.length" class="address-contact-list scroll-container--compact">
          <article v-for="entry in contacts" :key="entry.id" class="address-contact-card">
            <div class="address-contact-card__top">
              <div class="address-contact-card__identity">
                <div class="address-contact-card__avatar">
                  {{ entry.label.slice(0, 1).toUpperCase() }}
                </div>
                <div class="address-contact-card__info">
                  <strong>{{ entry.label }}</strong>
                  <div class="address-contact-card__addr-row">
                    <span>{{ shortenAddress(entry.address) }}</span>
                    <button
                      class="address-contact-card__copy"
                      type="button"
                      @click="copyContactAddress(entry)"
                    >
                      {{ copiedContactId === entry.id ? "已复制" : "复制" }}
                    </button>
                  </div>
                </div>
              </div>
              <span class="address-contact-card__usage">
                {{ entry.lastUsedAt ? `${formatRelativeTime(entry.lastUsedAt)} 使用` : "未使用" }}
              </span>
            </div>

            <p class="address-contact-card__full-addr">{{ entry.address }}</p>
            <p v-if="entry.note" class="helper-text address-contact-card__note">{{ entry.note }}</p>

            <div class="address-contact-card__actions">
              <RouterLink
                class="button button--secondary button--small"
                :to="{ name: 'wallet-send', query: { recipient: entry.address } }"
              >
                发送
              </RouterLink>
              <button class="button button--ghost button--small" type="button" @click="editContact(entry)">
                编辑
              </button>
              <button class="button button--danger button--small" type="button" @click="deleteContact(entry)">
                删除
              </button>
            </div>
          </article>
        </div>
        <p v-else class="empty-state">
          当前网络还没有保存联系人。在下方表单中录入，或从发送页自动保存。
        </p>
      </SectionCard>
    </section>

    <!-- Add / Edit Contact Form -->
    <section ref="contactFormRef" class="page-grid page-grid--1">
      <SectionCard :title="currentDraftMatch ? '编辑联系人' : '添加联系人'" description="设置收款地址别名与备注">
        <form class="form-grid" @submit.prevent="saveContact">
          <div class="form-grid-row-2">
            <label class="field">
              <span>联系人名称</span>
              <input v-model="contactLabel" autocomplete="off" placeholder="例如：Main Treasury" />
            </label>

            <label class="field">
              <span>联系人地址</span>
              <input v-model="contactAddress" autocomplete="off" placeholder="0x..." />
            </label>
          </div>

          <label class="field">
            <span>备注</span>
            <input
              v-model="contactNote"
              placeholder="例如：打款专用地址 / 交易所充值地址"
            />
          </label>

          <p v-if="currentDraftMatch" class="helper-text">
            当前地址已存在于地址簿中，再次保存会直接更新该联系人。
          </p>

          <ul v-if="formErrors.length" class="bullet-list helper-text helper-text--error">
            <li v-for="error in formErrors" :key="error">{{ error }}</li>
          </ul>

          <p
            v-if="feedback"
            :class="['helper-text', feedback.tone === 'error' ? 'helper-text--error' : 'helper-text--success']"
          >
            {{ feedback.message }}
          </p>

          <div class="form-actions form-actions--compact">
            <button class="button button--primary button--small" type="submit">
              {{ currentDraftMatch ? "更新联系人" : "保存联系人" }}
            </button>
            <button class="button button--ghost button--small" type="button" @click="resetForm">清空表单</button>
          </div>
        </form>
      </SectionCard>
    </section>

    <!-- Safety Notes (Collapsible) -->
    <details class="collapsible-card">
      <summary class="collapsible-summary">
        <span style="display: flex; align-items: center; gap: 6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          地址簿安全与本地加密提示
        </span>
        <span class="collapsible-chevron">›</span>
      </summary>
      <div class="collapsible-content">
        <p class="helper-text" style="margin: 0 0 6px;">联系人仅保存在当前设备本地，不会上传至任何服务器，也绝不触碰私钥或密码。</p>
        <p class="helper-text" style="margin: 0 0 8px;">地址簿按网络隔离，避免相同地址在不同链网络下被误发。</p>
        <div class="inline-actions">
          <RouterLink class="button button--secondary button--small" :to="{ name: 'wallet-send' }">去发送页</RouterLink>
          <RouterLink class="button button--ghost button--small" to="/settings/networks">切换网络</RouterLink>
        </div>
      </div>
    </details>
  </WalletChrome>
</template>

<style scoped>
.address-contact-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.address-contact-card {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.address-contact-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.address-contact-card__identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.address-contact-card__avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 700;
  flex-shrink: 0;
}

.address-contact-card__info {
  min-width: 0;
  flex: 1;
}

.address-contact-card__info strong {
  display: block;
  font-size: 0.92rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.address-contact-card__addr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.address-contact-card__copy {
  padding: 1px 6px;
  font-size: 0.66rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--text-secondary);
  white-space: nowrap;
}

.address-contact-card__usage {
  font-size: 0.72rem;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.address-contact-card__full-addr {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-muted);
  word-break: break-all;
}

.address-contact-card__note {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-secondary);
}

.address-contact-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.address-contact-card__actions > * {
  flex: 1;
}
</style>
