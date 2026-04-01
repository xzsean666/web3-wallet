export function shortenAddress(address: string, lead = 6, tail = 4) {
  if (!address) {
    return "";
  }

  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

export function formatChainLabel(chainId: number) {
  return `Chain ID ${chainId}`;
}

