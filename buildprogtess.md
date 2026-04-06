# Build Progress

## 当前任务

- 状态：`completed`
- 任务：补齐派生账号分组展示能力
- 负责人：AI Agent

## 时间

- 开始时间：2026-04-02 19:56:00 CST
- 最后更新时间：2026-04-02 20:02:00 CST

## 目标

- 在账号管理页按恢复材料分组展示账号
- 让用户能清楚区分：
  - 独立导入账号
  - 同一助记词派生出来的多地址组
- 保持已有能力不回退：
  - 切换账号
  - 派生新地址
  - 重命名
  - 删除
- 保持安全边界不变：
  - 不新增敏感数据持久化
  - 不让助记词、私钥、密码进入前端持久化状态

## 范围

- 涉及文件：`src/`、`buildprogtess.md`
- 涉及平台：
  - accounts page UI
  - wallet grouping helper
  - unit tests
- 不包含：
  - 生物识别真实平台接入
  - NFT、Swap、WalletConnect
  - 任意合约交互

## 前置条件

- `node v24.2.0`
- `pnpm 10.12.1`
- 当前 Linux 环境仍缺少完整 Tauri 桌面构建依赖，因此本轮以前端单测与构建为主验证路径

## 执行步骤

1. `[x]` 确认生物识别真实接入不适合当前 Linux/桌面路径
2. `[x]` 为账号页设计恢复材料分组数据结构
3. `[x]` 实现分组展示并复用现有账号操作
4. `[x]` 补充测试并运行验证

## 当前状态

- 派生账号分组展示已完成
- 账号页现在能按 `derivationGroupId` 归拢同组账号
- 组内仍保留切换、派生、重命名、删除能力

## 问题与风险

- 分组展示不能影响已有的派生、切换、删除和重命名交互
- root 账号可能已被删除，分组展示不能假设每组一定保留 `derivationIndex = 0`
- 当前环境仍缺少完整 Tauri 桌面依赖，`cargo check` 仍会被系统库缺失阻塞

## 处理记录

- 已确认官方 Tauri biometric 插件当前只支持 Android / iOS，不适合作为当前 Linux/桌面环境的下一步收口项
- 已将下一步改为派生账号分组展示，优先提升当前多账号管理的可读性
- 已新增钱包分组 helper：
  - `groupWalletProfiles`
  - `WalletProfileGroup`
- 已实现分组规则：
  - 以 `derivationGroupId` 归组
  - 当前激活账号所在组优先展示
  - 组内当前账号优先展示，其余账号按派生索引升序
  - group header 不假设 root 一定存在，而是选当前组最小派生索引账号作为主账号
- 已改造账号页：
  - 顶部统计增加账号组数量与可继续派生的助记词组数量
  - 主列表改为“组头 + 组内账号列表”
  - 原有派生 / 重命名 / 删除 / 切换交互保持不变
- 已补充测试：
  - `src/utils/__tests__/wallet.spec.ts` 增加分组排序与优先级断言

## 验证结果

- 已执行：
  - `pnpm test:unit` -> `8 passed / 35 passed`
  - `pnpm build` -> 通过

## 产物

- 前端：
  - 账号按恢复材料分组展示
  - 账号组统计信息
- 工具：
  - wallet grouping helper
- 测试：
  - wallet grouping helper tests

## 下一步

- 可继续评估生物识别真实接入，但当前官方 Tauri biometric 插件更适合 Android / iOS 路径
- 或继续做账号排序 / 筛选 / 搜索
