[Skip to content](#start-of-content)   



## Navigation Menu

[Sign in](/login?return_to=https%3A%2F%2Fgithub.com%2Faquasecurity%2Ftrivy%2Fblob%2Fmain%2Fdocs%2Fguide%2Fscanner%2Fsecret.md) 

Appearance settings

# Search code, repositories, users, issues, pull requests...

[Search syntax tips](https://docs.github.com/search-github/github-code-search/understanding-github-code-search-syntax)

[Sign in](/login?return_to=https%3A%2F%2Fgithub.com%2Faquasecurity%2Ftrivy%2Fblob%2Fmain%2Fdocs%2Fguide%2Fscanner%2Fsecret.md)

 [Sign up](/signup?ref_cta=Sign+up&ref_loc=header+logged+out&ref_page=%2F%3Cuser-name%3E%2F%3Crepo-name%3E%2Fblob%2Fshow&source=header-repo&source_repo=aquasecurity%2Ftrivy) 

Appearance settings

You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert

{{ message }}

### Uh oh!

There was an error while loading. Please reload this page.

[aquasecurity](/aquasecurity)   /  **[trivy](/aquasecurity/trivy)**  Public

* [Notifications](/login?return_to=%2Faquasecurity%2Ftrivy)  You must be signed in to change notification settings
* [Fork 515](/login?return_to=%2Faquasecurity%2Ftrivy)
* [Star  36.7k](/login?return_to=%2Faquasecurity%2Ftrivy)

## Expand file tree

/

# secret.md

Copy path

More file actions

More file actions

## Latest commit

## History

[History](/aquasecurity/trivy/commits/main/docs/guide/scanner/secret.md)

History

352 lines (280 loc) · 13.4 KB

/

# secret.md

Copy path

## File metadata and controls

352 lines (280 loc) · 13.4 KB

[Raw](https://github.com/aquasecurity/trivy/raw/refs/heads/main/docs/guide/scanner/secret.md)

Copy raw file

Download raw file

Outline

Edit and raw actions

# Secret Scanning

Trivy scans any container image, filesystem, and git repository to detect exposed secrets like passwords, API keys, and tokens. Secret scanning is enabled by default.

Trivy will scan every plaintext file, according to builtin rules or configuration. Also, Trivy can detect secrets in compiled Python files (`.pyc`).

There are plenty of builtin rules:

* AWS access key
* GCP service account
* GitHub personal access token
* GitLab personal access token
* Slack access token
* etc.

You can see a full list of [built-in rules](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go) and [built-in allow rules](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-allow-rules.go).

!!! tip If your secret is not detected properly, please make sure that your file including the secret is not in [the allowed paths](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-allow-rules.go). You can disable allow rules via [disable-allow-rules](#disable-rules).

## Quick start

This section shows how to scan secrets in container image and filesystem. Other subcommands should be the same.

### Container image

Specify an image name.

```
| | | | | | | | | | | | | | | | | | | | | | | | | | |> | | | | | | | | | | | | | | | | | | | | | | |> | | | | | | | | | | | | export***** |
```

!!! tip Trivy tries to detect a base image and skip those layers for secret scanning. A base image usually contains a lot of files and makes secret scanning much slower. If a secret is not detected properly, you can see base layers with the `--debug` flag.

### Filesystem

```
| | | | | | | | | | | |
```

!!! tip Your project may have some secrets for testing. You can skip them with `--skip-dirs` or `--skip-files`. We would recommend specifying these options so that the secret scanning can be faster if those files don't need to be scanned. Also, you can specify paths to be allowed in a configuration file. See the detail [here](#configuration).

## Configuration

This section describes secret-specific configuration. Other common options are documented [here](/aquasecurity/trivy/blob/main/docs/guide/configuration/index.md).

Trivy has a set of builtin rules for secret scanning, which can be extended or modified by a configuration file. Trivy tries to load `trivy-secret.yaml` in the current directory by default. If the file doesn't exist, only built-in rules are used. You can customize the config file path via the `--secret-config` flag.

!!! warning Trivy uses [Golang regexp package](https://pkg.go.dev/regexp/syntax#hdr-Syntax). To use `^` and `$` as symbols of begin and end of line use multi-line mode -`(?m)`.

### Custom Rules

Trivy allows defining custom rules.

```
rules id rule1 category general title Generic Rule severity HIGH path.*\.sh keywords secret regex(?i)(?P(secret))(=|:).{0,5}['"](?P[0-9a-zA-Z\-_=]{8,64})['"]secret-group-name secretallow-rules idskip-text description skip text files path.*\.txt
```

`id` (required) : - Unique identifier for this rule.

`category` (required) : - String used for metadata and reporting purposes.

`title` (required) : - Short human-readable title of the rule.

`severity` (required) : - How critical this rule is.

* Allowed values:
* CRITICAL
* HIGH
* MEDIUM
* LOW

`regex` (required) : - Golang regular expression used to detect secrets.

`path` (optional) : - Golang regular expression used to match paths.

`keywords` (optional, recommended) : - Keywords are used for pre-regex check filtering.

* Rules that contain keywords will perform a quick string compare check to make sure the keyword(s) are in the content being scanned.
* Ideally these values should either be part of the identifier or unique strings specific to the rule's regex.
* It is recommended to define for better performance.

`allow-rules` (optional) : - Allow rules for a single rule to reduce false positives with known secrets.

* The details are below.

### Allow Rules

If the detected secret is matched with the specified `regex`, then that secret will be skipped and not detected. The same logic applies for `path`.

`allow-rules` can be defined globally and per each rule. The fields are the same.

```
rules id rule1 category general title Generic Rule severity HIGH regex(?i)(?P(secret))(=|:).{0,5}['"](?P[0-9a-zA-Z\-_=]{8,64})['"]allow-rules idskip-text description skip text files path.*\.txtallow-rules idsocial-security-number description skip social security number regex219-09-9999
```

`id` (required) : - Unique identifier for this allow rule.

`description` (optional) : - Short human-readable description of this allow rule.

`regex` (optional) : - Golang regular expression used to allow detected secrets.

* `regex` or `path` must be specified.

`path` (optional) : - Golang regular expression used to allow matched paths.

* `regex` or `path` must be specified.

### Enable Rules

Trivy provides plenty of out-of-box rules and allow rules, but you may not need all of them. In that case, `enable-builtin-rules` will be helpful. If you just need AWS secret detection, you can enable only relevant rules as shown below. It specifies AWS-related rule IDs in `enable-builtin-rules`. All other rules are disabled, so the scanning will be much faster. We would strongly recommend using this option if you don't need all rules.

You can see a full list of [built-in rule IDs](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go) and [built-in allow rule IDs](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-allow-rules.go).

```
enable-builtin-rulesaws-access-key-idaws-account-idaws-secret-access-key
```

### Disable Rules

Trivy offers built-in rules and allow rules, but you may want to disable some of them. For example, you don't use Slack, so Slack doesn't have to be scanned. You can specify the Slack rule IDs, `slack-access-token` and `slack-web-hook` in `disable-rules` so that those rules will be disabled for less false positives.

You should specify either `enable-builtin-rules` or `disable-rules`. If they both are specified, `disable-rules` takes precedence. In case `github-pat` is specified in `enable-builtin-rules` and `disable-rules`, it will be disabled.

In addition, there are some allow rules. Markdown files are ignored by default, but you may want to scan markdown files as well. You can disable the allow rule by adding `markdown` to `disable-allow-rules`.

You can see a full list of [built-in rule IDs](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go) and [built-in allow rule IDs](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-allow-rules.go).

```
disable-rulesslack-access-tokenslack-web-hookdisable-allow-rules markdown
```

### Skip Patterns

By default, Trivy skips the following paths during secret scanning (expressed as [doublestar](https://github.com/bmatcuk/doublestar) glob patterns):

```
**/.git/** **/node_modules/** **/go.mod **/go.sum **/package-lock.json **/yarn.lock **/pnpm-lock.yaml **/Pipfile.lock **/Gemfile.lock **/*.jpg **/*.png **/*.gif **/*.doc **/*.pdf **/*.bin **/*.svg **/*.socket **/*.deb **/*.rpm **/*.zip **/*.gz **/*.gzip **/*.tar 
```

You can see a full list of default skip patterns [here][default-secret-patterns].

You can override this list with `skip-patterns` in the configuration file.

!!! warning When `skip-patterns` is specified, it **replaces** the default list entirely — defaults are not merged. To keep the defaults and add new patterns, include them explicitly.

```
skip-patterns"**/vendor/**" " ""**/testdata/**" " ""**/custom.lock" " ""**/*.xyz" " "
```

To disable all skipping, set it to an empty list:

We would recommend specifying `--skip-dirs` or `--skip-files` for faster secret scanning. Also there is a way to use [skip-patterns](#skip-patterns) in the secret config to speed up your scanning. In container image scanning, Trivy walks the file tree rooted at `/` and scans all the files other than [built-in allowed paths](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-allow-rules.go). It will take a while if your image contains a lot of files even though Trivy tries to avoid scanning layers from a base image. Adding glob patterns such as `**/vendor/**` helps so that Trivy will skip those paths entirely. You can see more options [here](/aquasecurity/trivy/blob/main/docs/guide/configuration/others.md).

`allow-rules` is also helpful. See the [allow-rules](#allow-rules) section.

In addition, all the built-in rules are enabled by default, so it takes some time to scan all of them. If you don't need all those rules, you can use `enable-builtin-rules` or `disable-rules` in the configuration file. You should use `enable-builtin-rules` if you need only AWS secret detection, for example. All rules are disabled except for the ones you specify, so it runs very fast. On the other hand, you should use `disable-rules` if you just want to disable some built-in rules. See the [enable-rules](#enable-rules) and [disable-rules](#disable-rules) sections for the detail.

If you don't need secret scanning, you can disable it via the `--scanners` flag.

```
$ trivy image --scanners vuln alpine:3.15
```

`trivy-secret.yaml` in the working directory is loaded by default.

```
$ cat trivy-secret.yaml rules id rule1 category general title Generic Rule severity HIGH regex(?i)(?P(secret))(=|:).{0,5}['"](?P[0-9a-zA-Z\-_=]{8,64})['"]allow-rules idsocial-security-number description skip social security number regex219-09-9999 idlog-dir description skip log directory path^\/var\/log\/disable-rulesslack-access-tokenslack-web-hookdisable-allow-rules markdown# The following command automatically loads the above configuration. # $ trivy image YOUR_IMAGE
```

Also, you can customize the config file path via `--secret-config`.

```
$ cat ./secret-config/trivy.yaml rules id rule1 category general title Generic Rule severity HIGH regex(?i)(?P(secret))(=|:).{0,5}['"](?P[0-9a-zA-Z\-_=]{8,64})['"]allow-rules idskip-text description skip text files path.*\.txtenable-builtin-rulesaws-access-key-idaws-account-idaws-secret-access-keydisable-allow-rulesusr-dirs# Pass the above config with `--secret-config`. #$ trivy fs --secret-config ./secret-config/trivy.yaml /path/to/your_project
```

This feature is inspired by [gitleaks][gitleaks].

[builtin](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go): [https://github.com/aquasecurity/trivy/blob/{{](https://github.com/aquasecurity/trivy/blob/%7B%7B) git.tag }}/pkg/fanal/secret/builtin-rules.go [builtin-allow](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-allow-rules.go): [https://github.com/aquasecurity/trivy/blob/{{](https://github.com/aquasecurity/trivy/blob/%7B%7B) git.tag }}/pkg/fanal/secret/builtin-allow-rules.go [default-secret-patterns]: [https://github.com/aquasecurity/trivy/blob/{{](https://github.com/aquasecurity/trivy/blob/%7B%7B) git.tag }}/pkg/fanal/secret/scanner.go [gitleaks]: <https://github.com/gitleaks/gitleaks>

You can’t perform that action at this time.

 
