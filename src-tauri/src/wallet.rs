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
const ETH_BIP44_PATH: [u32; 5] = [44 + BIP32_HARDEN, 60 + BIP32_HARDEN, 0 + BIP32_HARDEN, 0, 0];
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
    is_biometric_enabled: bool,
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
    #[error("当前钱包已存在，MVP 只支持单钱包")]
    WalletAlreadyExists,
    #[error("当前没有待确认的创建流程")]
    NoPendingWallet,
    #[error("待确认钱包数据异常")]
    InvalidPendingWallet,
    #[error("导入内容不能为空")]
    EmptyImportSecret,
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
    ensure_wallet_not_initialized(&app)?;

    let mnemonic = Mnemonic::generate_in(Language::English, 12)?;
    let mnemonic_phrase = Zeroizing::new(mnemonic.to_string());
    let private_key = derive_private_key_from_mnemonic(&mnemonic)?;
    let address = address_from_private_key(private_key.as_ref())?;

    let draft = PendingWalletDraft {
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
    ensure_wallet_not_initialized(&app)?;

    let pending = {
        let mut guard = state.pending_onboarding.lock().unwrap();
        guard.take().ok_or(WalletError::NoPendingWallet)?
    };

    let result = persist_wallet_secret(
        &app,
        &pending.password,
        pending.mnemonic.as_bytes(),
        SecretKind::Mnemonic,
        &StoredWalletMetadata {
            wallet_label: pending.draft.wallet_label.clone(),
            address: pending.draft.address.clone(),
            source: WalletSource::Created,
            secret_kind: SecretKind::Mnemonic,
            is_biometric_enabled: pending.draft.is_biometric_enabled,
            has_backed_up_mnemonic: true,
            created_at: pending.draft.created_at.clone(),
            last_unlocked_at: Some(now_rfc3339()),
            snapshot_path: wallet_paths(&app)?
                .snapshot_path
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
    ensure_wallet_not_initialized(&app)?;

    {
        let mut guard = state.pending_onboarding.lock().unwrap();
        *guard = None;
    }

    let (address, secret_bytes) = match request.secret_kind {
        SecretKind::Mnemonic => {
            let normalized = normalize_mnemonic_phrase(&request.secret_value);
            let mnemonic = Mnemonic::parse_in_normalized(Language::English, &normalized)?;
            let private_key = derive_private_key_from_mnemonic(&mnemonic)?;
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

    persist_wallet_secret(
        &app,
        &request.password,
        secret_bytes.as_ref(),
        request.secret_kind,
        &StoredWalletMetadata {
            wallet_label: request.wallet_label,
            address,
            source: WalletSource::Imported,
            secret_kind: request.secret_kind,
            is_biometric_enabled: request.is_biometric_enabled,
            has_backed_up_mnemonic: false,
            created_at: now_rfc3339(),
            last_unlocked_at: Some(now_rfc3339()),
            snapshot_path: wallet_paths(&app)?
                .snapshot_path
                .to_string_lossy()
                .into_owned(),
        },
    )
    .map_err(Into::into)
}

#[tauri::command]
pub fn load_wallet_profile(app: AppHandle) -> WalletCommandResult<Option<WalletProfile>> {
    Ok(load_wallet_metadata(&app)?.map(Into::into))
}

#[tauri::command]
pub fn unlock_wallet(
    app: AppHandle,
    password: String,
) -> WalletCommandResult<Option<WalletProfile>> {
    let metadata = match load_wallet_metadata(&app)? {
        Some(metadata) => metadata,
        None => return Ok(None),
    };

    let stronghold = open_stronghold(
        Path::new(&metadata.snapshot_path),
        &password,
        &wallet_paths(&app)?.salt_path,
    );

    if stronghold.is_err() {
        return Ok(None);
    }

    let unlocked_at = now_rfc3339();
    update_last_unlocked_at(&app, &unlocked_at)?;

    let mut next_metadata = load_wallet_metadata(&app)?.ok_or_else(|| {
        WalletError::MetadataCorrupted("wallet metadata missing after unlock".into())
    })?;
    next_metadata.last_unlocked_at = Some(unlocked_at);

    Ok(Some(next_metadata.into()))
}

#[tauri::command]
pub fn update_biometric_setting(
    app: AppHandle,
    request: UpdateBiometricRequest,
) -> WalletCommandResult<Option<WalletProfile>> {
    let metadata = match load_wallet_metadata(&app)? {
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
    let metadata = load_wallet_metadata(&app)?.ok_or(WalletError::WalletNotInitialized)?;
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

fn ensure_wallet_not_initialized(app: &AppHandle) -> Result<(), WalletError> {
    if load_wallet_metadata(app)?.is_some() || wallet_paths(app)?.snapshot_path.exists() {
        Err(WalletError::WalletAlreadyExists)
    } else {
        Ok(())
    }
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
) -> Result<Zeroizing<[u8; 32]>, WalletError> {
    let seed = Zeroizing::new(mnemonic.to_seed_normalized(""));
    derive_private_key_from_seed(seed.as_ref())
}

fn derive_private_key_from_seed(seed: &[u8]) -> Result<Zeroizing<[u8; 32]>, WalletError> {
    let (mut signing_key, mut chain_code) = root_signing_key_from_seed(seed)?;

    for index in ETH_BIP44_PATH {
        (signing_key, chain_code) = derive_child_signing_key(&signing_key, &chain_code, index)?;
    }

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

    let secret_bytes = &secret_record[delimiter + 1..];
    let private_key = match secret_kind {
        SecretKind::Mnemonic => {
            let mnemonic_phrase =
                std::str::from_utf8(secret_bytes).map_err(|_| WalletError::InvalidStoredSecret)?;
            let mnemonic = Mnemonic::parse_in_normalized(Language::English, mnemonic_phrase)?;
            derive_private_key_from_mnemonic(&mnemonic)?
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
    let stronghold = open_stronghold(&paths.snapshot_path, password, &paths.salt_path)?;
    let snapshot_path = iota_stronghold::SnapshotPath::from_path(&paths.snapshot_path);
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

    Ok(load_wallet_metadata(app)?
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

fn metadata_connection(app: &AppHandle) -> Result<Connection, WalletError> {
    let paths = wallet_paths(app)?;
    let connection = Connection::open(paths.metadata_db_path)?;

    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS wallet_profile (
          id INTEGER PRIMARY KEY CHECK (id = 1),
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
        "#,
    )?;

    Ok(connection)
}

fn load_wallet_metadata(app: &AppHandle) -> Result<Option<StoredWalletMetadata>, WalletError> {
    let connection = metadata_connection(app)?;

    connection
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
                Ok(StoredWalletMetadata {
                    wallet_label: row.get(0)?,
                    address: row.get(1)?,
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
        .optional()
        .map_err(Into::into)
}

fn save_wallet_metadata(
    app: &AppHandle,
    metadata: &StoredWalletMetadata,
) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    connection.execute(
        r#"
        INSERT INTO wallet_profile (
          id,
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
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id) DO UPDATE SET
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
            1_i64,
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

fn update_last_unlocked_at(app: &AppHandle, last_unlocked_at: &str) -> Result<(), WalletError> {
    let connection = metadata_connection(app)?;
    connection.execute(
        "UPDATE wallet_profile SET last_unlocked_at = ?1 WHERE id = 1",
        params![last_unlocked_at],
    )?;
    Ok(())
}

fn to_sql_conversion_error(error: WalletError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
