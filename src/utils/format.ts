export function shortenAddress(address: string, lead = 6, tail = 4) {
  if (!address) {
    return "";
  }

  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

export function formatChainLabel(chainId: number) {
  return `Chain ID ${chainId}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function formatRelativeTime(value: string | null | undefined, now = Date.now()) {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const diffMs = now - parsed.getTime();
  const diffSeconds = Math.round(diffMs / 1000);

  if (diffSeconds < 0) {
    return "即将";
  }

  if (diffSeconds < 60) {
    return "刚刚";
  }

  if (diffSeconds < 60 * 60) {
    return `${Math.floor(diffSeconds / 60)} 分钟前`;
  }

  if (diffSeconds < 60 * 60 * 24) {
    return `${Math.floor(diffSeconds / (60 * 60))} 小时前`;
  }

  if (diffSeconds < 60 * 60 * 24 * 7) {
    return `${Math.floor(diffSeconds / (60 * 60 * 24))} 天前`;
  }

  return formatDateTime(value);
}

export function formatTokenAmount(value: string | null | undefined, maximumFractionDigits = 6) {
  if (!value) {
    return "0";
  }

  const [rawWhole, rawFraction = ""] = value.split(".");
  const sign = rawWhole.startsWith("-") ? "-" : "";
  const whole = rawWhole.replace(/^-/, "").replace(/^0+(?=\d)/, "") || "0";
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = rawFraction.slice(0, maximumFractionDigits).replace(/0+$/, "");

  return fraction ? `${sign}${groupedWhole}.${fraction}` : `${sign}${groupedWhole}`;
}

export function formatActivityStatus(status: "pending" | "complete" | "reverted" | "empty") {
  switch (status) {
    case "pending":
      return "Pending";
    case "complete":
      return "Confirmed";
    case "reverted":
      return "Reverted";
    case "empty":
      return "Empty";
  }
}
