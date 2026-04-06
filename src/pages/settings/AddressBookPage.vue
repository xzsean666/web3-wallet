<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { useNetworksStore } from "../../stores/networks";
import { useWalletStore } from "../../stores/wallet";
import type { AddressBookEntry } from "../../types/wallet";
import { formatDateTime, formatRelativeTime, shortenAddress } from "../../utils/format";

const networksStore = useNetworksStore();
const walletStore = useWalletStore();

const { activeNetwork } = storeToRefs(networksStore);
const { addressBookCount } = storeToRefs(walletStore);

const contactLabel = ref("");
const contactAddress = ref("");
const contactNote = ref("");
const formErrors = ref<string[]>([]);
const feedback = ref<null | { tone: "success" | "error"; message: string }>(null);

const contacts = computed(() => walletStore.contactsForNetwork(activeNetwork.value.id));
const newestContactTimestamp = computed(
  () => contacts.value[0]?.lastUsedAt ?? contacts.value[0]?.updatedAt ?? null,
);
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
    eyebrow="Address Book"
    title="正式地址簿让发送页不再只靠临时记录。"
    subtitle="联系人标签、备注和网络归属只保存在当前设备的本地 UI 状态里，不会进入链上或云端。"
  >
    <template #actions>
      <RouterLink class="button button--secondary" :to="{ name: 'wallet-send' }">去发送页</RouterLink>
      <RouterLink class="button button--ghost" to="/settings">返回设置</RouterLink>
    </template>

    <section class="status-grid">
      <SectionCard title="Current Network" description="当前正在管理的网络">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>Chain ID {{ activeNetwork.chainId }}</p>
      </SectionCard>

      <SectionCard title="Network Contacts" description="当前网络联系人数量" tone="accent">
        <p class="metric-value">{{ activeNetworkContactCount }}</p>
        <p>{{ activeNetwork.symbol }} 地址簿</p>
      </SectionCard>

      <SectionCard title="All Contacts" description="当前设备本地联系人总数">
        <p class="metric-value">{{ addressBookCount }}</p>
        <p>仅保存在本地 UI 状态</p>
      </SectionCard>

      <SectionCard title="Latest Update" description="最近一次联系人变更">
        <p class="metric-value">{{ newestContactTimestamp ? formatRelativeTime(newestContactTimestamp) : "N/A" }}</p>
        <p>{{ formatDateTime(newestContactTimestamp) }}</p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Save Contact" description="当前网络下的新建或更新联系人">
        <form class="form-grid" @submit.prevent="saveContact">
          <label class="field">
            <span>联系人名称</span>
            <input v-model="contactLabel" autocomplete="off" placeholder="例如：Main Treasury" />
          </label>

          <label class="field">
            <span>联系人地址</span>
            <input v-model="contactAddress" autocomplete="off" placeholder="0x..." />
          </label>

          <label class="field">
            <span>备注</span>
            <textarea
              v-model="contactNote"
              placeholder="例如：打款专用地址 / 交易所充值地址"
              rows="3"
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

          <div class="form-actions">
            <button class="button button--primary" type="submit">
              {{ currentDraftMatch ? "更新联系人" : "保存联系人" }}
            </button>
            <button class="button button--ghost" type="button" @click="resetForm">清空表单</button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Usage Notes" description="MVP 阶段的地址簿边界">
        <div class="card-stack">
          <p class="helper-text">联系人只保存在当前设备的本地 UI 状态，不会写入链上，也不会触碰助记词、私钥或密码。</p>
          <p class="helper-text">地址簿按网络拆分，避免同一 EVM 地址在不同网络下被误当成同一业务目标。</p>
          <p class="helper-text">从这里或发送页选中联系人后，会直接回填收款地址；金额仍需要你手动确认。</p>
        </div>
        <div class="form-actions">
          <RouterLink class="button button--secondary" :to="{ name: 'wallet-send' }">使用地址簿发送</RouterLink>
          <RouterLink class="button button--ghost" to="/settings/networks">切换网络</RouterLink>
        </div>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--1">
      <SectionCard title="Saved Contacts" :description="`${activeNetwork.name} 网络下的已保存联系人`">
        <div v-if="contacts.length" class="token-list">
          <article v-for="entry in contacts" :key="entry.id" class="token-row">
            <div class="token-row__content">
              <strong>{{ entry.label }}</strong>
              <p class="token-row__address">{{ shortenAddress(entry.address) }} · {{ entry.address }}</p>
              <p v-if="entry.note">{{ entry.note }}</p>
            </div>
            <div class="token-row__meta">
              <strong class="token-row__timestamp">
                {{ entry.lastUsedAt ? `${formatRelativeTime(entry.lastUsedAt)} 使用` : "未使用" }}
              </strong>
              <span class="helper-text">更新于 {{ formatDateTime(entry.updatedAt) }}</span>
              <div class="inline-actions">
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
            </div>
          </article>
        </div>
        <p v-else class="empty-state">
          当前网络还没有保存联系人。你可以先从发送页保存常用地址，或者直接在这里手动录入。
        </p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
