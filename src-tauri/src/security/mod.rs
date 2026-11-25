use crate::models::{GuardrailCheckResult, PathValidationResult, SecretStatus};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use once_cell::sync::Lazy;
use regex::Regex;
use std::path::Path;

static DESTRUCTIVE_RULES: Lazy<Vec<(&'static str, Regex)>> = Lazy::new(|| {
    vec![
        (
            "disk_format",
            Regex::new(r"(?i)(^|[;&|]\s*)format(\.com)?\s+[a-z]:").unwrap(),
        ),
        (
            "recursive_delete_root_or_os",
            Regex::new(
                r"(?i)\bdel\s+[^;&|]*(/f|/s|/q)[^;&|]*([a-z]:\\(\s|$|\*|windows|program\s*files|system32))",
            )
            .unwrap(),
        ),
        (
            "rm_rf_root",
            Regex::new(r"(?i)\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(/(\s|$|\*)|~|/\*)").unwrap(),
        ),
        (
            "powershell_invoke_expression",
            Regex::new(r"(?i)\b(invoke-expression|iex)\b").unwrap(),
        ),
        (
            "powershell_encoded_command",
            Regex::new(r"(?i)\s-(e|ec|enc|enco|encod|encode|encoded|encodedcommand)\s+[a-z0-9+/=]{8,}")
                .unwrap(),
        ),
        (
            "registry_delete_hklm",
            Regex::new(r"(?i)\breg(\.exe)?\s+delete\s+hklm\\").unwrap(),
        ),
        (
            "scheduled_tasks_tamper",
            Regex::new(r"(?i)\bschtasks(\.exe)?\b").unwrap(),
        ),
    ]
});

const PROTECTED_WINDOWS_PREFIXES: &[&str] = &[
    r"c:\windows",
    r"c:\program files",
    r"c:\program files (x86)",
    r"c:\programdata\microsoft\windows",
];

/// Non-bypassable Rust-side destructive command validator.
pub fn validate_command_guardrails(command: &str) -> GuardrailCheckResult {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return GuardrailCheckResult {
            allowed: false,
            blocked: true,
            requires_confirmation: false,
            matched_rule: Some("empty_command".to_string()),
            reason: Some("Command cannot be empty.".to_string()),
        };
    }

    for (rule_name, regex) in DESTRUCTIVE_RULES.iter() {
        if regex.is_match(trimmed) {
            return GuardrailCheckResult {
                allowed: false,
                blocked: true,
                requires_confirmation: true,
                matched_rule: Some((*rule_name).to_string()),
                reason: Some(format!(
                    "Blocked by OmniCommand Rust security guardrail ({rule_name}): destructive or obfuscated system command pattern detected."
                )),
            };
        }
    }

    GuardrailCheckResult {
        allowed: true,
        blocked: false,
        requires_confirmation: false,
        matched_rule: None,
        reason: None,
    }
}

/// Validates and canonicalizes a local Windows directory using `dunce` to strip
/// `\\?\` UNC prefixes and blocks protected OS directories.
pub fn validate_local_path(raw_path: &str, require_exists: bool) -> PathValidationResult {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return PathValidationResult {
            valid: false,
            exists: false,
            canonical_path: None,
            blocked_reason: Some("Base path cannot be empty.".to_string()),
        };
    }

    let normalized_lower = trimmed.replace('/', "\\").to_lowercase();
    let stripped_unc = normalized_lower.trim_start_matches(r"\\?\");

    for protected in PROTECTED_WINDOWS_PREFIXES {
        if stripped_unc == *protected
            || stripped_unc.starts_with(&format!(r"{protected}\"))
            || stripped_unc.contains(r"\system32")
            || stripped_unc.contains(r"\syswow64")
        {
            return PathValidationResult {
                valid: false,
                exists: Path::new(trimmed).exists(),
                canonical_path: None,
                blocked_reason: Some(format!(
                    "Blocked protected OS directory: '{trimmed}'. Projects and executions cannot target Windows system folders."
                )),
            };
        }
    }

    let path = Path::new(trimmed);
    let exists = path.exists() && path.is_dir();

    if exists {
        match dunce::canonicalize(path) {
            Ok(canon) => {
                let canon_str = canon.to_string_lossy().to_string();
                let canon_lower = canon_str.to_lowercase();
                for protected in PROTECTED_WINDOWS_PREFIXES {
                    if canon_lower == *protected
                        || canon_lower.starts_with(&format!(r"{protected}\"))
                        || canon_lower.contains(r"\system32")
                    {
                        return PathValidationResult {
                            valid: false,
                            exists: true,
                            canonical_path: None,
                            blocked_reason: Some(format!(
                                "Resolved path targets protected OS directory: '{canon_str}'."
                            )),
                        };
                    }
                }
                PathValidationResult {
                    valid: true,
                    exists: true,
                    canonical_path: Some(canon_str),
                    blocked_reason: None,
                }
            }
            Err(err) => PathValidationResult {
                valid: false,
                exists: false,
                canonical_path: None,
                blocked_reason: Some(format!("Failed to canonicalize path: {err}")),
            },
        }
    } else if require_exists {
        PathValidationResult {
            valid: false,
            exists: false,
            canonical_path: None,
            blocked_reason: Some(format!("Directory does not exist: '{trimmed}'")),
        }
    } else {
        PathValidationResult {
            valid: true,
            exists: false,
            canonical_path: Some(trimmed.replace('/', "\\")),
            blocked_reason: None,
        }
    }
}

/// Validates custom OpenAI-compatible provider base URLs so link-local cloud
/// metadata endpoints (169.254.169.254) are always blocked.
pub fn validate_provider_url(url: &str) -> Result<(), String> {
    let lower = url.trim().to_lowercase();
    if lower.contains("169.254.169.254") || lower.contains("://169.254.") {
        return Err("Blocked link-local metadata address (169.254.x.x).".to_string());
    }
    let is_https = lower.starts_with("https://");
    let is_local = lower.starts_with("http://localhost:")
        || lower.starts_with("http://localhost/")
        || lower.starts_with("http://127.0.0.1:")
        || lower.starts_with("http://127.0.0.1/");
    if !is_https && !is_local {
        return Err(
            "Custom endpoints must use https:// or local loopback (http://localhost:* / http://127.0.0.1:*)."
                .to_string(),
        );
    }
    Ok(())
}

/// Structured DPAPI decryption outcome so moving `settings.json` between
/// Windows machines degrades gracefully instead of crashing startup.
pub enum SecretDecryptOutcome {
    Decrypted(String),
    Missing,
    Failed(String),
}

impl SecretDecryptOutcome {
    pub fn to_status(&self) -> (SecretStatus, Option<String>) {
        match self {
            SecretDecryptOutcome::Decrypted(_) => (SecretStatus::Configured, None),
            SecretDecryptOutcome::Missing => (SecretStatus::Missing, None),
            SecretDecryptOutcome::Failed(msg) => (SecretStatus::DecryptFailed, Some(msg.clone())),
        }
    }
}

#[cfg(target_os = "windows")]
pub fn encrypt_secret_dpapi(plaintext: &str) -> Result<String, String> {
    use std::ptr;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    if plaintext.is_empty() {
        return Err("Secret cannot be empty".to_string());
    }

    let mut input_bytes = plaintext.as_bytes().to_vec();
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: input_bytes.len() as u32,
        pbData: input_bytes.as_mut_ptr(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    unsafe {
        CryptProtectData(
            &in_blob,
            windows::core::PCWSTR::null(),
            None,
            None,
            None,
            0, // CurrentUser scope
            &mut out_blob,
        )
        .map_err(|e| format!("Windows DPAPI encryption failed: {e}"))?;

        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let encoded = BASE64.encode(slice);
        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(out_blob.pbData.cast()));
        Ok(encoded)
    }
}

#[cfg(target_os = "windows")]
pub fn decrypt_secret_dpapi(ciphertext_b64: Option<&str>) -> SecretDecryptOutcome {
    use std::ptr;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let Some(b64) = ciphertext_b64 else {
        return SecretDecryptOutcome::Missing;
    };
    if b64.trim().is_empty() {
        return SecretDecryptOutcome::Missing;
    }

    let Ok(mut raw) = BASE64.decode(b64.trim()) else {
        return SecretDecryptOutcome::Failed(
            "Stored API key is corrupted and requires re-entry on this machine.".to_string(),
        );
    };

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: raw.len() as u32,
        pbData: raw.as_mut_ptr(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    unsafe {
        if CryptUnprotectData(&in_blob, None, None, None, None, 0, &mut out_blob).is_err() {
            return SecretDecryptOutcome::Failed(
                "Key encrypted under a different Windows user/machine; please re-enter this API key."
                    .to_string(),
            );
        }

        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let result = String::from_utf8(slice.to_vec());
        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(out_blob.pbData.cast()));

        match result {
            Ok(secret) => SecretDecryptOutcome::Decrypted(secret),
            Err(_) => SecretDecryptOutcome::Failed(
                "Decrypted secret is not valid UTF-8; please re-enter this API key.".to_string(),
            ),
        }
    }
}

/// Non-Windows fallback so `cargo check` works on Linux/macOS CI runners.
#[cfg(not(target_os = "windows"))]
pub fn encrypt_secret_dpapi(plaintext: &str) -> Result<String, String> {
    Ok(format!("dpapi-stub:{}", BASE64.encode(plaintext.as_bytes())))
}

#[cfg(not(target_os = "windows"))]
pub fn decrypt_secret_dpapi(ciphertext_b64: Option<&str>) -> SecretDecryptOutcome {
    let Some(raw) = ciphertext_b64 else {
        return SecretDecryptOutcome::Missing;
    };
    if raw.trim().is_empty() {
        return SecretDecryptOutcome::Missing;
    }
    let payload = raw.strip_prefix("dpapi-stub:").unwrap_or(raw);
    match BASE64.decode(payload) {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(s) => SecretDecryptOutcome::Decrypted(s),
            Err(_) => SecretDecryptOutcome::Failed(
                "Key requires re-entry on this machine.".to_string(),
            ),
        },
        Err(_) => SecretDecryptOutcome::Failed(
            "Key encrypted on a different machine; re-entry required.".to_string(),
        ),
    }
}
