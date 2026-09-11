[Choose your adventure](/)

[☑️Getting started](/getting-started)

[🐽Scan for secrets](/scan-for-secrets)

[🔍Analyze secrets](/analyzers)

[🔔Notify results](/notify-results)

[🤝Shared Secrets](/shared-secrets)

[✋Block secrets from leaking](/block-secrets-from-leaking)

[🔧Customizing TruffleHog](/customizing-trufflehog)

[🛠️Resource Hub](/resource-hub)

[🔒Security and Compliance](/security-and-compliance)

[🗝️Secret Management Best Practices](/secret-management-best-practices)

[📖Terminology](/terminology)

[🐷TruffleHog Release Notes](/trufflehog-release-notes)

[Docs powered by Archbee](https://www.archbee.com/?utm_campaign=hosted-docs&utm_medium=referral&utm_source=docs.trufflesecurity.com)

Customizing TruffleHog

# Custom detectors

7 min

adding a detector configuration locally configured detectors are configured in your config yaml file under the detectors field example config concurrency "8" detectors \ keywords \ keyword1 \ keyword2 name custom regex detector regex id id \[a za z0 9]{16} secret '\[a za z0 9]{32}' verify \ endpoint http //localhost 8000 headers \ 'authorization bearer token' unsafe true loglevel info numworkers 16 trufflehogaddress https //gnarly flying pancake c1 prod trufflehog org trufflehogscannergroup account 1 us west 2 trufflehogscannertoken thog agent xxxxxxxxxxxxxxxxxxxxxxxxxx custom regex beta detector the custom regex detector allows you to define your own detector using regular expressions with optional verification using a webhook detectors \ name hogtokendetector keywords \ hog regex hogid '\b(hog\[0 9a z]{17})\b' hogtoken '\[^a za z0 9+\\/]{0,1}(\[a za z0 9+\\/]{40})\[^a za z0 9+\\/]{0,1}' verify \ endpoint http //localhost 8000/ \# unsafe must be set if the endpoint is http unsafe true headers \ "authorization super secret authorization header" explanation name a unique identifier for your custom detector keywords an array of strings that, when found, trigger the regex search if multiple keywords are specified, the presence of any one of them will initiate the regex search regex defines the patterns to identify potential secrets you can specify one or more named regular expressions for a detection to be successful, each named regex must find a match capture groups () within these regular expressions are used to extract specific portions of the matched text, enabling the detector to process and report on particular segments of the identified patterns verify an optional section to validate detected secrets if you want to verify or unverify detected secrets, this section needs to be configured if not configured, all detected secrets will be marked as unverified read verification server examples other allowed parameters primary regex name this parameter allows you designate the primary regex pattern when multiple regex patterns are defined in the regex section if a match is found, the match for the designated primary regex will be used to determine the line number the value must be one of the names specified in the regex section exclude regexes capture this parameter allows you to define regex patterns to exclude specific parts of a detected secret if a match is found within the detected secret, the portion matching this regex is excluded from the result exclude regexes match this parameter enables you to define regex patterns to exclude entire matches from being reported as secrets entropy this parameter is used to assess the randomness of detected strings high entropy often indicates that a string is a potential secret, such as an api key or password, due to its complexity and unpredictability it helps in filtering false positives while an entropy threshold of 3 can be a starting point, it's essential to adjust this value based on your project's specific requirements and the nature of the data you have exclude words this parameter allows you to specify a list of words that, if present in a detected string, will cause trufflehog to ignore that string successranges this parameter allows you to specify a list of http status codes (or ranges) that indicate the secret is live rotatedranges this parameter allows you to specify a list of http status codes (or ranges) that indicate the secret is rotated here is an example of a 'generic' secret detector https //raw\ githubusercontent com/trufflesecurity/trufflehog/refs/heads/main/examples/generic with filters yml that exercises many of these options testing regex patterns we highly recommend that you test your regex pattern with a site like https //regex101 com/ https //regex101 com/ to ensure that your custom detector works as intended here’s an example of how to test your regex pattern with regex101 make sure to select golang (the regex flavor utilized by the trufflehog scanning engine) and confirm the gm on the right of the text field if not, click into it and adjust the regex flag to g lobal m ultiline enter in the regex pattern you’d like to detect confirm in regex101 that the regex pattern matches with the desired type of strings you’d like to detect the explanation panel on upper right will translate what the regex pattern specifically looks for and the quick reference panel on the bottom can help you find the regex token to define your desired regex pattern verification verification is done via a webhook post request to the provided endpoint unsafe must be set to true if the endpoint is http provided headers will be sent as is to the verification server verification webhook payload and response an example payload is provided for the above configuration { "hogtokendetector" { "hogid" \["hogasdijklkeijkxnezw"], "hogtoken" \["asdjklielknckejd212498ssjnidjklasdm23459"] } the first index in the array is the full match and subsequent indices are any sub matches (delineated by surrounding parentheses in the regular expression) by default response status code of 200 ok will mark the secret as verified any other response status code will mark the secret as unverified this can be modified with the use of successranges and/or rotatedranges successranges a list of http status codes (or ranges) that indicate the secret is live when the verification server responds with a matching status code, the secret is marked as verified each entry can be a single code "200" or an inclusive range "200 202" if omitted (along with `rotatedranges`), only `200` is treated as verified rotatedranges a list of http status codes (or ranges) that indicate the secret has been rotated when the verification server responds with a matching status code, the secret is definitively marked as unverified when only one of the two fields is configured, non matching responses are treated as the opposite state (e g , if only successranges is set, any response that doesn't match is treated as rotated; if only rotatedranges is set, any non matching response is treated as live) when both fields are configured and the response matches neither, the result is treated as unknown/inconclusive here's an example with configurable verification ranges detectors \ name hogtokendetector keywords \ hog regex token '\[^a za z0 9+\\/]{0,1}(\[a za z0 9+\\/]{40})\[^a za z0 9+\\/]{0,1}' verify \ endpoint http //localhost 8000/ unsafe true headers \ "authorization super secret authorization header" successranges \ "200" rotatedranges \ "401" \ "403" in this example, a 200 response from the verification server means the secret is live and needs rotation a 401 or 403 means the secret has been rotated and is no longer active any other response is treated as inconclusive an example verification server in python can be found here https //github com/trufflesecurity/trufflehog#verification server example python

Updated09 Jun 2026

![Doc contributor](https://cdn.archbee.com/public/animals/gorilla.png)

![Doc contributor](https://lh3.googleusercontent.com/a/ACg8ocLZfn4E9saPWJxPuYY8qLqZao33vCDfDyoY1eDXZtv-1UKU-w=s96-c)

![Doc contributor](https://archbee-profile-photos.s3.amazonaws.com/S23bFlGfp3a-8_a9YY_cE/kAUR8JTYyJJdIOScaIbq9_.blob)

![Doc contributor](https://lh3.googleusercontent.com/a/ACg8ocKj3N9LpjkiOM0LzJ7YHt_vE5rhMdgowdm_Y826NgOMtA=s96-c)

[Customizing TruffleHog](/customizing-trufflehog "Customizing TruffleHog")[Customizing detection](/customizing-detection "Customizing detection")

[Docs powered by Archbee](https://www.archbee.com/?utm_campaign=hosted-docs&utm_medium=referral&utm_source=docs.trufflesecurity.com)

[Docs powered by Archbee](https://www.archbee.com/?utm_campaign=hosted-docs&utm_medium=referral&utm_source=docs.trufflesecurity.com)
