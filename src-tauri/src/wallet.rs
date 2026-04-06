use std::{
    convert::TryFrom,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use alloy_consensus::{
    SignableTransaction, TxEip1559, TxEnvelope, TxLegacy, Typed2718, TypedTransaction,
};
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
use k256::{ecdsa::SigningKey, elliptic_curve::sec1::ToEncodedPoint, NonZeroScalar};
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
const ETH_BIP44_PREFIX: [u32; 4] = [44 + BIP32_HARDEN, 60 + BIP32_HARDEN, 0 + BIP32_HARDEN, 0];
const BIP32_HARDEN: u32 = 0x8000_0000;

type HmacSha512 = Hmac<Sha512>;
type WalletCommandResult<T> = Result<T, String>;

#[derive(Default)]
pub struct WalletRuntimeState {
    pending_onboarding: Mutex<Option<PendingOnboarding>>,
}

struct PendingOnboarding {
    draft: PendingWalletDraft,
    password: Zeroizing<String>,
    mnemonic: Zeroizing<String>,
}

#[derive(Debug)]
struct WalletPaths {
    metadata_db_path: PathBuf,
    snapshot_path: PathBuf,
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
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeeMode {
    Legacy,
    Eip1559,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransferAsset {
    Native,
    Erc20 { contract_address: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignTransferRequest {
    account_id: String,
    password: String,
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
pub struct SignedTransferPayload {
    raw_transaction: String,
    tx_hash: String,
}

#[derive(Debug, Error)]
enum WalletError {
    #[error("钱包名称不能为空")]
    EmptyWalletLabel,
    #[error("钱包密码至少需要 8 位")]
    PasswordTooShort,
    #[error("当前没有待确认的创建流程")]
    NoPendingWallet,
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
    #[error("交易签名失败: {0}")]
    SigningFailed(String),
}

#[tauri::command]
pub fn create_wallet(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
    request: CreateWalletRequest,
) -> WalletCommandResult<PendingWalletDraft> {
    let request = normalize_create_request(request)?;

    let mnemonic = Mnemonic::generate_in(Language::English, 12)?;
    let mnemonic_phrase = Zeroizing::new(mnemonic.to_string());
    let private_key = derive_private_key_from_mnemonic(&mnemonic, 0)?;
    let address = address_from_private_key(private_key.as_ref())?;
    ensure_wallet_address_is_unique(&app, &address)?;
    let account_id = build_account_id(&address);

    let draft = PendingWalletDraft {
        account_id,
        derivation_index: 0,
        wallet_label: request.wallet_label,
        address,
        is_biometric_enabled: request.is_biometric_enabled,
        source: WalletSource::Created,
        secret_kind: SecretKind::Mnemonic,
        created_at: now_rfc3339(),
    };

    let pending = PendingOnboarding {
        draft: draft.clone(),
        password: Zeroizing::new(request.password),
        mnemonic: mnemonic_phrase,
    };

    let mut guard = state.pending_onboarding.lock().unwrap();
    *guard = Some(pending);

    Ok(draft)
}

#[tauri::command]
pub fn load_pending_wallet_draft(
    state: State<'_, WalletRuntimeState>,
) -> WalletCommandResult<Option<PendingWalletDraft>> {
    Ok(state
        .pending_onboarding
        .lock()
        .unwrap()
        .as_ref()
        .map(|pending| pending.draft.clone()))
}

#[tauri::command]
pub fn get_pending_backup_phrase(
    state: State<'_, WalletRuntimeState>,
) -> WalletCommandResult<String> {
    let guard = state.pending_onboarding.lock().unwrap();
    let pending = guard.as_ref().ok_or(WalletError::NoPendingWallet)?;

    if !matches!(pending.draft.secret_kind, SecretKind::Mnemonic) {
        return Err(WalletError::InvalidPendingWallet.to_string());
    }

    Ok(pending.mnemonic.to_string())
}

#[tauri::command]
pub fn cancel_pending_wallet(state: State<'_, WalletRuntimeState>) -> WalletCommandResult<()> {
    let mut guard = state.pending_onboarding.lock().unwrap();
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn finalize_pending_wallet(
    app: AppHandle,
    state: State<'_, WalletRuntimeState>,
) -> WalletCommandResult<WalletProfile> {
    let pending = {
        let mut guard = state.pending_onboarding.lock().unwrap();
        guard.take().ok_or(WalletError::NoPendingWallet)?
    };

    ensure_wallet_address_is_unique(&app, &pending.draft.address)?;

    let result = persist_wallet_secret(
        &app,
        &pending.password,
        pending.mnemonic.as_bytes(),
        SecretKind::Mnemonic,
        &StoredWalletMetadata {
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
            snapshot_path: snapshot_path_for_account(&app, &pending.draft.account_id)?
                .to_string_lossy()
                .into_owned(),
        },
    );

    match result {
        Ok(profile) => Ok(profile),
        Err(error) => {
            let mut guard = state.pending_onboarding.lock().unwrap();
            *guard = Some(pending);
            Err(error.to_string())
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

    {
        let mut guard = state.pending_onboarding.lock().unwrap();
        *guard = None;
    }

    let (address, secret_bytes) = match request.secret_kind {
        SecretKind::Mnemonic => {
            let normalized = normalize_mnemonic_phrase(&request.secret_value);
            let mnemonic = Mnemonic::parse_in_normalized(Language::English, &normalized)?;
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
    .map_err(Into::into)
}

#[tauri::command]
pub fn derive_mnemonic_account(
    app: AppHandle,
    request: DeriveMnemonicAccountRequest,
) -> WalletCommandResult<WalletProfile> {
    let request = normalize_derive_request(request)?;
    let source_metadata = load_wallet_metadata(&app, &request.source_account_id)?
        .ok_or(WalletError::WalletNotInitialized)?;

    if source_metadata.secret_kind != SecretKind::Mnemonic {
        return Err(WalletError::MnemonicDerivationNotSupported.to_string());
    }

    let mnemonic = load_mnemonic_for_derivation(&app, &source_metadata, &request.password)?;
    let next_derivation_index =
        next_mnemonic_derivation_index(&app, &source_metadata.derivation_group_id)?;
    let private_key = derive_private_key_from_mnemonic(&mnemonic, next_derivation_index)?;
    let address = address_from_private_key(private_key.as_ref())?;
    ensure_wallet_address_is_unique(&app, &address)?;

    let now = now_rfc3339();
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
        snapshot_path: source_metadata.snapshot_path,
    };

    save_wallet_metadata(&app, &next_metadata)?;
    save_active_account_id(&app, Some(&next_metadata.account_id))?;

    Ok(next_metadata.into())
}

#[tauri::command]
pub fn rename_wallet_account(
    app: AppHandle,
    request: RenameWalletAccountRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
    let request = normalize_rename_request(request)?;
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
    request: DeleteWalletAccountRequest,
) -> WalletCommandResult<WalletSessionSnapshot> {
    let metadata = load_wallet_metadata(&app, &request.account_id)?
        .ok_or(WalletError::WalletAccountNotFound)?;
    let deleted_account_id = metadata.account_id.clone();
    let deleted_snapshot_path = metadata.snapshot_path.clone();
    let previous_active_account_id = load_active_account_id(&app)?;

    delete_wallet_metadata(&app, &request.account_id)?;

    let remaining_accounts = load_wallet_accounts(&app)?;
    delete_snapshot_if_unused(&deleted_snapshot_path, &remaining_accounts)?;

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
    let accounts = load_wallet_accounts(&app)?
        .into_iter()
        .map(WalletProfile::from)
        .collect::<Vec<_>>();

    Ok(WalletSessionSnapshot {
        accounts,
        active_account_id: load_active_account_id(&app)?,
    })
}

#[tauri::command]
pub fn load_wallet_profile(app: AppHandle) -> WalletCommandResult<Option<WalletProfile>> {
    let active_account_id = load_active_account_id(&app)?;
    let metadata = match active_account_id {
        Some(account_id) => load_wallet_metadata(&app, &account_id)?,
        None => load_wallet_accounts(&app)?.into_iter().next(),
    };

    Ok(metadata.map(Into::into))
}

#[tauri::command]
pub fn unlock_wallet(
    app: AppHandle,
    request: UnlockWalletRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
    let metadata = match load_wallet_metadata(&app, &request.account_id)? {
        Some(metadata) => metadata,
        None => return Ok(None),
    };

    let stronghold = open_stronghold(
        Path::new(&metadata.snapshot_path),
        &request.password,
        &wallet_paths(&app)?.salt_path,
    );

    let stronghold = match stronghold {
        Ok(stronghold) => stronghold,
        Err(_) => return Ok(None),
    };

    if stronghold.load_client(STRONGHOLD_CLIENT.to_vec()).is_err() {
        return Ok(None);
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
    request: SetActiveWalletRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
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
    request: UpdateBiometricRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
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
pub fn sign_transfer_transaction(
    app: AppHandle,
    request: SignTransferRequest,
) -> WalletCommandResult<SignedTransferPayload> {
    let metadata = load_wallet_metadata(&app, &request.account_id)?
        .ok_or(WalletError::WalletNotInitialized)?;
    let private_key = load_private_key_for_signing(&app, &metadata, &request.password)?;
    let tx = build_transfer_transaction(&request)?;

    let signer = PrivateKeySigner::from_slice(private_key.as_ref())
        .map_err(|_| WalletError::InvalidPrivateKey)?;
    let mut tx = tx;
    let signature = signer
        .sign_hash_sync(&tx.signature_hash())
        .map_err(|error| WalletError::SigningFailed(error.to_string()))?;
    let envelope: TxEnvelope = tx.into_envelope(signature);
    let raw_transaction = envelope.encoded_2718();

    Ok(SignedTransferPayload {
        raw_transaction: format!("0x{}", hex::encode(raw_transaction)),
        tx_hash: format!("0x{}", hex::encode(envelope.tx_hash().as_slice())),
    })
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

    (signing_key, chain_code) =
        derive_child_signing_key(&signing_key, &chain_code, derivation_index)?;

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
    let parent_scalar =
        NonZeroScalar::from_repr(parent_key.to_bytes()).ok_or(WalletError::KeyDerivationFailed)?;
    let tweaked = tweak.add(&parent_scalar);
    let child_scalar =
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

fn address_from_private_key(private_key: &[u8; 32]) -> Result<String, WalletError> {
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
    let snapshot_path = Path::new(&metadata.snapshot_path);
    let paths = wallet_paths(app)?;

    let stronghold = open_stronghold(snapshot_path, password, &paths.salt_path)
        .map_err(|_| WalletError::InvalidWalletPassword)?;
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

    if secret_kind != metadata.secret_kind {
        return Err(WalletError::InvalidStoredSecret);
    }

    Ok((
        secret_kind,
        Zeroizing::new(secret_record[delimiter + 1..].to_vec()),
    ))
}

fn build_transfer_transaction(
    request: &SignTransferRequest,
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
    let paths = wallet_paths(app)?;
    let snapshot_file_path = PathBuf::from(&metadata.snapshot_path);
    let stronghold = open_stronghold(&snapshot_file_path, password, &paths.salt_path)?;
    let snapshot_path = iota_stronghold::SnapshotPath::from_path(&snapshot_file_path);
    let client = match stronghold.load_client(STRONGHOLD_CLIENT.to_vec()) {
        Ok(client) => client,
        Err(_) => stronghold
            .create_client(STRONGHOLD_CLIENT.to_vec())
            .map_err(|error| WalletError::Stronghold(error.to_string()))?,
    };

    let mut secret_payload = Vec::with_capacity(secret_bytes.len() + 16);
    secret_payload.extend_from_slice(secret_kind.as_str().as_bytes());
    secret_payload.push(b':');
    secret_payload.extend_from_slice(secret_bytes);

    client
        .store()
        .insert(STRONGHOLD_RECORD.to_vec(), secret_payload, None)
        .map_err(|error| WalletError::Stronghold(error.to_string()))?;

    stronghold
        .commit_with_keyprovider(
            &snapshot_path,
            &stronghold_key_provider(password, &paths.salt_path)?,
        )
        .map_err(|error| WalletError::Stronghold(error.to_string()))?;

    save_wallet_metadata(app, metadata)?;
    save_active_account_id(app, Some(&metadata.account_id))?;

    Ok(load_wallet_metadata(app, &metadata.account_id)?
        .ok_or_else(|| WalletError::MetadataCorrupted("wallet metadata missing after save".into()))?
        .into())
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
        let mut rng = thread_rng();
        rng.fill_bytes(&mut salt);
        fs::write(salt_path, salt)?;
    }

    argon2::hash_raw(password.as_bytes(), &salt, &Default::default())
        .map_err(|error| WalletError::Stronghold(error.to_string()))
}

fn wallet_paths(app: &AppHandle) -> Result<WalletPaths, WalletError> {
    let local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| WalletError::PathUnavailable)?;

    fs::create_dir_all(&local_data_dir)?;

    Ok(WalletPaths {
        metadata_db_path: local_data_dir.join("wallet-meta.sqlite3"),
        snapshot_path: local_data_dir.join("wallet.stronghold"),
        salt_path: local_data_dir.join("salt.txt"),
    })
}

fn snapshot_path_for_account(app: &AppHandle, account_id: &str) -> Result<PathBuf, WalletError> {
    let paths = wallet_paths(app)?;
    Ok(paths
        .metadata_db_path
        .with_file_name(format!("{account_id}.stronghold")))
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
    Ok(StoredWalletMetadata {
        account_id: row.get(0)?,
        derivation_group_id: row.get(1)?,
        derivation_index: row.get::<_, i64>(2)? as u32,
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
    snapshot_path: &str,
    remaining_accounts: &[StoredWalletMetadata],
) -> Result<(), WalletError> {
    if remaining_accounts
        .iter()
        .any(|entry| entry.snapshot_path == snapshot_path)
    {
        return Ok(());
    }

    let snapshot_file = PathBuf::from(snapshot_path);

    if snapshot_file.is_file() {
        fs::remove_file(snapshot_file)?;
    }

    Ok(())
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
