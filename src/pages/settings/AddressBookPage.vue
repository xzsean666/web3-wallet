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

    <section class="page-grid page-grid--2">
      <!-- Add / Edit Contact Form -->
      <SectionCard :title="currentDraftMatch ? '编辑联系人' : '添加联系人'" description="设置收款地址别名与备注">
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
              rows="2"
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

      <!-- Usage Notes Card -->
      <SectionCard title="安全提示" description="本地加密与离线存储">
        <div class="card-stack" style="gap: 8px;">
          <p class="helper-text">联系人仅保存在当前设备本地，不会上传至任何服务器，也绝不触碰私钥或密码。</p>
          <p class="helper-text">地址簿按网络隔离，避免相同地址在不同链网络下被误发。</p>
          <p class="helper-text">从列表点击“发送”可直接回填收款地址，转账金额仍需在发送页手动确认。</p>
        </div>
        <div class="form-actions" style="margin-top: 10px;">
          <RouterLink class="button button--secondary button--small" :to="{ name: 'wallet-send' }">去发送页</RouterLink>
          <RouterLink class="button button--ghost button--small" to="/settings/networks">切换网络</RouterLink>
        </div>
      </SectionCard>
    </section>

    <!-- Saved Contacts List -->
    <section class="page-grid page-grid--1">
      <SectionCard title="已保存联系人" :description="`${activeNetwork.name} 网络下的联系人列表`">
        <div v-if="contacts.length" class="token-list">
          <article v-for="entry in contacts" :key="entry.id" class="token-row">
            <div class="token-row__content">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 28px; height: 28px; border-radius: var(--radius-full); background: linear-gradient(135deg, #6366f1, #06b6d4); display: grid; place-items: center; color: #fff; font-size: 0.75rem; font-weight: 700;">
                  {{ entry.label.slice(0, 1).toUpperCase() }}
                </div>
                <strong>{{ entry.label }}</strong>
              </div>
              <p class="token-row__address" style="margin-top: 4px;">{{ shortenAddress(entry.address) }} · {{ entry.address }}</p>
              <p v-if="entry.note" class="helper-text" style="margin: 2px 0 0;">{{ entry.note }}</p>
            </div>
            <div class="token-row__meta">
              <strong class="token-row__timestamp">
                {{ entry.lastUsedAt ? `${formatRelativeTime(entry.lastUsedAt)} 使用` : "未使用" }}
              </strong>
              <div class="inline-actions" style="margin-top: 4px;">
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
          当前网络还没有保存联系人。在上方表单中录入，或从发送页自动保存。
        </p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
