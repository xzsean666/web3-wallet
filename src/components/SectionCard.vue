<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    tone?: "default" | "accent" | "warning";
  }>(),
  {
    title: "",
    description: "",
    tone: "default",
  },
);
</script>

<template>
  <section :class="['section-card', `section-card--${tone}`]">
    <header v-if="title || description" class="section-card__header">
      <div>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <slot name="header" />
    </header>
    <slot />
  </section>
</template>

