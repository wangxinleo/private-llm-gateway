![GitGuardian Docs Logo](/img/gg-logo.svg)
![GitGuardian Docs Logo](/img/gg-logo-dark-mode.svg)

# Base64 Generic high entropy secret

## Description[​](#description "Direct link to Description")

### General[​](#general "Direct link to General")

The `base64 generic high entropy detector` aims at catching **any high entropy strings being assigned to a sensitive variable in base64-encoded text**. It is applying similar validation steps and specifications as the [`generic high entropy detector`](/secrets-detection/secrets-detection-engine/detectors/generics/generic_high_entropy_secret) but adapts them to be applied in base64-encoded text.

`base64 generic high entropy detector`
`generic high entropy detector`

### Specifications[​](#specifications "Direct link to Specifications")

#### About Base64-encoded text[​](#about-base64-encoded-text "Direct link to About Base64-encoded text")

[Base64 is a binary-to-text encoding scheme](https://en.wikipedia.org/wiki/Base64). It is mainly used to send binary data across channels that only reliably support text content. Base64 is also applied on text, for example in [JSON Web Token](https://en.wikipedia.org/wiki/JSON_Web_Token) or to obfuscate it.

Base64 is not an encryption algorithm, encoding and decoding do not rely on a secret key but Base64 is commonly used to encode to text the results of encryption algorithms. This detector will only look for generic secrets inside Base64 encoded-text representing unicode text.

### Revoke the secret[​](#revoke-the-secret "Direct link to Revoke the secret")

This detector catches generic secrets, hence GitGuardian cannot infer the concerned service. To properly revoke the secret :

### Examples[​](#examples "Direct link to Examples")

**Examples that WILL be caught**

`# base64(api_key = rca.pibsaorcibu234lbu43)

- text: |

YXBpX2tleSA9IHJjYS5waWJzYW9yY2lidTIzNGxidTQz

apikey: HJjYS5waWJzYW9yY2lidTIzNGxidTQz

# base64({"api-key": "asnbtueaorueobu435nstau"})

- text: |

eyJhcGkta2V5IjogImFzbmJ0dWVhb3J1ZW9idTQzNW5zdGF1In0K

apikey: mFzbmJ0dWVhb3J1ZW9idTQzNW5zdGF1

# base64(token: asnbtueaorueobu435nstau)

- text: |

dG9rZW46IGFzbmJ0dWVhb3J1ZW9idTQzNW5zdGF1Cg==

apikey: GFzbmJ0dWVhb3J1ZW9idTQzNW5zdGF1

# base64(authorization = asnbtueaorueobu435nstau)

- text: |

YXV0aG9yaXphdGlvbiA9IGFzbmJ0dWVhb3J1ZW9idTQzNW5zdGF1

apikey: GFzbmJ0dWVhb3J1ZW9idTQzNW5zdGF1`

**Examples that WILL NOT be caught**

`# base64(api_key = hj65_klhz/trlu)

- text: |

YXBpX2tleSA9IGhqNjVfa2xoei90cmx1`
`# base64(secret = xob1xob1xob1xob1xob1xob1xob1)

- text: |

c2VjcmV0ID0geG9iMXhvYjF4b2IxeG9iMXhvYjF4b2IxeG9iMQ==`
`# base64(object_id = hj65_klhz/trlupok76)

- text: |

b2JqZWN0X2lkID0gaGo2NV9rbGh6L3RybHVwb2s3Ng==`

For more examples, see [the examples of the `generic high entropy detector`](/secrets-detection/secrets-detection-engine/detectors/generics/generic_high_entropy_secret#examples) encoded in Base64 [.

`generic high entropy detector`

### Details for `Base64 Generic high entropy secret`[​](#details-for-base64-generic-high-entropy-secret "Direct link to details-for-base64-generic-high-entropy-secret")

`Base64 Generic high entropy secret`

**High Recall:** False

**Validity Check:** False

**Occurrences found for one million commits:** 70

**Prefixed:** False

**PreValidators**:  
Here is a list of the validation steps the document must pass before being analyzed.

`- type: FilenameBanlistPreValidator

banlist_extensions: []

banlist_filenames:

- hash

- list/k.txt$

- list/plex.txt$

- \.csproj$

- tg/mtproto\.json

check_binaries: false

- type: ContentWhitelistPreValidator

patterns:

- "[a-z0-9+/]{28,10000}={0,2}"

- type: Base64ContentWhitelistPreValidator

keywords:

- secret

- token

- apikey

- api-key

- api_key

- api.key

- credential

- auth`
`generic high entropy detector`

#### Was this page helpful?

`Base64 Generic high entropy secret`
![](https://cdn.prod.website-files.com/64818365f9ae7ae6e21502f0/6481a099ebfcd09672739e35_SOC.svg)
![](https://cdn.prod.website-files.com/64818365f9ae7ae6e21502f0/6481a099b10ef0c780d9a64b_GDPR.svg)

## Something we didn’t cover?

# See our Roadmap

# Subscribe on GitHub

# Submit a request

# API status

## Subscribe to our newsletter

By submitting this form, I agree to GitGuardian’s [Privacy Policy](https://www.gitguardian.com/legal/privacy-policy)
