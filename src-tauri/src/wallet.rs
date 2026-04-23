use std::{
    collections::{HashMap, HashSet},
    convert::TryFrom,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use alloy_consensus::{SignableTransaction, TxEip1559, TxEnvelope, TxLegacy, TypedTransaction};
use alloy_eips::eip2718::Encodable2718;
use alloy_primitives::{keccak256, Address, Bytes, TxKind, U256};
use alloy_signer::SignerSync;
use alloy_signer_local::PrivateKeySigner;
use bip39::{
    rand::{thread_rng, RngCore},
    Language, Mnemonic,
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use iota_stronghold::{KeyProvider, Stronghold};
use k256::{ecdsa::SigningKey, NonZeroScalar};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::Sha512;
use sha3::{Digest, Keccak256};
use tauri::{AppHandle, Manager, State};
use thiserror::Error;
use zeroize::Zeroizing;

const STRONGHOLD_CLIENT: &[u8] = b"wallet-core";
const STRONGHOLD_RECORD: &[u8] = b"primary-secret";
const SALT_LENGTH: usize = 32;
const PENDING_TRANSFER_CONFIRMATION_TTL_SECONDS: i64 = 300;
const SENSITIVE_ATTEMPT_RESET_SECONDS: i64 = 15 * 60;
const SENSITIVE_ATTEMPT_BASE_LOCK_SECONDS: i64 = 2;
const SENSITIVE_ATTEMPT_MAX_LOCK_SECONDS: i64 = 300;
const SENSITIVE_ATTEMPT_GRACE_FAILURES: u32 = 3;
const SENSITIVE_OPERATION_UNLOCK: &str = "unlock_wallet";
const SENSITIVE_OPERATION_SIGN_TRANSFER: &str = "sign_transfer_transaction";
const SENSITIVE_OPERATION_DELETE_ACCOUNT: &str = "delete_wallet_account";
const SENSITIVE_OPERATION_DERIVE_ACCOUNT: &str = "derive_mnemonic_account";
const SENSITIVE_OPERATION_GET_BACKUP_PHRASE: &str = "get_pending_backup_phrase";
const ETH_BIP44_PREFIX: [u32; 4] = [44 + BIP32_HARDEN, 60 + BIP32_HARDEN, 0 + BIP32_HARDEN, 0];
const BIP32_HARDEN: u32 = 0x8000_0000;

type HmacSha512 = Hmac<Sha512>;
type WalletCommandResult<T> = Result<T, WalletError>;

#[derive(Default)]
pub struct WalletRuntimeState {
    mutation_lock: Mutex<()>,
    pending_onboarding: Mutex<Option<PendingOnboarding>>,
    pending_transfer_confirmations: Mutex<HashMap<String, PendingTransferConfirmation>>,
    sensitive_operation_attempts: Mutex<HashMap<String, SensitiveOperationAttemptState>>,
}

#[derive(Debug, Clone)]
struct PendingOnboarding {
    backup_access_token: String,
    draft: PendingWalletDraft,
    has_revealed_backup_phrase: bool,
    snapshot_path: String,
}

#[derive(Debug, Clone)]
struct PendingTransferConfirmation {
    request: PreparedTransferRequest,
    prepared_at_unix_seconds: i64,
}

#[derive(Debug, Clone, Copy, Default)]
struct SensitiveOperationAttemptState {
    failed_attempts: u32,
    lock_until_unix_seconds: i64,
    last_failed_unix_seconds: i64,
}

#[derive(Debug)]
struct WalletPaths {
    metadata_db_path: PathBuf,
    salt_path: PathBuf,
}

#[derive(Debug)]
struct StoredWalletMetadata {
    account_id: String,
    derivation_group_id: String,
    derivation_index: u32,
    wallet_label: String,
    address: String,
    source: WalletSource,
    secret_kind: SecretKind,
    is_biometric_enabled: bool,
    has_backed_up_mnemonic: bool,
    created_at: String,
    last_unlocked_at: Option<String>,
    snapshot_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretKind {
    Mnemonic,
    PrivateKey,
}

impl SecretKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mnemonic => "mnemonic",
            Self::PrivateKey => "privateKey",
        }
    }

    fn from_db_value(value: &str) -> Result<Self, WalletError> {
        match value {
            "mnemonic" => Ok(Self::Mnemonic),
            "privateKey" => Ok(Self::PrivateKey),
            _ => Err(WalletError::MetadataCorrupted(
                "unknown secret kind in wallet metadata".into(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WalletSource {
    Created,
    Imported,
}

impl WalletSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Imported => "imported",
        }
    }

    fn from_db_value(value: &str) -> Result<Self, WalletError> {
        match value {
            "created" => Ok(Self::Created),
            "imported" => Ok(Self::Imported),
            _ => Err(WalletError::MetadataCorrupted(
                "unknown wallet source in wallet metadata".into(),
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWalletDraft {
    account_id: String,
    derivation_index: u32,
    wallet_label: String,
    address: String,
    is_biometric_enabled: bool,
    source: WalletSource,
    secret_kind: SecretKind,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletProfile {
    account_id: String,
    derivation_group_id: String,
    derivation_index: u32,
    wallet_label: String,
    address: String,
    source: WalletSource,
    secret_kind: SecretKind,
    is_biometric_enabled: bool,
    has_backed_up_mnemonic: bool,
    created_at: String,
    last_unlocked_at: Option<String>,
}

impl From<StoredWalletMetadata> for WalletProfile {
    fn from(value: StoredWalletMetadata) -> Self {
        Self {
            account_id: value.account_id,
            derivation_group_id: value.derivation_group_id,
            derivation_index: value.derivation_index,
            wallet_label: value.wallet_label,
            address: value.address,
            source: value.source,
            secret_kind: value.secret_kind,
            is_biometric_enabled: value.is_biometric_enabled,
            has_backed_up_mnemonic: value.has_backed_up_mnemonic,
            created_at: value.created_at,
            last_unlocked_at: value.last_unlocked_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWalletSession {
    draft: PendingWalletDraft,
    backup_access_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletSessionSnapshot {
    accounts: Vec<WalletProfile>,
    active_account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWalletRequest {
    wallet_label: String,
    password: String,
    is_biometric_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWalletRequest {
    wallet_label: String,
    password: String,
    is_biometric_enabled: bool,
    secret_kind: SecretKind,
    secret_value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBiometricRequest {
    account_id: String,
    is_biometric_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockWalletRequest {
    account_id: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPendingBackupPhraseRequest {
    backup_access_token: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizePendingWalletRequest {
    backup_access_token: String,
    confirmed_backup: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActiveWalletRequest {
    account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeriveMnemonicAccountRequest {
    source_account_id: String,
    wallet_label: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameWalletAccountRequest {
    account_id: String,
    wallet_label: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWalletAccountRequest {
    account_id: String,
    password: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeeMode {
    Legacy,
    Eip1559,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransferAsset {
    Native,
    Erc20 {
        #[serde(rename = "contractAddress")]
        contract_address: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedTransferRequest {
    account_id: String,
    chain_id: String,
    nonce: String,
    gas_limit: String,
    recipient_address: String,
    amount: String,
    fee_mode: FeeMode,
    gas_price_wei: Option<String>,
    max_fee_per_gas_wei: Option<String>,
    max_priority_fee_per_gas_wei: Option<String>,
    asset: TransferAsset,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedTransferSession {
    confirmation_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignTransferRequest {
    account_id: String,
    password: String,
    confirmation_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedTransferPayload {
    raw_transaction: String,
    tx_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiNetworkConfig {
    id: String,
    source: String,
    name: String,
    chain_id: i64,
    rpc_url: String,
    symbol: String,
    explorer_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiTrackedToken {
    id: String,
    symbol: String,
    name: String,
    balance: String,
    decimals: i64,
    contract_address: String,
    network_ids: Vec<String>,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiAddressBookEntry {
    id: String,
    network_id: String,
    label: String,
    address: String,
    note: String,
    created_at: String,
    updated_at: String,
    last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiActivityItem {
    id: String,
    title: String,
    subtitle: String,
    status: String,
    account_id: Option<String>,
    account_address: Option<String>,
    tx_hash: Option<String>,
    network_id: Option<String>,
    asset_id: Option<String>,
    asset_type: Option<String>,
    asset_symbol: Option<String>,
    amount: Option<String>,
    recipient_address: Option<String>,
    created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistedUiState {
    custom_networks: Option<Vec<UiNetworkConfig>>,
    active_network_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WalletScopedUiState {
    custom_tokens: Option<Vec<UiTrackedToken>>,
    recent_activity: Option<Vec<UiActivityItem>>,
    address_book: Option<Vec<UiAddressBookEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistedUiStateEnvelope {
    global: PersistedUiState,
    wallet_scopes: HashMap<String, WalletScopedUiState>,
}

#[derive(Debug, Error)]
pub enum WalletError {
    #[error("钱包名称不能为空")]
    EmptyWalletLabel,
    #[error("钱包密码至少需要 8 位")]
    PasswordTooShort,
    #[error("当前没有待确认的创建流程")]
    NoPendingWallet,
    #[error("当前有一笔待完成的备份流程，请先完成或取消后再继续。")]
    PendingOnboardingInProgress,
    #[error("当前备份会话已失效，请重新创建钱包")]
    InvalidPendingBackupAccess,
    #[error("请先查看助记词，再完成备份确认")]
    BackupPhraseRevealRequired,
    #[error("你必须确认已经离线备份助记词")]
    BackupConfirmationRequired,
    #[error("待确认钱包数据异常")]
    InvalidPendingWallet,
    #[error("导入内容不能为空")]
    EmptyImportSecret,
    #[error("当前地址已经存在于账号列表")]
    DuplicateWalletAddress,
    #[error("只有助记词账号支持派生新地址")]
    MnemonicDerivationNotSupported,
    #[error("助记词格式不正确")]
    InvalidMnemonic(#[from] bip39::Error),
    #[error("私钥格式不正确，需要 64 位十六进制字符串")]
    InvalidPrivateKey,
    #[error("密钥派生失败")]
    KeyDerivationFailed,
    #[error("无法访问本地钱包目录")]
    PathUnavailable,
    #[error("本地钱包盐文件缺失，现有钱包无法继续解锁；请恢复原始 salt.txt 后再试")]
    StrongholdSaltMissing,
    #[error("本地文件读写失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("Stronghold 操作失败: {0}")]
    Stronghold(String),
    #[error("本地钱包数据库操作失败: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("钱包元数据异常: {0}")]
    MetadataCorrupted(String),
    #[error("当前还没有初始化钱包")]
    WalletNotInitialized,
    #[error("当前找不到要操作的账号")]
    WalletAccountNotFound,
    #[error("钱包密码不正确，无法解锁本地签名器")]
    InvalidWalletPassword,
    #[error("当前钱包缺少可签名的本地密钥记录，请重新导入或重新创建钱包")]
    MissingSigningSecret,
    #[error("本地密钥记录已损坏，无法继续签名")]
    InvalidStoredSecret,
    #[error("{0} 不是合法的 EVM 地址")]
    InvalidAddress(&'static str),
    #[error("{0} 必须是合法的十进制正整数")]
    InvalidDecimalField(&'static str),
    #[error("发送参数缺少 {0}")]
    MissingField(&'static str),
    #[error("EIP-1559 费用参数不合法")]
    InvalidEip1559Fees,
    #[error("确认摘要已过期，请重新生成确认摘要后再继续签名")]
    MissingPreparedTransferConfirmation,
    #[error("确认摘要与当前账号不匹配，请重新生成确认摘要后再继续签名")]
    InvalidPreparedTransferConfirmation,
    #[error("交易签名失败: {0}")]
    SigningFailed(String),
    #[error("操作过于频繁，请在 {retry_after_seconds} 秒后重试")]
    TooManySensitiveAttempts { retry_after_seconds: u64 },
}

impl WalletError {
    fn public_error_tier(&self) -> &'static str {
        match self {
            WalletError::TooManySensitiveAttempts { .. } => "RATE_LIMIT",
            WalletError::InvalidPendingBackupAccess | WalletError::InvalidWalletPassword => "AUTH",
            WalletError::EmptyWalletLabel
            | WalletError::PasswordTooShort
            | WalletError::EmptyImportSecret
            | WalletError::DuplicateWalletAddress
            | WalletError::MnemonicDerivationNotSupported
            | WalletError::InvalidMnemonic(_)
            | WalletError::InvalidPrivateKey
            | WalletError::InvalidAddress(_)
            | WalletError::InvalidDecimalField(_)
            | WalletError::MissingField(_)
            | WalletError::InvalidEip1559Fees => "VALIDATION",
            WalletError::NoPendingWallet
            | WalletError::PendingOnboardingInProgress
            | WalletError::BackupPhraseRevealRequired
            | WalletError::BackupConfirmationRequired
            | WalletError::InvalidPendingWallet
            | WalletError::WalletNotInitialized
            | WalletError::WalletAccountNotFound
            | WalletError::MissingPreparedTransferConfirmation
            | WalletError::InvalidPreparedTransferConfirmation => "STATE",
            WalletError::KeyDerivationFailed
            | WalletError::PathUnavailable
            | WalletError::StrongholdSaltMissing
            | WalletError::Io(_)
            | WalletError::Stronghold(_)
            | WalletError::Database(_)
            | WalletError::MetadataCorrupted(_)
            | WalletError::MissingSigningSecret
            | WalletError::InvalidStoredSecret
            | WalletError::SigningFailed(_) => "INTERNAL",
        }
    }

    fn public_message(&self) -> String {
        match self {
            WalletError::EmptyWalletLabel => "钱包名称不能为空".into(),
            WalletError::PasswordTooShort => "钱包密码至少需要 8 位".into(),
            WalletError::NoPendingWallet => "当前没有待确认的创建流程".into(),
            WalletError::PendingOnboardingInProgress => {
                "当前有一笔待完成的备份流程，请先完成或取消后再继续。".into()
            }
            WalletError::InvalidPendingBackupAccess => "当前备份会话已失效，请重新创建钱包".into(),
            WalletError::BackupPhraseRevealRequired => "请先查看助记词，再完成备份确认".into(),
            WalletError::BackupConfirmationRequired => "你必须确认已经离线备份助记词".into(),
            WalletError::InvalidPendingWallet => "待确认钱包数据异常".into(),
            WalletError::EmptyImportSecret => "导入内容不能为空".into(),
            WalletError::DuplicateWalletAddress => "当前地址已经存在于账号列表".into(),
            WalletError::MnemonicDerivationNotSupported => "只有助记词账号支持派生新地址".into(),
            WalletError::InvalidMnemonic(_) => "助记词格式不正确".into(),
            WalletError::InvalidPrivateKey => "私钥格式不正确，需要 64 位十六进制字符串".into(),
            WalletError::KeyDerivationFailed => "密钥派生失败，请稍后重试".into(),
            WalletError::PathUnavailable => "无法访问本地钱包目录".into(),
            WalletError::StrongholdSaltMissing => {
                "本地钱包盐文件缺失，请恢复原始 salt.txt 后再试".into()
            }
            WalletError::Io(_)
            | WalletError::Stronghold(_)
            | WalletError::Database(_)
            | WalletError::MetadataCorrupted(_)
            | WalletError::MissingSigningSecret
            | WalletError::InvalidStoredSecret
            | WalletError::SigningFailed(_) => "当前无法完成本地安全操作，请稍后重试".into(),
            WalletError::WalletNotInitialized => "当前还没有初始化钱包".into(),
            WalletError::WalletAccountNotFound => "当前找不到要操作的账号".into(),
            WalletError::InvalidWalletPassword => "钱包密码不正确，请重试".into(),
            WalletError::InvalidAddress(label) => format!("{label} 不是合法的 EVM 地址"),
            WalletError::InvalidDecimalField(label) => format!("{label} 必须是合法的十进制正整数"),
            WalletError::MissingField(label) => format!("发送参数缺少 {label}"),
            WalletError::InvalidEip1559Fees => "EIP-1559 费用参数不合法".into(),
            WalletError::MissingPreparedTransferConfirmation => {
                "确认摘要已过期，请重新生成确认摘要后再继续签名".into()
            }
            WalletError::InvalidPreparedTransferConfirmation => {
                "确认摘要与当前账号不匹配，请重新生成确认摘要后再继续签名".into()
            }
            WalletError::TooManySensitiveAttempts {
                retry_after_seconds,
            } => format!("尝试次数过多，请在 {retry_after_seconds} 秒后重试"),
        }
    }

    fn public_error_text(&self) -> String {
        format!("[{}] {}", self.public_error_tier(), self.public_message())
    }
}

impl Serialize for WalletError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.public_error_text())
    }
}

#[tauri::command]
pub fn create_wallet(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: CreateWalletRequest,
) -> WalletCommandResult<PendingWalletSession> {
    let request = normalize_create_request(request)?;
    let _mutation_guard = state.mutation_lock.lock().unwrap();

    if get_pending_onboarding(&app, &state)?.is_some() {
        return Err(WalletError::PendingOnboardingInProgress);
    }

    let mnemonic = Mnemonic::generate_in(Language::English, 12).map_err(WalletError::from)?;
    let mnemonic_phrase = Zeroizing::new(mnemonic.to_string());
    let private_key = derive_private_key_from_mnemonic(&mnemonic, 0)?;
    let address = address_from_private_key(private_key.as_ref())?;
    ensure_wallet_address_is_unique(&app, &address)?;
    let account_id = build_account_id(&address);
    let backup_access_token = generate_pending_backup_access_token();
    let snapshot_path = pending_snapshot_path(&app, &backup_access_token)?;
    reset_snapshot_file(&snapshot_path)?;

    let draft = PendingWalletDraft {
        account_id: account_id.clone(),
        derivation_index: 0,
        wallet_label: request.wallet_label,
        address,
        is_biometric_enabled: request.is_biometric_enabled,
        source: WalletSource::Created,
        secret_kind: SecretKind::Mnemonic,
        created_at: now_rfc3339(),
    };

    let pending = PendingOnboarding {
        backup_access_token: backup_access_token.clone(),
        draft: draft.clone(),
        has_revealed_backup_phrase: false,
        snapshot_path: snapshot_path.to_string_lossy().into_owned(),
    };

    store_secret_snapshot(
        &app,
        &request.password,
        mnemonic_phrase.as_bytes(),
        SecretKind::Mnemonic,
        &snapshot_path,
    )?;
    if let Err(error) = save_pending_onboarding(&app, &pending) {
        let _ = reset_snapshot_file(&snapshot_path);
        return Err(error);
    }
    *state.pending_onboarding.lock().unwrap() = Some(pending);

    Ok(PendingWalletSession {
        draft,
        backup_access_token,
    })
}

#[tauri::command]
pub fn load_pending_wallet_session(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
) -> WalletCommandResult<Option<PendingWalletSession>> {
    Ok(
        get_pending_onboarding(&app, &state)?.map(|pending| PendingWalletSession {
            draft: pending.draft,
            backup_access_token: pending.backup_access_token,
        }),
    )
}

#[tauri::command]
pub fn get_pending_backup_phrase(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: GetPendingBackupPhraseRequest,
) -> WalletCommandResult<String> {
    let sensitive_key = sensitive_operation_key(
        SENSITIVE_OPERATION_GET_BACKUP_PHRASE,
        &request.backup_access_token,
    );
    ensure_sensitive_operation_allowed(&state, &sensitive_key)?;
    let pending = get_pending_onboarding(&app, &state)?.ok_or(WalletError::NoPendingWallet)?;

    if !matches!(pending.draft.secret_kind, SecretKind::Mnemonic) {
        return Err(WalletError::InvalidPendingWallet);
    }

    if pending.backup_access_token != request.backup_access_token {
        return Err(WalletError::InvalidPendingBackupAccess);
    }

    let mnemonic = match load_pending_mnemonic(&app, &pending, &request.password) {
        Ok(mnemonic) => mnemonic,
        Err(error) => {
            if is_sensitive_password_failure(&error) {
                record_sensitive_operation_failure(&state, &sensitive_key);
            }
            return Err(error);
        }
    };
    clear_sensitive_operation_failure(&state, &sensitive_key);
    mark_pending_onboarding_revealed(&app, &state)?;

    Ok(mnemonic)
}

#[tauri::command]
pub fn cancel_pending_wallet(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
) -> WalletCommandResult<()> {
    clear_pending_onboarding(&app, &state)
}

#[tauri::command]
pub fn finalize_pending_wallet(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: FinalizePendingWalletRequest,
) -> WalletCommandResult<WalletProfile> {
    let pending = get_pending_onboarding(&app, &state)?.ok_or(WalletError::NoPendingWallet)?;

    if pending.backup_access_token != request.backup_access_token {
        return Err(WalletError::InvalidPendingBackupAccess);
    }

    if !pending.has_revealed_backup_phrase {
        return Err(WalletError::BackupPhraseRevealRequired);
    }

    if !request.confirmed_backup {
        return Err(WalletError::BackupConfirmationRequired);
    }

    let _mutation_guard = state.mutation_lock.lock().unwrap();

    ensure_wallet_address_is_unique(&app, &pending.draft.address)?;
    let pending_snapshot_path = validated_snapshot_path(&app, &pending.snapshot_path)?;
    let final_snapshot_path = snapshot_path_for_account(&app, &pending.draft.account_id)?;
    reset_snapshot_file(&final_snapshot_path)?;
    fs::rename(&pending_snapshot_path, &final_snapshot_path)?;
    let finalized_metadata = StoredWalletMetadata {
        account_id: pending.draft.account_id.clone(),
        derivation_group_id: pending.draft.account_id.clone(),
        derivation_index: pending.draft.derivation_index,
        wallet_label: pending.draft.wallet_label.clone(),
        address: pending.draft.address.clone(),
        source: WalletSource::Created,
        secret_kind: SecretKind::Mnemonic,
        is_biometric_enabled: pending.draft.is_biometric_enabled,
        has_backed_up_mnemonic: true,
        created_at: pending.draft.created_at.clone(),
        last_unlocked_at: Some(now_rfc3339()),
        snapshot_path: final_snapshot_path.to_string_lossy().into_owned(),
    };

    let result = save_wallet_metadata(&app, &finalized_metadata);

    match result {
        Ok(()) => {
            save_active_account_id(&app, Some(&pending.draft.account_id))?;
            clear_pending_onboarding_record(&app)?;
            *state.pending_onboarding.lock().unwrap() = None;
            Ok(finalized_metadata.into())
        }
        Err(error) => {
            let _ = fs::rename(&final_snapshot_path, &pending_snapshot_path);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn import_wallet(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: ImportWalletRequest,
) -> WalletCommandResult<WalletProfile> {
    let request = normalize_import_request(request)?;
    let _mutation_guard = state.mutation_lock.lock().unwrap();

    if get_pending_onboarding(&app, &state)?.is_some() {
        return Err(WalletError::PendingOnboardingInProgress);
    }

    let (address, secret_bytes) = match request.secret_kind {
        SecretKind::Mnemonic => {
            let normalized = normalize_mnemonic_phrase(&request.secret_value);
            let mnemonic = Mnemonic::parse_in_normalized(Language::English, &normalized)
                .map_err(WalletError::from)?;
            let private_key = derive_private_key_from_mnemonic(&mnemonic, 0)?;
            (
                address_from_private_key(private_key.as_ref())?,
                Zeroizing::new(normalized.into_bytes()),
            )
        }
        SecretKind::PrivateKey => {
            let normalized = normalize_private_key(&request.secret_value)?;
            (
                address_from_private_key(&normalized)?,
                Zeroizing::new(normalized.to_vec()),
            )
        }
    };

    ensure_wallet_address_is_unique(&app, &address)?;
    let account_id = build_account_id(&address);

    persist_wallet_secret(
        &app,
        &request.password,
        secret_bytes.as_ref(),
        request.secret_kind,
        &StoredWalletMetadata {
            account_id: account_id.clone(),
            derivation_group_id: account_id.clone(),
            derivation_index: 0,
            wallet_label: request.wallet_label,
            address,
            source: WalletSource::Imported,
            secret_kind: request.secret_kind,
            is_biometric_enabled: request.is_biometric_enabled,
            has_backed_up_mnemonic: false,
            created_at: now_rfc3339(),
            last_unlocked_at: Some(now_rfc3339()),
            snapshot_path: snapshot_path_for_account(&app, &account_id)?
                .to_string_lossy()
                .into_owned(),
        },
    )
}

#[tauri::command]
pub fn derive_mnemonic_account(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: DeriveMnemonicAccountRequest,
) -> WalletCommandResult<WalletProfile> {
    let request = normalize_derive_request(request)?;
    let sensitive_key =
        sensitive_operation_key(SENSITIVE_OPERATION_DERIVE_ACCOUNT, &request.source_account_id);
    ensure_sensitive_operation_allowed(&state, &sensitive_key)?;
    let _mutation_guard = state.mutation_lock.lock().unwrap();
    let source_metadata = load_wallet_metadata(&app, &request.source_account_id)?
        .ok_or(WalletError::WalletNotInitialized)?;

    if source_metadata.secret_kind != SecretKind::Mnemonic {
        return Err(WalletError::MnemonicDerivationNotSupported);
    }

    let mnemonic = match load_mnemonic_for_derivation(&app, &source_metadata, &request.password) {
        Ok(mnemonic) => mnemonic,
        Err(error) => {
            if is_sensitive_password_failure(&error) {
                record_sensitive_operation_failure(&state, &sensitive_key);
            }
            return Err(error);
        }
    };
    clear_sensitive_operation_failure(&state, &sensitive_key);
    let next_derivation_index =
        next_mnemonic_derivation_index(&app, &source_metadata.derivation_group_id)?;
    let private_key = derive_private_key_from_mnemonic(&mnemonic, next_derivation_index)?;
    let address = address_from_private_key(private_key.as_ref())?;
    ensure_wallet_address_is_unique(&app, &address)?;

    let now = now_rfc3339();
    let source_snapshot_path = validated_snapshot_path(&app, &source_metadata.snapshot_path)?
        .to_string_lossy()
        .into_owned();
    let next_metadata = StoredWalletMetadata {
        account_id: build_account_id(&address),
        derivation_group_id: source_metadata.derivation_group_id.clone(),
        derivation_index: next_derivation_index,
        wallet_label: request.wallet_label,
        address,
        source: source_metadata.source,
        secret_kind: SecretKind::Mnemonic,
        is_biometric_enabled: source_metadata.is_biometric_enabled,
        has_backed_up_mnemonic: source_metadata.has_backed_up_mnemonic,
        created_at: now.clone(),
        last_unlocked_at: Some(now),
        snapshot_path: source_snapshot_path,
    };

    save_wallet_metadata(&app, &next_metadata)?;
    save_active_account_id(&app, Some(&next_metadata.account_id))?;

    Ok(next_metadata.into())
}

#[tauri::command]
pub fn rename_wallet_account(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: RenameWalletAccountRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
    let request = normalize_rename_request(request)?;
    let _mutation_guard = state.mutation_lock.lock().unwrap();
    let metadata = match load_wallet_metadata(&app, &request.account_id)? {
        Some(metadata) => metadata,
        None => return Ok(None),
    };

    let next_metadata = StoredWalletMetadata {
        wallet_label: request.wallet_label,
        ..metadata
    };

    save_wallet_metadata(&app, &next_metadata)?;

    Ok(Some(next_metadata.into()))
}

#[tauri::command]
pub fn delete_wallet_account(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: DeleteWalletAccountRequest,
) -> WalletCommandResult<WalletSessionSnapshot> {
    let sensitive_key =
        sensitive_operation_key(SENSITIVE_OPERATION_DELETE_ACCOUNT, &request.account_id);
    ensure_sensitive_operation_allowed(&state, &sensitive_key)?;
    let _mutation_guard = state.mutation_lock.lock().unwrap();
    let metadata = load_wallet_metadata(&app, &request.account_id)?
        .ok_or(WalletError::WalletAccountNotFound)?;
    match load_secret_record(&app, &metadata, &request.password) {
        Ok(_) => clear_sensitive_operation_failure(&state, &sensitive_key),
        Err(error) => {
            if is_sensitive_password_failure(&error) {
                record_sensitive_operation_failure(&state, &sensitive_key);
            }
            return Err(error);
        }
    }
    let deleted_account_id = metadata.account_id.clone();
    let deleted_snapshot_path = metadata.snapshot_path.clone();
    let previous_active_account_id = load_active_account_id(&app)?;

    delete_wallet_metadata(&app, &request.account_id)?;

    let remaining_accounts = load_wallet_accounts(&app)?;
    delete_snapshot_if_unused(&app, &deleted_snapshot_path, &remaining_accounts)?;

    let next_active_account_id = if remaining_accounts.is_empty() {
        None
    } else if previous_active_account_id.as_deref() == Some(deleted_account_id.as_str()) {
        Some(remaining_accounts[0].account_id.clone())
    } else if remaining_accounts
        .iter()
        .any(|entry| Some(entry.account_id.as_str()) == previous_active_account_id.as_deref())
    {
        previous_active_account_id
    } else {
        Some(remaining_accounts[0].account_id.clone())
    };

    save_active_account_id(&app, next_active_account_id.as_deref())?;

    Ok(WalletSessionSnapshot {
        accounts: remaining_accounts.into_iter().map(Into::into).collect(),
        active_account_id: next_active_account_id,
    })
}

#[tauri::command]
pub fn load_wallet_session(app: AppHandle) -> WalletCommandResult<WalletSessionSnapshot> {
    let stored_accounts = load_wallet_accounts(&app)?;
    let stored_active_account_id = load_active_account_id(&app)?;
    let active_account_id =
        normalize_active_account_id(stored_active_account_id.clone(), &stored_accounts);

    if active_account_id != stored_active_account_id {
        save_active_account_id(&app, active_account_id.as_deref())?;
    }

    let accounts = stored_accounts
        .into_iter()
        .map(WalletProfile::from)
        .collect::<Vec<_>>();

    Ok(WalletSessionSnapshot {
        accounts,
        active_account_id,
    })
}

#[tauri::command]
pub fn load_wallet_profile(app: AppHandle) -> WalletCommandResult<Option<WalletProfile>> {
    let accounts = load_wallet_accounts(&app)?;
    let stored_active_account_id = load_active_account_id(&app)?;
    let active_account_id =
        normalize_active_account_id(stored_active_account_id.clone(), &accounts);

    if active_account_id != stored_active_account_id {
        save_active_account_id(&app, active_account_id.as_deref())?;
    }

    let metadata = match active_account_id {
        Some(account_id) => load_wallet_metadata(&app, &account_id)?,
        None => accounts.into_iter().next(),
    };

    Ok(metadata.map(Into::into))
}

#[tauri::command]
pub fn unlock_wallet(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: UnlockWalletRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
    let sensitive_key = sensitive_operation_key(SENSITIVE_OPERATION_UNLOCK, &request.account_id);
    ensure_sensitive_operation_allowed(&state, &sensitive_key)?;
    let _mutation_guard = state.mutation_lock.lock().unwrap();
    let metadata = load_wallet_metadata(&app, &request.account_id)?
        .ok_or(WalletError::WalletAccountNotFound)?;
    let snapshot_path = validated_snapshot_path(&app, &metadata.snapshot_path)?;

    let stronghold = open_stronghold(
        &snapshot_path,
        &request.password,
        &wallet_paths(&app)?.salt_path,
    );

    let stronghold = match stronghold {
        Ok(stronghold) => stronghold,
        Err(error) => {
            if should_mask_unlock_error(&error) {
                record_sensitive_operation_failure(&state, &sensitive_key);
                return Ok(None);
            }

            return Err(error);
        }
    };

    stronghold
        .load_client(STRONGHOLD_CLIENT.to_vec())
        .map_err(|_| WalletError::MissingSigningSecret)?;
    match load_private_key_for_signing(&app, &metadata, &request.password) {
        Ok(_) => clear_sensitive_operation_failure(&state, &sensitive_key),
        Err(error) => {
            if is_sensitive_password_failure(&error) {
                record_sensitive_operation_failure(&state, &sensitive_key);
                return Ok(None);
            }
            return Err(error);
        }
    }

    let unlocked_at = now_rfc3339();
    update_last_unlocked_at(&app, &request.account_id, &unlocked_at)?;
    save_active_account_id(&app, Some(&request.account_id))?;

    let mut next_metadata = load_wallet_metadata(&app, &request.account_id)?.ok_or_else(|| {
        WalletError::MetadataCorrupted("wallet metadata missing after unlock".into())
    })?;
    next_metadata.last_unlocked_at = Some(unlocked_at);

    Ok(Some(next_metadata.into()))
}

#[tauri::command]
pub fn set_active_wallet(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: SetActiveWalletRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
    let _mutation_guard = state.mutation_lock.lock().unwrap();
    let metadata = match load_wallet_metadata(&app, &request.account_id)? {
        Some(metadata) => metadata,
        None => return Ok(None),
    };

    save_active_account_id(&app, Some(&request.account_id))?;
    Ok(Some(metadata.into()))
}

#[tauri::command]
pub fn update_biometric_setting(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: UpdateBiometricRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
    let _mutation_guard = state.mutation_lock.lock().unwrap();
    let metadata = match load_wallet_metadata(&app, &request.account_id)? {
        Some(metadata) => metadata,
        None => return Ok(None),
    };

    let next_metadata = StoredWalletMetadata {
        is_biometric_enabled: request.is_biometric_enabled,
        ..metadata
    };

    save_wallet_metadata(&app, &next_metadata)?;

    Ok(Some(next_metadata.into()))
}

#[tauri::command]
pub fn prepare_transfer_confirmation(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: PreparedTransferRequest,
) -> WalletCommandResult<PreparedTransferSession> {
    let _mutation_guard = state.mutation_lock.lock().unwrap();
    load_wallet_metadata(&app, &request.account_id)?.ok_or(WalletError::WalletNotInitialized)?;
    build_transfer_transaction(&request)?;

    let confirmation_id = generate_pending_backup_access_token();
    let mut confirmations = state.pending_transfer_confirmations.lock().unwrap();
    prune_expired_transfer_confirmations(&mut confirmations);
    confirmations.insert(
        confirmation_id.clone(),
        PendingTransferConfirmation {
            request,
            prepared_at_unix_seconds: now_unix_seconds(),
        },
    );

    Ok(PreparedTransferSession { confirmation_id })
}

#[tauri::command]
pub fn sign_transfer_transaction(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: SignTransferRequest,
) -> WalletCommandResult<SignedTransferPayload> {
    let sensitive_key =
        sensitive_operation_key(SENSITIVE_OPERATION_SIGN_TRANSFER, &request.account_id);
    ensure_sensitive_operation_allowed(&state, &sensitive_key)?;
    let _mutation_guard = state.mutation_lock.lock().unwrap();
    let prepared_confirmation = {
        let mut confirmations = state.pending_transfer_confirmations.lock().unwrap();
        prune_expired_transfer_confirmations(&mut confirmations);
        let prepared = confirmations
            .get(&request.confirmation_id)
            .cloned()
            .ok_or(WalletError::MissingPreparedTransferConfirmation)?;

        if prepared.request.account_id != request.account_id {
            return Err(WalletError::InvalidPreparedTransferConfirmation);
        }

        prepared
    };

    let metadata = load_wallet_metadata(&app, &prepared_confirmation.request.account_id)?
        .ok_or(WalletError::WalletNotInitialized)?;
    let private_key = match load_private_key_for_signing(&app, &metadata, &request.password) {
        Ok(private_key) => {
            clear_sensitive_operation_failure(&state, &sensitive_key);
            private_key
        }
        Err(error) => {
            if is_sensitive_password_failure(&error) {
                record_sensitive_operation_failure(&state, &sensitive_key);
            }
            return Err(error);
        }
    };
    let tx = build_transfer_transaction(&prepared_confirmation.request)?;

    let signer = PrivateKeySigner::from_slice(private_key.as_ref())
        .map_err(|_| WalletError::InvalidPrivateKey)?;
    let signature = signer
        .sign_hash_sync(&tx.signature_hash())
        .map_err(|error| WalletError::SigningFailed(error.to_string()))?;
    let envelope: TxEnvelope = tx.into_envelope(signature);
    let raw_transaction = envelope.encoded_2718();
    state
        .pending_transfer_confirmations
        .lock()
        .unwrap()
        .remove(&request.confirmation_id);

    Ok(SignedTransferPayload {
        raw_transaction: format!("0x{}", hex::encode(raw_transaction)),
        tx_hash: format!("0x{}", hex::encode(envelope.tx_hash().as_slice())),
    })
}

#[tauri::command]
pub fn load_ui_state(app: AppHandle) -> WalletCommandResult<PersistedUiStateEnvelope> {
    load_persisted_ui_state(&app)
}

#[tauri::command]
pub fn save_ui_state(app: AppHandle, state: PersistedUiStateEnvelope) -> WalletCommandResult<()> {
    let sanitized_state = sanitize_persisted_ui_state(&app, state)?;
    save_persisted_ui_state(&app, &sanitized_state)
}

fn normalize_create_request(
    request: CreateWalletRequest,
) -> Result<CreateWalletRequest, WalletError> {
    let wallet_label = request.wallet_label.trim().to_owned();

    if wallet_label.is_empty() {
        return Err(WalletError::EmptyWalletLabel);
    }

    if request.password.len() < 8 {
        return Err(WalletError::PasswordTooShort);
    }

    Ok(CreateWalletRequest {
        wallet_label,
        password: request.password,
        is_biometric_enabled: request.is_biometric_enabled,
    })
}

fn normalize_import_request(
    request: ImportWalletRequest,
) -> Result<ImportWalletRequest, WalletError> {
    let wallet_label = request.wallet_label.trim().to_owned();

    if wallet_label.is_empty() {
        return Err(WalletError::EmptyWalletLabel);
    }

    if request.password.len() < 8 {
        return Err(WalletError::PasswordTooShort);
    }

    if request.secret_value.trim().is_empty() {
        return Err(WalletError::EmptyImportSecret);
    }

    Ok(ImportWalletRequest {
        wallet_label,
        password: request.password,
        is_biometric_enabled: request.is_biometric_enabled,
        secret_kind: request.secret_kind,
        secret_value: request.secret_value,
    })
}

fn normalize_derive_request(
    request: DeriveMnemonicAccountRequest,
) -> Result<DeriveMnemonicAccountRequest, WalletError> {
    let wallet_label = request.wallet_label.trim().to_owned();

    if wallet_label.is_empty() {
        return Err(WalletError::EmptyWalletLabel);
    }

    if request.password.len() < 8 {
        return Err(WalletError::PasswordTooShort);
    }

    Ok(DeriveMnemonicAccountRequest {
        source_account_id: request.source_account_id,
        wallet_label,
        password: request.password,
    })
}

fn normalize_rename_request(
    request: RenameWalletAccountRequest,
) -> Result<RenameWalletAccountRequest, WalletError> {
    let wallet_label = request.wallet_label.trim().to_owned();

    if wallet_label.is_empty() {
        return Err(WalletError::EmptyWalletLabel);
    }

    Ok(RenameWalletAccountRequest {
        account_id: request.account_id,
        wallet_label,
    })
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn now_unix_seconds() -> i64 {
    Utc::now().timestamp()
}

fn is_transfer_confirmation_fresh(
    confirmation: &PendingTransferConfirmation,
    now_unix_seconds: i64,
) -> bool {
    confirmation
        .prepared_at_unix_seconds
        .checked_add(PENDING_TRANSFER_CONFIRMATION_TTL_SECONDS)
        .is_some_and(|expires_at| expires_at >= now_unix_seconds)
}

fn prune_expired_transfer_confirmations(
    confirmations: &mut HashMap<String, PendingTransferConfirmation>,
) {
    let now = now_unix_seconds();
    confirmations.retain(|_, confirmation| is_transfer_confirmation_fresh(confirmation, now));
}

fn sensitive_operation_key(operation: &str, scope: &str) -> String {
    let normalized_scope = scope.trim().to_ascii_lowercase();
    let scope = if normalized_scope.is_empty() {
        "global"
    } else {
        normalized_scope.as_str()
    };
    format!("{operation}:{scope}")
}

fn is_sensitive_password_failure(error: &WalletError) -> bool {
    matches!(error, WalletError::InvalidWalletPassword)
}

fn prune_stale_sensitive_attempts(
    attempts: &mut HashMap<String, SensitiveOperationAttemptState>,
    now_unix_seconds: i64,
) {
    attempts.retain(|_, state| {
        if state.lock_until_unix_seconds > now_unix_seconds {
            return true;
        }

        now_unix_seconds.saturating_sub(state.last_failed_unix_seconds)
            <= SENSITIVE_ATTEMPT_RESET_SECONDS
    });
}

fn retry_after_seconds_for_sensitive_attempt(
    attempts: &mut HashMap<String, SensitiveOperationAttemptState>,
    operation_key: &str,
    now_unix_seconds: i64,
) -> Option<u64> {
    prune_stale_sensitive_attempts(attempts, now_unix_seconds);
    let state = attempts.get(operation_key)?;
    if state.lock_until_unix_seconds <= now_unix_seconds {
        return None;
    }

    Some((state.lock_until_unix_seconds - now_unix_seconds) as u64)
}

fn register_sensitive_operation_failure(
    attempts: &mut HashMap<String, SensitiveOperationAttemptState>,
    operation_key: &str,
    now_unix_seconds: i64,
) {
    prune_stale_sensitive_attempts(attempts, now_unix_seconds);
    let state = attempts
        .entry(operation_key.to_owned())
        .or_default();

    if now_unix_seconds.saturating_sub(state.last_failed_unix_seconds)
        > SENSITIVE_ATTEMPT_RESET_SECONDS
    {
        *state = SensitiveOperationAttemptState::default();
    }

    state.failed_attempts = state.failed_attempts.saturating_add(1);
    state.last_failed_unix_seconds = now_unix_seconds;

    if state.failed_attempts < SENSITIVE_ATTEMPT_GRACE_FAILURES {
        state.lock_until_unix_seconds = 0;
        return;
    }

    let exponent = state
        .failed_attempts
        .saturating_sub(SENSITIVE_ATTEMPT_GRACE_FAILURES)
        .min(20);
    let multiplier = 1i64.checked_shl(exponent).unwrap_or(i64::MAX);
    let lock_seconds = SENSITIVE_ATTEMPT_BASE_LOCK_SECONDS
        .saturating_mul(multiplier)
        .min(SENSITIVE_ATTEMPT_MAX_LOCK_SECONDS);
    state.lock_until_unix_seconds = now_unix_seconds.saturating_add(lock_seconds);
}

fn clear_sensitive_operation_failures(
    attempts: &mut HashMap<String, SensitiveOperationAttemptState>,
    operation_key: &str,
) {
    attempts.remove(operation_key);
}

fn ensure_sensitive_operation_allowed(
    state: &State<'_, WalletRuntimeState>,
    operation_key: &str,
) -> Result<(), WalletError> {
    let now = now_unix_seconds();
    let mut attempts = state.sensitive_operation_attempts.lock().unwrap();
    let retry_after =
        retry_after_seconds_for_sensitive_attempt(&mut attempts, operation_key, now);

    if let Some(retry_after_seconds) = retry_after {
        return Err(WalletError::TooManySensitiveAttempts { retry_after_seconds });
    }

    Ok(())
}

fn record_sensitive_operation_failure(
    state: &State<'_, WalletRuntimeState>,
    operation_key: &str,
) {
    let now = now_unix_seconds();
    let mut attempts = state.sensitive_operation_attempts.lock().unwrap();
    register_sensitive_operation_failure(&mut attempts, operation_key, now);
}

fn clear_sensitive_operation_failure(
    state: &State<'_, WalletRuntimeState>,
    operation_key: &str,
) {
    let mut attempts = state.sensitive_operation_attempts.lock().unwrap();
    clear_sensitive_operation_failures(&mut attempts, operation_key);
}

fn normalize_mnemonic_phrase(value: &str) -> String {
    value.split_whitespace().collect::<Vec<&str>>().join(" ")
}

fn normalize_private_key(value: &str) -> Result<[u8; 32], WalletError> {
    let normalized = value
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");

    if normalized.len() != 64 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(WalletError::InvalidPrivateKey);
    }

    let bytes = hex::decode(normalized).map_err(|_| WalletError::InvalidPrivateKey)?;
    let mut private_key = [0u8; 32];
    private_key.copy_from_slice(&bytes);
    Ok(private_key)
}

fn derive_private_key_from_mnemonic(
    mnemonic: &Mnemonic,
    derivation_index: u32,
) -> Result<Zeroizing<[u8; 32]>, WalletError> {
    let seed = Zeroizing::new(mnemonic.to_seed_normalized(""));
    derive_private_key_from_seed(seed.as_ref(), derivation_index)
}

fn derive_private_key_from_seed(
    seed: &[u8],
    derivation_index: u32,
) -> Result<Zeroizing<[u8; 32]>, WalletError> {
    let (mut signing_key, mut chain_code) = root_signing_key_from_seed(seed)?;

    for index in ETH_BIP44_PREFIX {
        (signing_key, chain_code) = derive_child_signing_key(&signing_key, &chain_code, index)?;
    }

    let (signing_key, _) = derive_child_signing_key(&signing_key, &chain_code, derivation_index)?;

    let mut private_key = [0u8; 32];
    private_key.copy_from_slice(&signing_key.to_bytes());
    Ok(Zeroizing::new(private_key))
}

fn root_signing_key_from_seed(seed: &[u8]) -> Result<(SigningKey, [u8; 32]), WalletError> {
    let (scalar, chain_code) = hmac_and_split(b"Bitcoin seed", seed)?;
    Ok((SigningKey::from(scalar), chain_code))
}

fn derive_child_signing_key(
    parent_key: &SigningKey,
    chain_code: &[u8; 32],
    index: u32,
) -> Result<(SigningKey, [u8; 32]), WalletError> {
    let mut data = Vec::with_capacity(37);

    if index >= BIP32_HARDEN {
        data.push(0);
        data.extend_from_slice(&parent_key.to_bytes());
    } else {
        data.extend_from_slice(parent_key.verifying_key().to_encoded_point(true).as_bytes());
    }

    data.extend_from_slice(&index.to_be_bytes());

    let (tweak, next_chain_code) = hmac_and_split(chain_code, &data)?;
    let tweaked = tweak.add(parent_key.as_nonzero_scalar());
    let child_scalar: NonZeroScalar =
        Option::from(NonZeroScalar::new(tweaked)).ok_or(WalletError::KeyDerivationFailed)?;

    Ok((SigningKey::from(child_scalar), next_chain_code))
}

fn hmac_and_split(key: &[u8], data: &[u8]) -> Result<(NonZeroScalar, [u8; 32]), WalletError> {
    let mut mac = HmacSha512::new_from_slice(key).map_err(|_| WalletError::KeyDerivationFailed)?;
    mac.update(data);
    let output = mac.finalize().into_bytes();

    let scalar =
        NonZeroScalar::try_from(&output[..32]).map_err(|_| WalletError::KeyDerivationFailed)?;
    let mut chain_code = [0u8; 32];
    chain_code.copy_from_slice(&output[32..]);

    Ok((scalar, chain_code))
}

fn address_from_private_key(private_key: &[u8]) -> Result<String, WalletError> {
    let private_key: &[u8; 32] = private_key
        .try_into()
        .map_err(|_| WalletError::InvalidPrivateKey)?;
    let signing_key = SigningKey::from_bytes(&(*private_key).into())
        .map_err(|_| WalletError::InvalidPrivateKey)?;
    let encoded = signing_key.verifying_key().to_encoded_point(false);
    let public_key = encoded.as_bytes();

    let hash = Keccak256::digest(&public_key[1..]);
    let mut address = [0u8; 20];
    address.copy_from_slice(&hash[12..]);

    Ok(to_eip55_address(&address))
}

fn to_eip55_address(address: &[u8; 20]) -> String {
    let lower_hex = hex::encode(address);
    let checksum = Keccak256::digest(lower_hex.as_bytes());

    let mut result = String::with_capacity(42);
    result.push_str("0x");

    for (index, char) in lower_hex.chars().enumerate() {
        let nibble = if index % 2 == 0 {
            checksum[index / 2] >> 4
        } else {
            checksum[index / 2] & 0x0f
        };

        if char.is_ascii_alphabetic() && nibble >= 8 {
            result.push(char.to_ascii_uppercase());
        } else {
            result.push(char);
        }
    }

    result
}

fn load_private_key_for_signing(
    app: &AppHandle,
    metadata: &StoredWalletMetadata,
    password: &str,
) -> Result<Zeroizing<[u8; 32]>, WalletError> {
    let (secret_kind, secret_record) = load_secret_record(app, metadata, password)?;
    let secret_bytes = &secret_record;
    let private_key = match secret_kind {
        SecretKind::Mnemonic => {
            let mnemonic_phrase =
                std::str::from_utf8(secret_bytes).map_err(|_| WalletError::InvalidStoredSecret)?;
            let mnemonic = Mnemonic::parse_in_normalized(Language::English, mnemonic_phrase)?;
            derive_private_key_from_mnemonic(&mnemonic, metadata.derivation_index)?
        }
        SecretKind::PrivateKey => {
            if secret_bytes.len() != 32 {
                return Err(WalletError::InvalidStoredSecret);
            }

            let mut private_key = [0u8; 32];
            private_key.copy_from_slice(secret_bytes);
            Zeroizing::new(private_key)
        }
    };

    let derived_address = address_from_private_key(private_key.as_ref())?;
    if derived_address != metadata.address {
        return Err(WalletError::InvalidStoredSecret);
    }

    Ok(private_key)
}

fn load_mnemonic_for_derivation(
    app: &AppHandle,
    metadata: &StoredWalletMetadata,
    password: &str,
) -> Result<Mnemonic, WalletError> {
    let (secret_kind, secret_record) = load_secret_record(app, metadata, password)?;

    if secret_kind != SecretKind::Mnemonic {
        return Err(WalletError::MnemonicDerivationNotSupported);
    }

    let mnemonic_phrase = std::str::from_utf8(secret_record.as_ref())
        .map_err(|_| WalletError::InvalidStoredSecret)?;
    let mnemonic = Mnemonic::parse_in_normalized(Language::English, mnemonic_phrase)?;
    let derived_root_key = derive_private_key_from_mnemonic(&mnemonic, metadata.derivation_index)?;
    let derived_address = address_from_private_key(derived_root_key.as_ref())?;

    if derived_address != metadata.address {
        return Err(WalletError::InvalidStoredSecret);
    }

    Ok(mnemonic)
}

fn load_secret_record(
    app: &AppHandle,
    metadata: &StoredWalletMetadata,
    password: &str,
) -> Result<(SecretKind, Zeroizing<Vec<u8>>), WalletError> {
    let snapshot_path = validated_snapshot_path(app, &metadata.snapshot_path)?;
    let paths = wallet_paths(app)?;
    let (secret_kind, secret_record) =
        load_secret_from_snapshot_path(&snapshot_path, password, &paths.salt_path)
            .map_err(normalize_secret_access_error)?;

    if secret_kind != metadata.secret_kind {
        return Err(WalletError::InvalidStoredSecret);
    }

    Ok((secret_kind, secret_record))
}

fn normalize_secret_access_error(error: WalletError) -> WalletError {
    match error {
        WalletError::StrongholdSaltMissing
        | WalletError::MetadataCorrupted(_)
        | WalletError::PathUnavailable
        | WalletError::Io(_) => error,
        _ => WalletError::InvalidWalletPassword,
    }
}

fn should_mask_unlock_error(error: &WalletError) -> bool {
    matches!(
        error,
        WalletError::InvalidWalletPassword | WalletError::Stronghold(_)
    )
}

fn build_transfer_transaction(
    request: &PreparedTransferRequest,
) -> Result<TypedTransaction, WalletError> {
    let chain_id = parse_u64_field("chainId", &request.chain_id)?;
    let nonce = parse_u64_field("nonce", &request.nonce)?;
    let gas_limit = parse_u64_field("gasLimit", &request.gas_limit)?;
    let recipient = parse_address_field("recipientAddress", &request.recipient_address)?;
    let amount = parse_u256_field("amount", &request.amount)?;

    let (to, value, input) = match &request.asset {
        TransferAsset::Native => (TxKind::Call(recipient), amount, Bytes::default()),
        TransferAsset::Erc20 { contract_address } => {
            let contract_address = parse_address_field("contractAddress", contract_address)?;
            (
                TxKind::Call(contract_address),
                U256::ZERO,
                encode_erc20_transfer_call(recipient, amount),
            )
        }
    };

    match request.fee_mode {
        FeeMode::Legacy => {
            let gas_price =
                parse_required_u128_field("gasPriceWei", request.gas_price_wei.as_deref())?;

            Ok(TypedTransaction::Legacy(TxLegacy {
                chain_id: Some(chain_id),
                nonce,
                gas_price,
                gas_limit,
                to,
                value,
                input,
            }))
        }
        FeeMode::Eip1559 => {
            let max_fee_per_gas = parse_required_u128_field(
                "maxFeePerGasWei",
                request.max_fee_per_gas_wei.as_deref(),
            )?;
            let max_priority_fee_per_gas = parse_required_u128_field(
                "maxPriorityFeePerGasWei",
                request.max_priority_fee_per_gas_wei.as_deref(),
            )?;

            if max_priority_fee_per_gas > max_fee_per_gas {
                return Err(WalletError::InvalidEip1559Fees);
            }

            Ok(TypedTransaction::Eip1559(TxEip1559 {
                chain_id,
                nonce,
                gas_limit,
                max_fee_per_gas,
                max_priority_fee_per_gas,
                to,
                value,
                access_list: Default::default(),
                input,
            }))
        }
    }
}

fn parse_address_field(label: &'static str, value: &str) -> Result<Address, WalletError> {
    value
        .trim()
        .parse::<Address>()
        .map_err(|_| WalletError::InvalidAddress(label))
}

fn parse_u64_field(label: &'static str, value: &str) -> Result<u64, WalletError> {
    value
        .trim()
        .parse::<u64>()
        .map_err(|_| WalletError::InvalidDecimalField(label))
}

fn parse_u128_field(label: &'static str, value: &str) -> Result<u128, WalletError> {
    value
        .trim()
        .parse::<u128>()
        .map_err(|_| WalletError::InvalidDecimalField(label))
}

fn parse_u256_field(label: &'static str, value: &str) -> Result<U256, WalletError> {
    U256::from_str_radix(value.trim(), 10).map_err(|_| WalletError::InvalidDecimalField(label))
}

fn parse_required_u128_field(
    label: &'static str,
    value: Option<&str>,
) -> Result<u128, WalletError> {
    parse_u128_field(label, value.ok_or(WalletError::MissingField(label))?)
}

fn encode_erc20_transfer_call(recipient: Address, amount: U256) -> Bytes {
    let selector = keccak256("transfer(address,uint256)".as_bytes()).to_vec();
    let mut calldata = Vec::with_capacity(68);
    let mut recipient_slot = [0u8; 32];
    recipient_slot[12..].copy_from_slice(recipient.as_slice());

    calldata.extend_from_slice(&selector[..4]);
    calldata.extend_from_slice(&recipient_slot);
    calldata.extend_from_slice(&amount.to_be_bytes::<32>());

    Bytes::from(calldata)
}

fn persist_wallet_secret(
    app: &AppHandle,
    password: &str,
    secret_bytes: &[u8],
    secret_kind: SecretKind,
    metadata: &StoredWalletMetadata,
) -> Result<WalletProfile, WalletError> {
    let snapshot_file_path = PathBuf::from(&metadata.snapshot_path);
    store_secret_snapshot(
        app,
        password,
        secret_bytes,
        secret_kind,
        &snapshot_file_path,
    )?;

    save_wallet_metadata(app, metadata)?;
    save_active_account_id(app, Some(&metadata.account_id))?;

    Ok(load_wallet_metadata(app, &metadata.account_id)?
        .ok_or_else(|| WalletError::MetadataCorrupted("wallet metadata missing after save".into()))?
        .into())
}

fn store_secret_snapshot(
    app: &AppHandle,
    password: &str,
    secret_bytes: &[u8],
    secret_kind: SecretKind,
    snapshot_file_path: &Path,
) -> Result<(), WalletError> {
    let paths = wallet_paths(app)?;
    let stronghold = open_stronghold(snapshot_file_path, password, &paths.salt_path)?;
    let snapshot_path = iota_stronghold::SnapshotPath::from_path(snapshot_file_path);
    let client = match stronghold.load_client(STRONGHOLD_CLIENT.to_vec()) {
        Ok(client) => client,
        Err(_) => stronghold
            .create_client(STRONGHOLD_CLIENT.to_vec())
            .map_err(|error| WalletError::Stronghold(error.to_string()))?,
    };

    let mut secret_payload = Zeroizing::new(Vec::with_capacity(secret_bytes.len() + 16));
    secret_payload.extend_from_slice(secret_kind.as_str().as_bytes());
    secret_payload.push(b':');
    secret_payload.extend_from_slice(secret_bytes);

    client
        .store()
        .insert(
            STRONGHOLD_RECORD.to_vec(),
            std::mem::take(&mut *secret_payload),
            None,
        )
        .map_err(|error| WalletError::Stronghold(error.to_string()))?;

    stronghold
        .commit_with_keyprovider(
            &snapshot_path,
            &stronghold_key_provider(password, &paths.salt_path)?,
        )
        .map_err(|error| WalletError::Stronghold(error.to_string()))?;

    Ok(())
}

fn load_secret_from_snapshot_path(
    snapshot_path: &Path,
    password: &str,
    salt_path: &Path,
) -> Result<(SecretKind, Zeroizing<Vec<u8>>), WalletError> {
    if !snapshot_path.is_file() {
        return Err(WalletError::InvalidPendingWallet);
    }

    let stronghold = open_stronghold(snapshot_path, password, salt_path)?;
    let client = stronghold
        .load_client(STRONGHOLD_CLIENT.to_vec())
        .map_err(|_| WalletError::MissingSigningSecret)?;
    let secret_record = client
        .store()
        .get(STRONGHOLD_RECORD)
        .map_err(|error| WalletError::Stronghold(error.to_string()))?
        .ok_or(WalletError::MissingSigningSecret)?;
    let secret_record = Zeroizing::new(secret_record);
    let delimiter = secret_record
        .iter()
        .position(|byte| *byte == b':')
        .ok_or(WalletError::InvalidStoredSecret)?;
    let secret_kind = std::str::from_utf8(&secret_record[..delimiter])
        .ok()
        .and_then(|value| SecretKind::from_db_value(value).ok())
        .ok_or(WalletError::InvalidStoredSecret)?;

    Ok((
        secret_kind,
        Zeroizing::new(secret_record[delimiter + 1..].to_vec()),
    ))
}

fn open_stronghold(
    path: &Path,
    password: &str,
    salt_path: &Path,
) -> Result<Stronghold, WalletError> {
    let stronghold = Stronghold::default();
    let key_provider = stronghold_key_provider(password, salt_path)?;
    let snapshot_path = iota_stronghold::SnapshotPath::from_path(path);

    if snapshot_path.exists() {
        stronghold
            .load_snapshot(&key_provider, &snapshot_path)
            .map_err(|error| WalletError::Stronghold(error.to_string()))?;
    }

    Ok(stronghold)
}

fn stronghold_key_provider(password: &str, salt_path: &Path) -> Result<KeyProvider, WalletError> {
    let hash = derive_stronghold_password_hash(password, salt_path)?;
    KeyProvider::try_from(Zeroizing::new(hash))
        .map_err(|error| WalletError::Stronghold(error.to_string()))
}

fn derive_stronghold_password_hash(
    password: &str,
    salt_path: &Path,
) -> Result<Vec<u8>, WalletError> {
    let mut salt = [0u8; SALT_LENGTH];

    if salt_path.is_file() {
        let existing = fs::read(salt_path)?;
        if existing.len() != SALT_LENGTH {
            return Err(WalletError::MetadataCorrupted(
                "stronghold salt length is invalid".into(),
            ));
        }
        salt.copy_from_slice(&existing);
    } else {
        if stronghold_storage_exists_without_salt(salt_path)? {
            return Err(WalletError::StrongholdSaltMissing);
        }

        let mut rng = thread_rng();
        rng.fill_bytes(&mut salt);
        fs::write(salt_path, salt)?;
    }

    argon2::hash_raw(password.as_bytes(), &salt, &Default::default())
        .map_err(|error| WalletError::Stronghold(error.to_string()))
}

fn stronghold_storage_exists_without_salt(salt_path: &Path) -> Result<bool, WalletError> {
    let Some(local_data_dir) = salt_path.parent() else {
        return Ok(false);
    };

    let metadata_db_path = local_data_dir.join("wallet-meta.sqlite3");

    if metadata_db_contains_wallet_accounts(&metadata_db_path)? {
        return Ok(true);
    }

    let entries = match fs::read_dir(local_data_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(WalletError::Io(error)),
    };

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("stronghold"))
        {
            return Ok(true);
        }
    }

    Ok(false)
}

fn managed_snapshot_dir(app: &AppHandle) -> Result<PathBuf, WalletError> {
    let paths = wallet_paths(app)?;
    paths
        .metadata_db_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or(WalletError::PathUnavailable)
}

fn validate_snapshot_path_in_directory(
    snapshot_path: &Path,
    managed_dir: &Path,
) -> Result<PathBuf, WalletError> {
    if !snapshot_path.is_absolute() {
        return Err(WalletError::MetadataCorrupted(
            "wallet snapshot path must be absolute".into(),
        ));
    }

    if !snapshot_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("stronghold"))
    {
        return Err(WalletError::MetadataCorrupted(
            "wallet snapshot path must target a .stronghold file".into(),
        ));
    }

    let file_name = snapshot_path.file_name().ok_or_else(|| {
        WalletError::MetadataCorrupted("wallet snapshot path is missing a file name".into())
    })?;
    let parent_dir = snapshot_path.parent().ok_or_else(|| {
        WalletError::MetadataCorrupted("wallet snapshot path is missing a parent directory".into())
    })?;
    let canonical_parent = fs::canonicalize(parent_dir)?;
    let canonical_managed_dir = fs::canonicalize(managed_dir)?;

    if canonical_parent != canonical_managed_dir {
        return Err(WalletError::MetadataCorrupted(
            "wallet snapshot path points outside the managed stronghold directory".into(),
        ));
    }

    Ok(canonical_managed_dir.join(file_name))
}

fn validated_snapshot_path(app: &AppHandle, snapshot_path: &str) -> Result<PathBuf, WalletError> {
    let managed_dir = managed_snapshot_dir(app)?;
    validate_snapshot_path_in_directory(Path::new(snapshot_path), &managed_dir)
}

fn metadata_db_contains_wallet_accounts(metadata_db_path: &Path) -> Result<bool, WalletError> {
    if !metadata_db_path.is_file() {
        return Ok(false);
    }

    let connection = Connection::open(metadata_db_path)?;
    let has_wallet_accounts_table = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wallet_accounts')",
        [],
        |row| row.get::<_, i64>(0),
    )?;

    if has_wallet_accounts_table == 0 {
        return Ok(false);
    }

    let wallet_count = connection.query_row("SELECT COUNT(*) FROM wallet_accounts", [], |row| {
        row.get::<_, i64>(0)
    })?;

    Ok(wallet_count > 0)
}

fn wallet_paths(app: &AppHandle) -> Result<WalletPaths, WalletError> {
    let local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| WalletError::PathUnavailable)?;

    fs::create_dir_all(&local_data_dir)?;

    Ok(WalletPaths {
        metadata_db_path: local_data_dir.join("wallet-meta.sqlite3"),
        salt_path: local_data_dir.join("salt.txt"),
    })
}

fn snapshot_path_for_account(app: &AppHandle, account_id: &str) -> Result<PathBuf, WalletError> {
    Ok(managed_snapshot_dir(app)?.join(format!("{account_id}.stronghold")))
}

fn pending_snapshot_path(
    app: &AppHandle,
    backup_access_token: &str,
) -> Result<PathBuf, WalletError> {
    let directory = managed_snapshot_dir(app)?;
    Ok(directory.join(format!(
        "pending-onboarding-{backup_access_token}.stronghold"
    )))
}

fn reset_snapshot_file(path: &Path) -> Result<(), WalletError> {
    if path.is_file() {
        fs::remove_file(path)?;
    }

    Ok(())
}

fn metadata_connection(app: &AppHandle) -> Result<Connection, WalletError> {
    let paths = wallet_paths(app)?;
    let connection = Connection::open(paths.metadata_db_path)?;

    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS wallet_accounts (
          account_id TEXT PRIMARY KEY,
          derivation_group_id TEXT NOT NULL,
          derivation_index INTEGER NOT NULL DEFAULT 0,
          wallet_label TEXT NOT NULL,
          address TEXT NOT NULL,
          source TEXT NOT NULL,
          secret_kind TEXT NOT NULL,
          biometric_enabled INTEGER NOT NULL,
          has_backed_up_mnemonic INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          last_unlocked_at TEXT,
          snapshot_path TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS wallet_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          active_account_id TEXT
        );
        CREATE TABLE IF NOT EXISTS ui_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_onboarding (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          backup_access_token TEXT NOT NULL,
          account_id TEXT NOT NULL,
          derivation_index INTEGER NOT NULL DEFAULT 0,
          wallet_label TEXT NOT NULL,
          address TEXT NOT NULL,
          is_biometric_enabled INTEGER NOT NULL,
          source TEXT NOT NULL,
          secret_kind TEXT NOT NULL,
          created_at TEXT NOT NULL,
          has_revealed_backup_phrase INTEGER NOT NULL DEFAULT 0,
          snapshot_path TEXT NOT NULL
        );
        "#,
    )?;

    ensure_wallet_accounts_schema(&connection)?;
    migrate_legacy_wallet_profile(app, &connection)?;

    Ok(connection)
}

fn ensure_wallet_accounts_schema(connection: &Connection) -> Result<(), WalletError> {
    let mut statement = connection.prepare("PRAGMA table_info(wallet_accounts)")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    let mut columns = Vec::new();

    for row in rows {
        columns.push(row?);
    }

    if !columns.iter().any(|column| column == "derivation_index") {
        connection.execute(
            "ALTER TABLE wallet_accounts ADD COLUMN derivation_index INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !columns.iter().any(|column| column == "derivation_group_id") {
        connection.execute(
            "ALTER TABLE wallet_accounts ADD COLUMN derivation_group_id TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    connection.execute(
        r#"
        UPDATE wallet_accounts
        SET derivation_group_id = account_id
        WHERE derivation_group_id = ''
        "#,
        [],
    )?;

    Ok(())
}

fn load_wallet_accounts(app: &AppHandle) -> Result<Vec<StoredWalletMetadata>, WalletError> {
    let connection = metadata_connection(app)?;

    let mut statement = connection.prepare(
        r#"
        SELECT
          account_id,
          derivation_group_id,
          derivation_index,
          wallet_label,
          address,
          source,
          secret_kind,
          biometric_enabled,
          has_backed_up_mnemonic,
          created_at,
          last_unlocked_at,
          snapshot_path
        FROM wallet_accounts
        ORDER BY datetime(created_at) DESC
        "#,
    )?;

    let rows = statement.query_map([], load_wallet_metadata_from_row)?;
    let mut accounts = Vec::new();

    for row in rows {
        accounts.push(row?);
    }

    Ok(accounts)
}

fn load_wallet_metadata(
    app: &AppHandle,
    account_id: &str,
) -> Result<Option<StoredWalletMetadata>, WalletError> {
    let connection = metadata_connection(app)?;

    connection
        .query_row(
            r#"
            SELECT
              account_id,
              derivation_group_id,
              derivation_index,
              wallet_label,
              address,
              source,
              secret_kind,
              biometric_enabled,
              has_backed_up_mnemonic,
              created_at,
              last_unlocked_at,
              snapshot_path
            FROM wallet_accounts
            WHERE account_id = ?1
            "#,
            params![account_id],
            load_wallet_metadata_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn load_active_account_id(app: &AppHandle) -> Result<Option<String>, WalletError> {
    let connection = metadata_connection(app)?;

    connection
        .query_row(
            "SELECT active_account_id FROM wallet_state WHERE id = 1",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|value| value.flatten())
        .map_err(Into::into)
}

fn normalize_active_account_id(
    active_account_id: Option<String>,
    accounts: &[StoredWalletMetadata],
) -> Option<String> {
    if accounts.is_empty() {
        return None;
    }

    match active_account_id {
        Some(account_id)
            if accounts
                .iter()
                .any(|metadata| metadata.account_id == account_id) =>
        {
            Some(account_id)
        }
        _ => accounts.first().map(|metadata| metadata.account_id.clone()),
    }
}

fn load_persisted_ui_state(app: &AppHandle) -> Result<PersistedUiStateEnvelope, WalletError> {
    let connection = metadata_connection(app)?;
    let payload = connection
        .query_row("SELECT payload FROM ui_state WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()?;

    let Some(payload) = payload else {
        return Ok(PersistedUiStateEnvelope::default());
    };

    serde_json::from_str::<PersistedUiStateEnvelope>(&payload).map_err(|error| {
        WalletError::MetadataCorrupted(format!("ui state payload decode failed: {error}"))
    })
}

fn sanitize_persisted_ui_state(
    app: &AppHandle,
    mut state: PersistedUiStateEnvelope,
) -> Result<PersistedUiStateEnvelope, WalletError> {
    let known_account_ids = load_wallet_accounts(app)?
        .into_iter()
        .map(|metadata| metadata.account_id)
        .collect::<HashSet<_>>();
    state
        .wallet_scopes
        .retain(|account_id, _| known_account_ids.contains(account_id));
    Ok(state)
}

fn save_persisted_ui_state(
    app: &AppHandle,
    state: &PersistedUiStateEnvelope,
) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    let payload = serde_json::to_string(state).map_err(|error| {
        WalletError::MetadataCorrupted(format!("ui state payload encode failed: {error}"))
    })?;

    connection.execute(
        r#"
        INSERT INTO ui_state (
          id,
          payload
        )
        VALUES (1, ?1)
        ON CONFLICT(id) DO UPDATE SET
          payload = excluded.payload
        "#,
        params![payload],
    )?;

    Ok(())
}

fn save_active_account_id(app: &AppHandle, account_id: Option<&str>) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    connection.execute(
        r#"
        INSERT INTO wallet_state (
          id,
          active_account_id
        )
        VALUES (1, ?1)
        ON CONFLICT(id) DO UPDATE SET
          active_account_id = excluded.active_account_id
        "#,
        params![account_id],
    )?;

    Ok(())
}

fn save_pending_onboarding(
    app: &AppHandle,
    pending: &PendingOnboarding,
) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    connection.execute(
        r#"
        INSERT INTO pending_onboarding (
          id,
          backup_access_token,
          account_id,
          derivation_index,
          wallet_label,
          address,
          is_biometric_enabled,
          source,
          secret_kind,
          created_at,
          has_revealed_backup_phrase,
          snapshot_path
        )
        VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
          backup_access_token = excluded.backup_access_token,
          account_id = excluded.account_id,
          derivation_index = excluded.derivation_index,
          wallet_label = excluded.wallet_label,
          address = excluded.address,
          is_biometric_enabled = excluded.is_biometric_enabled,
          source = excluded.source,
          secret_kind = excluded.secret_kind,
          created_at = excluded.created_at,
          has_revealed_backup_phrase = excluded.has_revealed_backup_phrase,
          snapshot_path = excluded.snapshot_path
        "#,
        params![
            &pending.backup_access_token,
            &pending.draft.account_id,
            pending.draft.derivation_index as i64,
            &pending.draft.wallet_label,
            &pending.draft.address,
            pending.draft.is_biometric_enabled as i64,
            pending.draft.source.as_str(),
            pending.draft.secret_kind.as_str(),
            &pending.draft.created_at,
            pending.has_revealed_backup_phrase as i64,
            &pending.snapshot_path,
        ],
    )?;

    Ok(())
}

fn load_pending_onboarding(app: &AppHandle) -> Result<Option<PendingOnboarding>, WalletError> {
    let connection = metadata_connection(app)?;

    connection
        .query_row(
            r#"
            SELECT
              backup_access_token,
              account_id,
              derivation_index,
              wallet_label,
              address,
              is_biometric_enabled,
              source,
              secret_kind,
              created_at,
              has_revealed_backup_phrase,
              snapshot_path
            FROM pending_onboarding
            WHERE id = 1
            "#,
            [],
            |row| {
                let derivation_index = row.get::<_, i64>(2).and_then(|value| {
                    u32::try_from(value).map_err(|_| {
                        to_sql_conversion_error(WalletError::MetadataCorrupted(
                            "pending onboarding derivation index is out of range".into(),
                        ))
                    })
                })?;
                let source = WalletSource::from_db_value(&row.get::<_, String>(6)?)
                    .map_err(to_sql_conversion_error)?;
                let secret_kind = SecretKind::from_db_value(&row.get::<_, String>(7)?)
                    .map_err(to_sql_conversion_error)?;

                Ok(PendingOnboarding {
                    backup_access_token: row.get(0)?,
                    draft: PendingWalletDraft {
                        account_id: row.get(1)?,
                        derivation_index,
                        wallet_label: row.get(3)?,
                        address: row.get(4)?,
                        is_biometric_enabled: row.get::<_, i64>(5)? != 0,
                        source,
                        secret_kind,
                        created_at: row.get(8)?,
                    },
                    has_revealed_backup_phrase: row.get::<_, i64>(9)? != 0,
                    snapshot_path: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn clear_pending_onboarding_record(app: &AppHandle) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    connection.execute("DELETE FROM pending_onboarding WHERE id = 1", [])?;
    Ok(())
}

fn get_pending_onboarding(
    app: &AppHandle,
    state: &State<'_, WalletRuntimeState>,
) -> Result<Option<PendingOnboarding>, WalletError> {
    let cached = state.pending_onboarding.lock().unwrap().clone();

    if cached.is_some() {
        return Ok(cached);
    }

    let stored = load_pending_onboarding(app)?;
    *state.pending_onboarding.lock().unwrap() = stored.clone();
    Ok(stored)
}

fn mark_pending_onboarding_revealed(
    app: &AppHandle,
    state: &State<'_, WalletRuntimeState>,
) -> Result<(), WalletError> {
    let mut guard = state.pending_onboarding.lock().unwrap();
    let pending = guard.as_mut().ok_or(WalletError::NoPendingWallet)?;
    pending.has_revealed_backup_phrase = true;
    save_pending_onboarding(app, pending)
}

fn clear_pending_onboarding(
    app: &AppHandle,
    state: &State<'_, WalletRuntimeState>,
) -> Result<(), WalletError> {
    let pending = get_pending_onboarding(app, state)?;

    if let Some(pending) = pending {
        let snapshot_path = validated_snapshot_path(app, &pending.snapshot_path)?;
        if snapshot_path.is_file() {
            fs::remove_file(snapshot_path)?;
        }
    }

    clear_pending_onboarding_record(app)?;
    *state.pending_onboarding.lock().unwrap() = None;
    Ok(())
}

fn save_wallet_metadata(
    app: &AppHandle,
    metadata: &StoredWalletMetadata,
) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    connection.execute(
        r#"
        INSERT INTO wallet_accounts (
          account_id,
          derivation_group_id,
          derivation_index,
          wallet_label,
          address,
          source,
          secret_kind,
          biometric_enabled,
          has_backed_up_mnemonic,
          created_at,
          last_unlocked_at,
          snapshot_path
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(account_id) DO UPDATE SET
          derivation_group_id = excluded.derivation_group_id,
          derivation_index = excluded.derivation_index,
          wallet_label = excluded.wallet_label,
          address = excluded.address,
          source = excluded.source,
          secret_kind = excluded.secret_kind,
          biometric_enabled = excluded.biometric_enabled,
          has_backed_up_mnemonic = excluded.has_backed_up_mnemonic,
          created_at = excluded.created_at,
          last_unlocked_at = excluded.last_unlocked_at,
          snapshot_path = excluded.snapshot_path
        "#,
        params![
            &metadata.account_id,
            &metadata.derivation_group_id,
            metadata.derivation_index as i64,
            &metadata.wallet_label,
            &metadata.address,
            metadata.source.as_str(),
            metadata.secret_kind.as_str(),
            metadata.is_biometric_enabled as i64,
            metadata.has_backed_up_mnemonic as i64,
            &metadata.created_at,
            &metadata.last_unlocked_at,
            &metadata.snapshot_path,
        ],
    )?;

    Ok(())
}

fn delete_wallet_metadata(app: &AppHandle, account_id: &str) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    connection.execute(
        "DELETE FROM wallet_accounts WHERE account_id = ?1",
        params![account_id],
    )?;

    Ok(())
}

fn update_last_unlocked_at(
    app: &AppHandle,
    account_id: &str,
    last_unlocked_at: &str,
) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    connection.execute(
        "UPDATE wallet_accounts SET last_unlocked_at = ?1 WHERE account_id = ?2",
        params![last_unlocked_at, account_id],
    )?;
    Ok(())
}

fn migrate_legacy_wallet_profile(
    app: &AppHandle,
    connection: &Connection,
) -> Result<(), WalletError> {
    let has_legacy_table = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wallet_profile')",
        [],
        |row| row.get::<_, i64>(0),
    )? != 0;

    if !has_legacy_table {
        return Ok(());
    }

    let existing_count =
        connection.query_row("SELECT COUNT(*) FROM wallet_accounts", [], |row| {
            row.get::<_, i64>(0)
        })?;

    if existing_count > 0 {
        return Ok(());
    }

    let legacy = connection
        .query_row(
            r#"
            SELECT
              wallet_label,
              address,
              source,
              secret_kind,
              biometric_enabled,
              has_backed_up_mnemonic,
              created_at,
              last_unlocked_at,
              snapshot_path
            FROM wallet_profile
            WHERE id = 1
            "#,
            [],
            |row| {
                let address: String = row.get(1)?;

                Ok(StoredWalletMetadata {
                    account_id: build_account_id(&address),
                    derivation_group_id: build_account_id(&address),
                    derivation_index: 0,
                    wallet_label: row.get(0)?,
                    address,
                    source: WalletSource::from_db_value(&row.get::<_, String>(2)?)
                        .map_err(to_sql_conversion_error)?,
                    secret_kind: SecretKind::from_db_value(&row.get::<_, String>(3)?)
                        .map_err(to_sql_conversion_error)?,
                    is_biometric_enabled: row.get::<_, i64>(4)? != 0,
                    has_backed_up_mnemonic: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    last_unlocked_at: row.get(7)?,
                    snapshot_path: row.get(8)?,
                })
            },
        )
        .optional()?;

    if let Some(metadata) = legacy {
        connection.execute(
            r#"
            INSERT OR IGNORE INTO wallet_accounts (
              account_id,
              derivation_group_id,
              derivation_index,
              wallet_label,
              address,
              source,
              secret_kind,
              biometric_enabled,
              has_backed_up_mnemonic,
              created_at,
              last_unlocked_at,
              snapshot_path
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                &metadata.account_id,
                &metadata.derivation_group_id,
                metadata.derivation_index as i64,
                &metadata.wallet_label,
                &metadata.address,
                metadata.source.as_str(),
                metadata.secret_kind.as_str(),
                metadata.is_biometric_enabled as i64,
                metadata.has_backed_up_mnemonic as i64,
                &metadata.created_at,
                &metadata.last_unlocked_at,
                &metadata.snapshot_path,
            ],
        )?;

        let active_account_id = metadata.account_id.clone();
        connection.execute(
            r#"
            INSERT INTO wallet_state (id, active_account_id)
            VALUES (1, ?1)
            ON CONFLICT(id) DO UPDATE SET
              active_account_id = excluded.active_account_id
            "#,
            params![active_account_id],
        )?;
    }

    let _ = app;

    Ok(())
}

fn load_wallet_metadata_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<StoredWalletMetadata, rusqlite::Error> {
    let derivation_index = row.get::<_, i64>(2).and_then(|value| {
        u32::try_from(value).map_err(|_| {
            to_sql_conversion_error(WalletError::MetadataCorrupted(
                "wallet derivation index is out of range".into(),
            ))
        })
    })?;

    Ok(StoredWalletMetadata {
        account_id: row.get(0)?,
        derivation_group_id: row.get(1)?,
        derivation_index,
        wallet_label: row.get(3)?,
        address: row.get(4)?,
        source: WalletSource::from_db_value(&row.get::<_, String>(5)?)
            .map_err(to_sql_conversion_error)?,
        secret_kind: SecretKind::from_db_value(&row.get::<_, String>(6)?)
            .map_err(to_sql_conversion_error)?,
        is_biometric_enabled: row.get::<_, i64>(7)? != 0,
        has_backed_up_mnemonic: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        last_unlocked_at: row.get(10)?,
        snapshot_path: row.get(11)?,
    })
}

fn delete_snapshot_if_unused(
    app: &AppHandle,
    snapshot_path: &str,
    remaining_accounts: &[StoredWalletMetadata],
) -> Result<(), WalletError> {
    if remaining_accounts
        .iter()
        .any(|entry| entry.snapshot_path == snapshot_path)
    {
        return Ok(());
    }

    let snapshot_file = validated_snapshot_path(app, snapshot_path)?;

    if snapshot_file.is_file() {
        fs::remove_file(snapshot_file)?;
    }

    Ok(())
}

fn generate_pending_backup_access_token() -> String {
    let mut random_bytes = [0u8; 32];
    let mut rng = thread_rng();
    rng.fill_bytes(&mut random_bytes);
    hex::encode(random_bytes)
}

fn load_pending_mnemonic(
    app: &AppHandle,
    pending: &PendingOnboarding,
    password: &str,
) -> Result<String, WalletError> {
    let snapshot_path = validated_snapshot_path(app, &pending.snapshot_path)?;
    let (secret_kind, secret_record) =
        load_secret_from_snapshot_path(&snapshot_path, password, &wallet_paths(app)?.salt_path)
            .map_err(|error| match error {
                WalletError::InvalidPendingWallet | WalletError::MissingSigningSecret => {
                    WalletError::InvalidPendingWallet
                }
                other => normalize_secret_access_error(other),
            })?;

    if secret_kind != SecretKind::Mnemonic {
        return Err(WalletError::InvalidPendingWallet);
    }

    let mnemonic_phrase = std::str::from_utf8(secret_record.as_ref())
        .map_err(|_| WalletError::InvalidPendingWallet)?;
    let mnemonic = Mnemonic::parse_in_normalized(Language::English, mnemonic_phrase)
        .map_err(WalletError::from)?;

    Ok(mnemonic.to_string())
}

fn build_account_id(address: &str) -> String {
    format!("account-{}", address.trim().to_lowercase())
}

fn ensure_wallet_address_is_unique(app: &AppHandle, address: &str) -> Result<(), WalletError> {
    let normalized = address.trim().to_lowercase();

    if load_wallet_accounts(app)?
        .into_iter()
        .any(|metadata| metadata.address.to_lowercase() == normalized)
    {
        Err(WalletError::DuplicateWalletAddress)
    } else {
        Ok(())
    }
}

fn next_mnemonic_derivation_index(
    app: &AppHandle,
    derivation_group_id: &str,
) -> Result<u32, WalletError> {
    let accounts = load_wallet_accounts(app)?;
    let max_index = accounts
        .into_iter()
        .filter(|metadata| {
            metadata.secret_kind == SecretKind::Mnemonic
                && metadata.derivation_group_id == derivation_group_id
        })
        .map(|metadata| metadata.derivation_index)
        .max()
        .unwrap_or(0);

    Ok(max_index.saturating_add(1))
}

fn to_sql_conversion_error(error: WalletError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_dir(test_name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("web3-wallet-{test_name}-{timestamp}"));
        path
    }

    #[test]
    fn backup_access_tokens_are_hex_encoded() {
        let token = generate_pending_backup_access_token();

        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn refuses_to_regenerate_salt_when_wallet_storage_already_exists() {
        let temp_dir = unique_temp_dir("salt-missing");
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(temp_dir.join("wallet.stronghold"), b"legacy-wallet").unwrap();

        let result = derive_stronghold_password_hash("super-secret", &temp_dir.join("salt.txt"));

        assert!(matches!(result, Err(WalletError::StrongholdSaltMissing)));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn allows_generating_salt_when_metadata_db_only_contains_ui_state() {
        let temp_dir = unique_temp_dir("ui-state-only");
        fs::create_dir_all(&temp_dir).unwrap();
        let metadata_db_path = temp_dir.join("wallet-meta.sqlite3");
        let connection = Connection::open(&metadata_db_path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE ui_state (
                  id INTEGER PRIMARY KEY CHECK (id = 1),
                  payload TEXT NOT NULL
                );
                INSERT INTO ui_state (id, payload) VALUES (1, '{}');
                "#,
            )
            .unwrap();

        let result = derive_stronghold_password_hash("super-secret", &temp_dir.join("salt.txt"));

        assert!(result.is_ok());
        assert!(temp_dir.join("salt.txt").is_file());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn refuses_to_regenerate_salt_when_metadata_db_contains_wallet_accounts() {
        let temp_dir = unique_temp_dir("wallet-accounts-existing");
        fs::create_dir_all(&temp_dir).unwrap();
        let metadata_db_path = temp_dir.join("wallet-meta.sqlite3");
        let connection = Connection::open(&metadata_db_path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE wallet_accounts (
                  account_id TEXT NOT NULL
                );
                INSERT INTO wallet_accounts (account_id) VALUES ('account-1');
                "#,
            )
            .unwrap();

        let result = derive_stronghold_password_hash("super-secret", &temp_dir.join("salt.txt"));

        assert!(matches!(result, Err(WalletError::StrongholdSaltMissing)));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn accepts_snapshot_paths_inside_the_managed_directory() {
        let temp_dir = unique_temp_dir("snapshot-path-ok");
        let managed_dir = temp_dir.join("wallet-data");
        fs::create_dir_all(&managed_dir).unwrap();
        let snapshot_path = managed_dir.join("account-1.stronghold");

        let result = validate_snapshot_path_in_directory(&snapshot_path, &managed_dir);

        assert_eq!(result.unwrap(), snapshot_path);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn rejects_snapshot_paths_outside_the_managed_directory() {
        let temp_dir = unique_temp_dir("snapshot-path-outside");
        let managed_dir = temp_dir.join("wallet-data");
        let outside_dir = temp_dir.join("outside");
        fs::create_dir_all(&managed_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        let snapshot_path = outside_dir.join("account-1.stronghold");

        let result = validate_snapshot_path_in_directory(&snapshot_path, &managed_dir);

        assert!(matches!(result, Err(WalletError::MetadataCorrupted(_))));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn preserves_structural_secret_access_errors() {
        let error = normalize_secret_access_error(WalletError::StrongholdSaltMissing);
        assert!(matches!(error, WalletError::StrongholdSaltMissing));

        let normalized =
            normalize_secret_access_error(WalletError::Stronghold("bad password".into()));
        assert!(matches!(normalized, WalletError::InvalidWalletPassword));
    }

    #[test]
    fn normalizes_stale_active_account_ids() {
        let accounts = vec![
            StoredWalletMetadata {
                account_id: "account-1".into(),
                derivation_group_id: "account-1".into(),
                derivation_index: 0,
                wallet_label: "Primary".into(),
                address: "0x1111111111111111111111111111111111111111".into(),
                source: WalletSource::Created,
                secret_kind: SecretKind::Mnemonic,
                is_biometric_enabled: true,
                has_backed_up_mnemonic: true,
                created_at: now_rfc3339(),
                last_unlocked_at: None,
                snapshot_path: "/tmp/account-1.stronghold".into(),
            },
            StoredWalletMetadata {
                account_id: "account-2".into(),
                derivation_group_id: "account-2".into(),
                derivation_index: 0,
                wallet_label: "Backup".into(),
                address: "0x2222222222222222222222222222222222222222".into(),
                source: WalletSource::Imported,
                secret_kind: SecretKind::PrivateKey,
                is_biometric_enabled: false,
                has_backed_up_mnemonic: false,
                created_at: now_rfc3339(),
                last_unlocked_at: None,
                snapshot_path: "/tmp/account-2.stronghold".into(),
            },
        ];

        assert_eq!(
            normalize_active_account_id(Some("missing-account".into()), &accounts),
            Some("account-1".into())
        );
        assert_eq!(
            normalize_active_account_id(Some("account-2".into()), &accounts),
            Some("account-2".into())
        );
    }

    #[test]
    fn rejects_negative_derivation_indices_from_metadata_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE wallet_accounts (
                  account_id TEXT NOT NULL,
                  derivation_group_id TEXT NOT NULL,
                  derivation_index INTEGER NOT NULL,
                  wallet_label TEXT NOT NULL,
                  address TEXT NOT NULL,
                  source TEXT NOT NULL,
                  secret_kind TEXT NOT NULL,
                  biometric_enabled INTEGER NOT NULL,
                  has_backed_up_mnemonic INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  last_unlocked_at TEXT,
                  snapshot_path TEXT NOT NULL
                );
                INSERT INTO wallet_accounts (
                  account_id,
                  derivation_group_id,
                  derivation_index,
                  wallet_label,
                  address,
                  source,
                  secret_kind,
                  biometric_enabled,
                  has_backed_up_mnemonic,
                  created_at,
                  last_unlocked_at,
                  snapshot_path
                ) VALUES (
                  'account-1',
                  'account-1',
                  -1,
                  'Primary',
                  '0x1111111111111111111111111111111111111111',
                  'created',
                  'mnemonic',
                  1,
                  1,
                  '2026-04-07T00:00:00Z',
                  NULL,
                  '/tmp/account-1.stronghold'
                );
                "#,
            )
            .unwrap();

        let result = connection.query_row(
            r#"
            SELECT
              account_id,
              derivation_group_id,
              derivation_index,
              wallet_label,
              address,
              source,
              secret_kind,
              biometric_enabled,
              has_backed_up_mnemonic,
              created_at,
              last_unlocked_at,
              snapshot_path
            FROM wallet_accounts
            "#,
            [],
            load_wallet_metadata_from_row,
        );

        assert!(matches!(
            result,
            Err(rusqlite::Error::FromSqlConversionFailure(..))
        ));
    }

    #[test]
    fn sensitive_operation_attempts_lock_after_repeated_failures() {
        let mut attempts = HashMap::new();
        let operation_key = sensitive_operation_key(SENSITIVE_OPERATION_UNLOCK, "account-1");

        register_sensitive_operation_failure(&mut attempts, &operation_key, 100);
        assert_eq!(
            retry_after_seconds_for_sensitive_attempt(&mut attempts, &operation_key, 100),
            None
        );

        register_sensitive_operation_failure(&mut attempts, &operation_key, 101);
        assert_eq!(
            retry_after_seconds_for_sensitive_attempt(&mut attempts, &operation_key, 101),
            None
        );

        register_sensitive_operation_failure(&mut attempts, &operation_key, 102);
        assert_eq!(
            retry_after_seconds_for_sensitive_attempt(&mut attempts, &operation_key, 102),
            Some(2)
        );

        register_sensitive_operation_failure(&mut attempts, &operation_key, 105);
        assert_eq!(
            retry_after_seconds_for_sensitive_attempt(&mut attempts, &operation_key, 105),
            Some(4)
        );
    }

    #[test]
    fn sensitive_operation_attempts_reset_after_idle_window() {
        let mut attempts = HashMap::new();
        let operation_key = sensitive_operation_key(SENSITIVE_OPERATION_SIGN_TRANSFER, "account-2");

        register_sensitive_operation_failure(&mut attempts, &operation_key, 10);
        register_sensitive_operation_failure(&mut attempts, &operation_key, 11);
        register_sensitive_operation_failure(&mut attempts, &operation_key, 12);
        assert_eq!(
            retry_after_seconds_for_sensitive_attempt(&mut attempts, &operation_key, 12),
            Some(2)
        );

        let after_window = 12 + SENSITIVE_ATTEMPT_RESET_SECONDS + 1;
        assert_eq!(
            retry_after_seconds_for_sensitive_attempt(&mut attempts, &operation_key, after_window),
            None
        );

        register_sensitive_operation_failure(&mut attempts, &operation_key, after_window);
        assert_eq!(
            retry_after_seconds_for_sensitive_attempt(&mut attempts, &operation_key, after_window),
            None
        );
    }

    #[test]
    fn wallet_error_serialization_masks_internal_details() {
        let serialized =
            serde_json::to_string(&WalletError::Stronghold("db at /tmp/secret.db".into())).unwrap();
        assert!(serialized.contains("[INTERNAL]"));
        assert!(!serialized.contains("/tmp/secret.db"));
    }
}
