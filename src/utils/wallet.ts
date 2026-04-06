import type { SecretKind, WalletProfile, WalletSource } from "../types/wallet";

export interface WalletProfileGroup {
  id: string;
  derivationGroupId: string;
  secretKind: SecretKind;
  source: WalletSource;
  primaryAccount: WalletProfile;
  accounts: WalletProfile[];
  accountCount: number;
  containsActiveAccount: boolean;
  nextDerivationIndex: number | null;
}

export function getNextMnemonicDerivationIndex(
  accounts: WalletProfile[],
  account: WalletProfile,
) {
  const groupId = account.derivationGroupId || account.accountId;
  const relatedAccounts = accounts.filter(
    (entry) => entry.secretKind === "mnemonic" && entry.derivationGroupId === groupId,
  );

  const currentMaxIndex = relatedAccounts.reduce(
    (maxValue, entry) => Math.max(maxValue, entry.derivationIndex),
    0,
  );

  return currentMaxIndex + 1;
}

function getPrimaryAccount(accounts: WalletProfile[]) {
  return [...accounts].sort((left, right) => {
    if (left.derivationIndex !== right.derivationIndex) {
      return left.derivationIndex - right.derivationIndex;
    }

    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  })[0];
}

function getLatestCreatedAt(accounts: WalletProfile[]) {
  return Math.max(...accounts.map((entry) => new Date(entry.createdAt).getTime()));
}

export function groupWalletProfiles(
  accounts: WalletProfile[],
  activeAccountId: string | null,
): WalletProfileGroup[] {
  const groupsMap = new Map<string, WalletProfile[]>();

  for (const account of accounts) {
    const groupId = account.derivationGroupId || account.accountId;
    const existing = groupsMap.get(groupId) ?? [];
    existing.push(account);
    groupsMap.set(groupId, existing);
  }

  return [...groupsMap.entries()]
    .map(([groupId, groupAccounts]) => {
      const primaryAccount = getPrimaryAccount(groupAccounts);
      const containsActiveAccount = groupAccounts.some((entry) => entry.accountId === activeAccountId);
      const orderedAccounts = [...groupAccounts].sort((left, right) => {
        if (left.accountId === activeAccountId) {
          return -1;
        }

        if (right.accountId === activeAccountId) {
          return 1;
        }

        if (left.derivationIndex !== right.derivationIndex) {
          return left.derivationIndex - right.derivationIndex;
        }

        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      });

      return {
        id: groupId,
        derivationGroupId: groupId,
        secretKind: primaryAccount.secretKind,
        source: primaryAccount.source,
        primaryAccount,
        accounts: orderedAccounts,
        accountCount: groupAccounts.length,
        containsActiveAccount,
        nextDerivationIndex:
          primaryAccount.secretKind === "mnemonic"
            ? getNextMnemonicDerivationIndex(groupAccounts, primaryAccount)
            : null,
      };
    })
    .sort((left, right) => {
      if (left.containsActiveAccount) {
        return -1;
      }

      if (right.containsActiveAccount) {
        return 1;
      }

      return getLatestCreatedAt(right.accounts) - getLatestCreatedAt(left.accounts);
    });
}
