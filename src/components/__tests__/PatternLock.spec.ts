import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PatternLock from "../PatternLock.vue";

describe("PatternLock component", () => {
  it("renders 9 pattern dots", () => {
    const wrapper = mount(PatternLock, {
      props: {
        size: 260,
        status: "normal",
      },
    });

    const dots = wrapper.findAll(".pattern-dot-group");
    expect(dots).toHaveLength(9);
  });

  it("exposes reset and selectedDots", () => {
    const wrapper = mount(PatternLock);
    expect(wrapper.vm.selectedDots).toEqual([]);
    wrapper.vm.reset();
    expect(wrapper.vm.selectedDots).toEqual([]);
  });

  it("applies correct glow colors depending on status", async () => {
    const wrapper = mount(PatternLock, {
      props: {
        status: "success",
      },
    });

    // Manually set selected dots to test glow ring fill
    wrapper.vm.selectedDots.push(0);
    await wrapper.vm.$nextTick();

    const glow = wrapper.find(".pattern-dot-glow");
    expect(glow.exists()).toBe(true);
    expect(glow.attributes("fill")).toBe("rgba(16, 185, 129, 0.25)");

    await wrapper.setProps({ status: "error" });
    expect(wrapper.find(".pattern-dot-glow").attributes("fill")).toBe("rgba(239, 68, 68, 0.25)");

    await wrapper.setProps({ status: "normal" });
    expect(wrapper.find(".pattern-dot-glow").attributes("fill")).toBe("rgba(99, 102, 241, 0.25)");
  });
});
