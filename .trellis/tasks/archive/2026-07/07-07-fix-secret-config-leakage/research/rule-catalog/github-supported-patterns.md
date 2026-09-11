## [Security and code quality](/en/code-security)

# Supported secret scanning patterns

Lists of supported secrets and the partners that GitHub works with to prevent fraudulent use of secrets that were committed accidentally.

## Who can use this feature?

Secret scanning is available for the following repository types:

## [Phase 2: Evaluate GitHub Secret Protection](/en/free-pro-team@latest/code-security/tutorials/secret-protection-adoption-path)

## In this article

## [About secret scanning patterns](#about-secret-scanning-patterns)

There are three types of secret scanning alerts:

For in-depth information about each alert type, see [About secret scanning alerts](/en/code-security/secret-scanning/managing-alerts-from-secret-scanning/about-alerts).

If you use the REST API for secret scanning, you can use the `Secret type` to report on secrets from specific issuers. For more information, see [REST API endpoints for secret scanning](/en/enterprise-cloud@latest/rest/secret-scanning).

`Secret type`

### [Pattern categories](#pattern-categories)

| Category | Description | Detection approach | Example |
| --- | --- | --- | --- |
| **Generic** | Secrets not tied to a specific provider, such as private keys and database connection strings | Regex-based | `rsa_private_key` |
| **AI-detected** | Generic passwords detected by Copilot secret scanning using AI models | AI-based | `password` |
| **Provider** | Secrets tied to a specific service provider (such as AWS, Azure, Stripe) | Regex-based | `aws_access_key_id` |

`rsa_private_key`
`password`
`aws_access_key_id`

### [Capabilities by category](#capabilities-by-category)

| Capability | Generic patterns | AI-detected | Provider patterns |
| --- | --- | --- | --- |
| User alerts |  |  |  |
| Partner notifications |  |  | (if partner) |
| Push protection (default) |  |  | (most) |
| Push protection (configurable) |  |  | Some |
| Validity checks |  |  | Some |
| Extended metadata |  |  | Some |
| Base64 format support |  |  | Some |

Note

Validity and extended metadata checks are only available to users with GitHub Team or GitHub Enterprise who enable the feature as part of GitHub Secret Protection.

## [Supported generic patterns](#supported-generic-patterns)

Precision levels are estimated based on the pattern type's typical false positive rates.

| Provider | Token | Description | Precision |
| --- | --- | --- | --- |
| Generic | ec\_private\_key | Elliptic Curve (EC) private keys used for cryptographic operations | High |
| Generic | generic\_private\_key | Cryptographic private keys with `-----BEGIN PRIVATE KEY-----` header | High |
| Generic | http\_basic\_authentication\_header | HTTP Basic Authentication credentials in request headers | Medium |
| Generic | http\_bearer\_authentication\_header | HTTP Bearer tokens used for API authentication | Medium |
| Generic | mongodb\_connection\_string | Connection strings for MongoDB databases containing credentials | High |
| Generic | mysql\_connection\_url | Connection strings for MySQL databases containing credentials | High |
| Generic | openssh\_private\_key | OpenSSH format private keys used for SSH authentication | High |
| Generic | pgp\_private\_key | PGP (Pretty Good Privacy) private keys used for encryption and signing | High |
| Generic | postgres\_connection\_string | Connection strings for PostgreSQL databases containing credentials | High |
| Generic | rsa\_private\_key | RSA private keys used for cryptographic operations | High |

`-----BEGIN PRIVATE KEY-----`

Note

Validity checks are **not supported** for generic/ non-provider patterns.

## [Supported AI-detected patterns](#supported-ai-detected-patterns)

Secret scanning uses Copilot to detect generic passwords. See [Application card: GitHub security and quality AI features](/en/code-security/secret-scanning/copilot-secret-scanning/responsible-ai-generic-secrets).

| Provider | Token |
| --- | --- |
| Generic | password |

Note

Push protection and validity checks are not supported for passwords.

## [Supported provider patterns](#supported-provider-patterns)

Use the table below to search, filter, and browse all supported patterns. You can filter by provider name, push protection support, validity checks, and more.

Note

Service providers update the patterns used to generate tokens periodically and may support more than one version of a token. Push protection only supports the most recent token versions that secret scanning can identify with confidence. This avoids push protection blocking commits unnecessarily when a result may be a false positive, which is more likely to happen with legacy tokens.

Showing 519 of 519 patterns

## Supported patterns

| Provider | Secret | Partner | User alert | Push protection | Validity check | Metadata check | Base64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1Password** | 1Password Service Account Token `1password_service_account_token` | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Adafruit** | Adafruit IO Key `adafruit_io_key` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **Adobe** | Adobe Client Secret `adobe_client_secret` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Adobe** | Adobe Device Token `adobe_device_token` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Adobe** | Adobe PAC Token `adobe_pac_token` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Adobe** | Adobe Refresh Token `adobe_refresh_token` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Adobe** | Adobe Service Token `adobe_service_token` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Adobe** | Adobe Short-Lived Access Token `adobe_short_lived_access_token` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Aikido** | Aikido API Client Secret `aikido_api_client_secret` | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Aikido** | Aikido CI Scanning Token `aikido_ci_scanning_token` | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Airtable** | Airtable API Key `airtable_api_key` | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ |
| **Airtable** | Airtable Personal Access Token `airtable_personal_access_token` | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **Aiven** | Aiven Auth Token `aiven_auth_token` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Aiven** | Aiven Service Password `aiven_service_password` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Alibaba** | Alibaba Cloud AccessKey ID `alibaba_cloud_access_key_id, alibaba_cloud_access_key_secret` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Amazon AWS** | Amazon AWS Access Key ID `aws_access_key_id, aws_secret_access_key`, [Token versions](#token-versions) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| **Amazon AWS** | Amazon AWS API Key ID `aws_api_key` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Amazon AWS** | Amazon AWS Session Token `aws_secret_access_key, aws_session_token, aws_temporary_access_key_id` | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Anthropic** | Anthropic Admin API Key `anthropic_admin_api_key` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Anthropic** | Anthropic API Key `anthropic_api_key`, [Token versions](#token-versions) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Anthropic** | Anthropic Session ID `anthropic_session_id` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Apify** | Apify Actor Run API Token `apify_actor_run_api_token` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Apify** | Apify Actor Run Proxy Password `apify_actor_run_proxy_password` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Apify** | Apify API Token `apify_api_token` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **Apify** | Apify Integration API Token `apify_integration_api_token` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |

`1password_service_account_token`

`1password_service_account_token`

`adafruit_io_key`

`adafruit_io_key`

`adobe_client_secret`

`adobe_client_secret`

`adobe_device_token`

`adobe_device_token`

`adobe_pac_token`

`adobe_pac_token`

`adobe_refresh_token`

`adobe_refresh_token`

`adobe_service_token`

`adobe_service_token`

`adobe_short_lived_access_token`

`adobe_short_lived_access_token`

`aikido_api_client_secret`

`aikido_api_client_secret`

`aikido_ci_scanning_token`

`aikido_ci_scanning_token`

`airtable_api_key`

`airtable_api_key`

`airtable_personal_access_token`

`airtable_personal_access_token`

`aiven_auth_token`

`aiven_auth_token`

`aiven_service_password`

`aiven_service_password`

`alibaba_cloud_access_key_id, alibaba_cloud_access_key_secret`

`alibaba_cloud_access_key_id, alibaba_cloud_access_key_secret`

`aws_access_key_id, aws_secret_access_key`, [Token versions](#token-versions)

`aws_access_key_id, aws_secret_access_key`

`aws_api_key`

`aws_api_key`

`aws_secret_access_key, aws_session_token, aws_temporary_access_key_id`

`aws_secret_access_key, aws_session_token, aws_temporary_access_key_id`

`anthropic_admin_api_key`

`anthropic_admin_api_key`

`anthropic_api_key`, [Token versions](#token-versions)

`anthropic_api_key`

`anthropic_session_id`

`anthropic_session_id`

`apify_actor_run_api_token`

`apify_actor_run_api_token`

`apify_actor_run_proxy_password`

`apify_actor_run_proxy_password`

`apify_api_token`

`apify_api_token`

`apify_integration_api_token`

`apify_integration_api_token`

## Help and support

### Did you find what you needed?

### Help us make these docs great!

All GitHub docs are open source. See something that's wrong or unclear? Submit a pull request.

[Learn how to contribute](/contributing)

### Still need help?

## Legal
