## Documentation Index

Fetch the complete documentation index at: </llms.txt>

Use this file to discover all available pages before exploring further.

![light logo](https://mintcdn.com/semgrep-ee9d73d8/6O2eWotSEeX-M9yU/logo/light.svg?fit=max&auto=format&n=6O2eWotSEeX-M9yU&q=85&s=b53db72fbb1f3942a5595610873e9cc6)
![dark logo](https://mintcdn.com/semgrep-ee9d73d8/6O2eWotSEeX-M9yU/logo/dark.svg?fit=max&auto=format&n=6O2eWotSEeX-M9yU&q=85&s=2c839aeee7634559bcfcaab9f54df40d)

### Write rules for Semgrep Code

### Write rules for Semgrep Secrets

## On this page

# Write custom validators

## [​](#sample-validator) Sample validator

`validators:
- http:
 request:
 headers:
 Authorization: Bearer $REGEX
 Host: api.semgrep.dev
 User-Agent: Semgrep
 method: GET
 url: https://api.semgrep.dev/user
 response:
 - match:
 - status-code: 200
 result:
 validity: valid
 - match:
 - status-code: 401
 result:
 validity: invalid`

See a validator in the context of a full rule.

`rules:
- id: exampleCo_example
 message: >-
 This is an example rule that performs validation against semgrep.dev
 severity: MEDIUM
 metadata:
 product: secrets
 secret_type: exampleCo
 languages:
 - regex
 validators:
 - http:
 request:
 headers:
 Authorization: Bearer $REGEX
 Host: api.semgrep.dev
 User-Agent: Semgrep
 method: GET
 url: https://api.semgrep.dev/user
 response:
 - match:
 - status-code: 200
 result:
 validity: valid
 - match:
 - status-code: 401
 result:
 validity: invalid
 patterns:
 - patterns:
 - pattern-regex: (?<REGEX>\b(someprefix_someRegex[0-9A-Z]{32})\b)
 - focus-metavariable: $REGEX
 - metavariable-analysis:
 analyzer: entropy
 metavariable: $REGEX`

## [​](#syntax) Syntax

### [​](#validator) validator

| Key | Required | Description |
| --- | --- | --- |
| validator | Yes | Used to define a list of validators within a Semgrep rule. |

### [​](#type) type

| Key | Required | Description |
| --- | --- | --- |
| http | Yes | Indicates that the request type is `http`. |

`http`

### [​](#request) request

| Key | Required | Description |
| --- | --- | --- |
| request | Yes | Describes the request object and the URL to which the request object should be sent |
| method | Yes | The HTTP method Semgrep uses to make the call. Accepted values: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`, `PATCH` |
| url | Yes | The URL to which the call is made |
| headers | Yes | The headers to include with the call |
| body | No | The body used with `POST`, `PUT`, and `PATCH` requests |

`GET`
`POST`
`PUT`
`DELETE`
`OPTIONS`
`PATCH`
`POST`
`PUT`
`PATCH`

#### [​](#subkeys-for-headers) Subkeys for `headers`

`headers`
`headers`

| Key | Required | Description |
| --- | --- | --- |
| Host | No | The host to which the call is made. Only the `url` field is required, but you can override the host if needed |
| Other-values | No | The request header. Accepts all values, including `Authorization`, `Content-Type`, `User-Agent`, and so on |

`url`
`Authorization`
`Content-Type`
`User-Agent`

#### [​](#example) Example

`request:
 headers:
 Authorization: Bearer $REGEX
 Host: api.semgrep.dev
 User-Agent: Semgrep
 method: GET
 url: https://api.semgrep.dev/user`

### [​](#response) response

`match`
`result`

| Key | Required | Description |
| --- | --- | --- |
| match | Yes | Defines the list of match conditions. |
| result | Yes | Defines the validity. Accepted values: `Valid`, `Invalid` |

`Valid`
`Invalid`

#### [​](#subkeys-for-match) Subkeys for `match`

`match`

| Key | Description |
| --- | --- |
| status-code | The HTTP status code expected by Semgrep Secrets for it to consider the secret a match |
| content | The response body; you can inspect it for a specific value to determine if the request is valid. An example of where this is useful is when both invalid and valid responses return the same status code |
| headers | Accepts a list of objects with the keys name/value they must be exact values |

#### [​](#subkeys-for-result) Subkeys for `result`

`result`

| Key | Required | Description |
| --- | --- | --- |
| validity | Yes | Sets the validity based on the HTTP status code received. Accepted values: `valid` and `invalid` |
| message | No | Used to override the rule message based on the secret’s validation state |
| metadata | No | Used to override existing metadata fields or add new metadata fields based on the secret’s validity state |
| severity | No | Used to override the existing rule severity based on the validation state |

`valid`
`invalid`
`severity`
`severity`
`MEDIUM`
`LOW`

#### [​](#subkeys-for-content) Subkeys for `content`

`content`

| Key | Required | Description |
| --- | --- | --- |
| language | Yes | Indicates the pattern language to use; this must be `regex` or `generic` |
| pattern-regex | Yes | Defines the regular expression used to search the response body. Alternatively, you can use the `patterns` key and [define patterns as you would for rules](/semgrep-secrets/rules#subkeys-under-the-patterns-key) |

`regex`
`generic`
`patterns`

#### [​](#example-2) Example

`response:
- match:
 - status-code: 200
 - content:
 language: regex
 pattern-regex: (\"ok\":true)
 status-code: 200`

## [​](#sample-rules-with-validators) Sample rules with validators

Sample POST request

`rules:
- id: exampleCo_example
 message: >-
 This is an example rule that performs validation against semgrep.dev
 severity: MEDIUM
 metadata:
 product: secrets
 secret_type: exampleCo
 languages:
 - regex
 validators:
 - http:
 request:
 headers:
 Host: api.semgrep.dev
 User-Agent: Semgrep
 method: POST
 body: |
 {"key": "$REGEX"}
 url: https://api.semgrep.dev/user
 response:
 - match:
 - status-code: 200
 result:
 validity: valid
 - match:
 - status-code: 401
 result:
 validity: invalid
 patterns:
 - patterns:
 - pattern-regex: (?<REGEX>\b(someprefix_someRegex[0-9A-Z]{32})\b)
 - focus-metavariable: $REGEX
 - metavariable-analysis:
 analyzer: entropy
 metavariable: $REGEX`

All fields

`rules:
- id: exampleCo_example
 message: >-
 This is an example rule that performs validation against semgrep.dev
 severity: MEDIUM
 metadata:
 product: secrets
 secret_type: exampleCo
 languages:
 - regex
 validators:
 - http:
 request:
 headers:
 Host: api.semgrep.dev
 User-Agent: Semgrep
 method: POST
 body: |
 {"key": "$REGEX"}
 url: https://api.semgrep.dev/user
 response:
 - match:
 - status-code: 200
 - content:
 language: regex
 pattern-regex: (\"role\":admin)
 result:
 validity: valid
 severity: ERROR
 message: >-
 The token exposed is for an admin user, and this should be fixed immediately!
 See https://howtorotate.com/introduction/key-rotation-101/ on how to
 rotate secrets and https://blog.gitguardian.com/what-to-do-if-you-expose-a-secret/
 on how to look for suspicious activity.
 metadata:
 context:
 - admin: true
 - match:
 - status-code: 200
 result:
 validity: invalid
 patterns:
 - patterns:
 - pattern-regex: (?<REGEX>\b(someprefix_someRegex[0-9A-Z]{32})\b)
 - focus-metavariable: $REGEX
 - metavariable-analysis:
 analyzer: entropy
 metavariable: $REGEX`

### [​](#base64-encoding) Base64 encoding

`__semgrep_internal_encode_64(...)`
`url`
`body`
`header`

Sample Semgrep rule with validator using Base64 encoding

`rules:
- id: exampleCo_example
 message: >-
 This is an example rule that performs validation against semgrep.dev
 severity: MEDIUM
 metadata:
 product: secrets
 secret_type: exampleCo
 languages:
 - regex
 validators:
 - http:
 request:
 headers:
 Authorization: Basic __semgrep_internal_encode_64($REGEX:)
 Host: api.semgrep.dev
 User-Agent: Semgrep
 method: GET
 url: https://api.semgrep.dev/user
 response:
 - match:
 - status-code: 200
 result:
 validity: valid
 - match:
 - status-code: 401
 result:
 validity: invalid
 patterns:
 - patterns:
 - pattern-regex: (?<REGEX>\b(someprefix_someRegex[0-9A-Z]{32})\b)
 - focus-metavariable: $REGEX
 - metavariable-analysis:
 analyzer: entropy
 metavariable: $REGEX`

Was this page helpful?
