## [Security and code quality](/en/code-security)

# Defining custom patterns for secret scanning

Protect your unique secret types by defining custom patterns with regular expressions.

## Who can use this feature?

Repository owners, organization owners, security managers, enterprise administrators, and users with the **admin** role

Organization-owned repositories on GitHub Team or GitHub Enterprise with [GitHub Secret Protection](/en/enterprise-cloud@latest/get-started/learning-about-github/about-github-advanced-security) enabled

## [Phase 5: Scale, customize, and automate](/en/enterprise-cloud@latest/code-security/tutorials/secret-protection-adoption-path)

## In this article

## [Defining a custom pattern with Copilot](#defining-a-custom-pattern-with-copilot)

You can use Copilot secret scanning to generate regular expressions based on a text description of the type of pattern you would like to detect, including optional example strings that should be detected. See [Generating regular expressions for custom patterns with Copilot secret scanning](/en/enterprise-cloud@latest/code-security/secret-scanning/copilot-secret-scanning/generating-regular-expressions-for-custom-patterns-with-copilot-secret-scanning).

## [Defining a custom pattern for a repository](#defining-a-custom-pattern-for-a-repository)

Before defining a custom pattern, you must ensure that Secret Protection is enabled on your repository. For more information, see [Enabling secret scanning for your repository](/en/enterprise-cloud@latest/code-security/secret-scanning/enabling-secret-scanning-features/enabling-secret-scanning-for-your-repository).

On GitHub, navigate to the main page of the repository.

Under your repository name, click  **Settings**. If you cannot see the "Settings" tab, select the  dropdown menu, then click **Settings**.

![Screenshot of a repository header showing the tabs. The "Settings" tab is highlighted by a dark orange outline.](/assets/cb-28260/images/help/repository/repo-actions-settings.png)

![Screenshot of a repository header showing the tabs. The "Settings" tab is highlighted by a dark orange outline.](/assets/cb-28260/images/help/repository/repo-actions-settings.png)

In the "Security" section of the sidebar, click  **Advanced Security**.

Under "Secret Protection", to the right of "Custom patterns", click **New pattern**.

Enter the details for your new custom pattern. You must at least provide the name for your pattern, and a regular expression for the format of your secret pattern.

![Screenshot of a filled custom secret scanning pattern form.](/assets/cb-81755/images/help/repository/secret-scanning-create-custom-pattern.png)

![Screenshot of a filled custom secret scanning pattern form.](/assets/cb-81755/images/help/repository/secret-scanning-create-custom-pattern.png)

When you're ready to test your new custom pattern, to identify matches in the repository without creating alerts, click **Save and dry run**.

When the dry run finishes, you'll see a sample of results (up to 1000). Review the results and identify any false positive results.
![Screenshot showing results from dry run.](/assets/cb-29264/images/help/repository/secret-scanning-publish-pattern.png)

![Screenshot showing results from dry run.](/assets/cb-29264/images/help/repository/secret-scanning-publish-pattern.png)

Edit the new custom pattern to fix any problems with the results, then, to test your changes, click **Save and dry run**.

When you're satisfied with your new custom pattern, click **Publish pattern**.

Optionally, to enable push protection for your custom pattern, click **Enable**. For more information, see [Push protection](/en/enterprise-cloud@latest/code-security/secret-scanning/protecting-pushes-with-secret-scanning).

Note

The "Enable" button isn't available until after the dry run succeeds and you publish the pattern.

After your pattern is created, secret scanning scans for any secrets in your entire Git history on all branches present in your GitHub repository. For more information on viewing secret scanning alerts, see [Manage secret scanning alerts](/en/enterprise-cloud@latest/code-security/secret-scanning/managing-alerts-from-secret-scanning).

## [Defining a custom pattern for an organization](#defining-a-custom-pattern-for-an-organization)

Before defining a custom pattern, you must ensure that you enable secret scanning for the repositories that you want to scan in your organization. You can use security configurations to enable secret scanning on all repositories in your organization. For more information, see [Enabling security features at scale](/en/enterprise-cloud@latest/code-security/securing-your-organization/introduction-to-securing-your-organization-at-scale/about-enabling-security-features-at-scale).

In the upper-right corner of GitHub, click your profile picture, then click  **Organizations**.

Select an organization by clicking on it.

Under your organization name, click  **Settings**. If you cannot see the "Settings" tab, select the  dropdown menu, then click **Settings**.

![Screenshot of the tabs in an organization's profile. The "Settings" tab is outlined in dark orange.](/assets/cb-49309/images/help/discussions/org-settings-global-nav-update.png)

![Screenshot of the tabs in an organization's profile. The "Settings" tab is outlined in dark orange.](/assets/cb-49309/images/help/discussions/org-settings-global-nav-update.png)

In the "Security" section of the sidebar, select the **Advanced Security** dropdown menu, then click **Global settings**.

Under "Custom patterns", click **New pattern**.

Enter the details for your new custom pattern. You must at least provide the name for your pattern, and a regular expression for the format of your secret pattern.

![Screenshot of a filled custom secret scanning pattern form.](/assets/cb-81755/images/help/repository/secret-scanning-create-custom-pattern.png)

![Screenshot of a filled custom secret scanning pattern form.](/assets/cb-81755/images/help/repository/secret-scanning-create-custom-pattern.png)

When you're ready to test your new custom pattern, to identify matches in select repositories without creating alerts, click **Save and dry run**.

Select the repositories where you want to perform the dry run.

When you're ready to test your new custom pattern, click **Run**.

When the dry run finishes, you'll see a sample of results (up to 1000). Review the results and identify any false positive results.
![Screenshot showing results from dry run.](/assets/cb-29264/images/help/repository/secret-scanning-publish-pattern.png)

![Screenshot showing results from dry run.](/assets/cb-29264/images/help/repository/secret-scanning-publish-pattern.png)

Edit the new custom pattern to fix any problems with the results, then, to test your changes, click **Save and dry run**.

When you're satisfied with your new custom pattern, click **Publish pattern**.

Optionally, to enable push protection for your custom pattern, click **Enable**. For more information, see [Push protection](/en/enterprise-cloud@latest/code-security/secret-scanning/protecting-pushes-with-secret-scanning#enabling-secret-scanning-as-a-push-protection-in-an-organization-for-a-custom-pattern).

Note

After your pattern is created, secret scanning scans for any secrets in repositories in your organization, including their entire Git history on all branches. Organization owners and repository administrators will be alerted to any secrets found and can review the alert in the repository where the secret is found. For more information on viewing secret scanning alerts, see [Manage secret scanning alerts](/en/enterprise-cloud@latest/code-security/secret-scanning/managing-alerts-from-secret-scanning).

## [Defining a custom pattern for an enterprise account](#defining-a-custom-pattern-for-an-enterprise-account)

Note

Navigate to your enterprise. For example, from the [Enterprises](https://github.com/settings/enterprises?ref_product=ghec&ref_type=engagement&ref_style=text) page on GitHub.com.

At the top of the page, click  **Policies**.

Under  "Policies", click **Advanced Security Code security**.

Under "Advanced Security Code security", click **Security features**.

Under "Secret scanning custom patterns", click **New pattern**.

Enter the details for your new custom pattern. You must at least provide the name for your pattern, and a regular expression for the format of your secret pattern.

![Screenshot of a filled custom secret scanning pattern form.](/assets/cb-81755/images/help/repository/secret-scanning-create-custom-pattern.png)

![Screenshot of a filled custom secret scanning pattern form.](/assets/cb-81755/images/help/repository/secret-scanning-create-custom-pattern.png)

When you're ready to test your new custom pattern, to identify matches in the enterprise without creating alerts, click **Save and dry run**.

Search for and select up to 10 repositories where you want to perform the dry run.

When you're ready to test your new custom pattern, click **Run**.

When the dry run finishes, you'll see a sample of results (up to 1000). Review the results and identify any false positive results.
![Screenshot showing results from dry run.](/assets/cb-29264/images/help/repository/secret-scanning-publish-pattern.png)

![Screenshot showing results from dry run.](/assets/cb-29264/images/help/repository/secret-scanning-publish-pattern.png)

Edit the new custom pattern to fix any problems with the results, then, to test your changes, click **Save and dry run**.

When you're satisfied with your new custom pattern, click **Publish pattern**.

Optionally, to enable push protection for your custom pattern, click **Enable**. For more information, see [Push protection](/en/enterprise-cloud@latest/code-security/secret-scanning/protecting-pushes-with-secret-scanning).

Note

After your pattern is created, secret scanning scans for any secrets in repositories within your organizations with GitHub Secret Protection enabled, including their entire Git history on all branches. Organization owners and repository administrators will be alerted to any secrets found, and can review the alert in the repository where the secret is found. For more information on viewing secret scanning alerts, see [Manage secret scanning alerts](/en/enterprise-cloud@latest/code-security/secret-scanning/managing-alerts-from-secret-scanning).

## Help and support

### Did you find what you needed?

### Help us make these docs great!

All GitHub docs are open source. See something that's wrong or unclear? Submit a pull request.

[Learn how to contribute](/contributing)

### Still need help?

## Legal
